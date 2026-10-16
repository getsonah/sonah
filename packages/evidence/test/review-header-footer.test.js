// W3d-7 — every cap is named among the coverage causes every reader reads (`coverageCauses`, the CLI's and the page's
// "Not covered" line), each once, with its count.
//   F170 "Not covered:" named no declared session gap but `unrecorded_body`: a `source_clipped`,
//        `unsupported_message`, `incomplete_inventory` or `write_outcome_unknown` capped coverage
//        and the header said only that coverage was partial, never why.
//   F172 `counts.receiptsRepaired` also counts a settled value code snapped to the instruction (F158).
//   F163 an unrecorded write caps by the writes nothing covered, and the causes say so.
//   F190 (W3e-2) a declaration on the report and on the session, live and reloaded, is one loss.
//   F191 (W3e-2) an `ambiguous_child` was named in the header as a delegation with "no captured child
//        session" — it had several candidates, not none.
//
// Every byte is synthetic: invented instructions, paths and quotes. No model, no recording.
import test from 'node:test';
import assert from 'node:assert/strict';
// Namespace imports, so a test fails on its own against code that predates it rather than the
// whole file failing to link.
import * as review from '../src/review.js';
import * as ledger from '../src/ledger.js';
import { Session } from '../src/session.js';
import { runReview } from '../src/run-review.js';

const { coverageCauses, COVERAGE_CAUSES, COVERAGE_SENTENCE } = review;
const { GAP_CODES, honestStatuses } = ledger;

const REPO = { host: 'github.com', id: '707' };
/** Facts that reduce to `complete`: whatever caps a report built on them, a declared gap did. */
const FACTS = (over = {}) => ({ windows: 2, windowsWithNarrative: 2, windowsFailed: 0, actions: 3, instructions: 1,
  instructionsElided: 0, delegationsUnlinked: 0, adapterGaps: 0, declared: 'complete', ...over });
/** src/a.js is in the PR, complete, and its hunks were placed in an answered request. */
const PR = { repo: REPO, number: 707, enumeration: 'complete',
  files: [{ path: 'src/a.js', change: 'modified', contentState: 'complete' }] };
const report = (gaps, over = {}) => ({ repo: REPO, pr: PR, session: null, hasSessionEvidence: true,
  coverageFacts: FACTS(), codeCoverageFacts: { placed: ['src/a.js'] },
  decisions: [], findings: [], rejectedDecisions: [], rejectedFindings: [], gaps,
  counts: { decisions: 0, byColumn: {}, uncheckedColumn: 0, rejectedDecisions: 0, rejectedFindings: 0 },
  coverage: 'complete', codeCoverage: 'complete', ...over });

/** The causes a reader names, as the CLI's and the page's "Not covered" line reads them: each cause's sentence, in
 *  COVERAGE_CAUSES order; null when none is named. */
const headerOf = (r) => { const causes = coverageCauses(r);
  return causes.length ? `Not covered: ${causes.map(([cause, counts]) => COVERAGE_SENTENCE[cause](counts)).join('; ')}.` : null; };
// M33 (C-06): a count may be a lower bound — `{ n, atLeast: true }` — when a declaration stated none.
const said = (cause, n) => COVERAGE_SENTENCE[cause](n !== null && typeof n === 'object' ? n : { n });
/** A countless declaration is counted by its declarations: at least this many (M33, C-06). */
const atLeast = (n) => ({ n, atLeast: true });
/** Does `honestStatuses` — the one reduction every producer and renderer applies — cap this report? */
const capped = (r) => { const s = honestStatuses(r); return s.coverage !== 'complete' || s.codeCoverage !== 'complete'; };

const covered = { eventId: 'A1', path: 'src/a.js', outsideRepository: false };
const outside = { eventId: 'A2', path: '../synthetic-outside/notes.txt', outsideRepository: true };
const bare = { eventId: 'A3', path: 'src/c.js', outsideRepository: false };
const unrecorded = (writes, over = {}) => ({ code: 'unrecorded_body', channel: 'code', scope: 'session',
  count: writes.length, eventIds: writes.map((w) => w.eventId), writes,
  note: `${writes.length} write(s) whose body the recording does not contain: ${writes.length} shell write(s)`, ...over });

// ---- F170: every capping gap is named in the header ---------------------------------------------

test('F170 the header phrasebook is closed, and every gap code has a header cause', () => {
  assert.deepEqual(Object.keys(COVERAGE_SENTENCE).sort(), [...COVERAGE_CAUSES].sort());
  const table = review.GAP_HEADER_CAUSE;
  assert.ok(table && Object.isFrozen(table), 'one frozen table from gap code to header cause');
  assert.deepEqual(Object.keys(table).sort(), [...GAP_CODES].sort(),
    'derived from the gap vocabulary: a code with no header cause could cap and never be named');
  for (const [code, cause] of Object.entries(table))
    assert.ok(COVERAGE_CAUSES.includes(cause), `${code} is named by ${cause}, which has no sentence`);
  for (const cause of COVERAGE_CAUSES) assert.match(COVERAGE_SENTENCE[cause]({ n: 2, m: 3 }), /\S/);
  // A declaration may state no count; whatever cause names it must still read as words.
  for (const cause of new Set([...Object.values(table), 'other_gap']))
    assert.doesNotMatch(said(cause, null), /null|undefined|NaN/, `${cause} with no count`);
});

// The channel and scope each producer declares the code on (sonah-ledger.js, ledger.js, code-review.js).
const DECLARED = [
  ['incomplete_inventory', { channel: 'actions', scope: 'session', count: null }, 'incomplete_inventory', atLeast(1)],
  ['incomplete_inventory', { channel: 'children', scope: 'session', count: null, eventIds: ['D1'] }, 'incomplete_inventory', atLeast(1)],
  ['source_clipped', { channel: 'code', scope: 'session', count: 2, eventIds: ['A1', 'A2'] }, 'source_clipped', 2],
  ['source_clipped', { channel: 'commentary', scope: 'session', count: 1 }, 'source_clipped', 1],
  ['unsupported_message', { channel: 'commentary', scope: 'session', count: 3 }, 'unsupported_message', 3],
  ['unsupported_message', { channel: 'observations', scope: 'session', count: 1 }, 'unsupported_message', 1],
  ['write_outcome_unknown', { channel: 'observations', scope: 'session', count: 2, eventIds: ['A4', 'A5'] }, 'write_outcome_unknown', 2],
  ['code_unreviewable', { channel: 'code', scope: 'pr', count: 4 }, 'code_unreviewable', 4],
  ['missing_child', { channel: 'children', scope: 'session', count: 1, eventIds: ['D1'] }, 'delegations_unlinked', 1],
  // F191: a delegation matched to several candidates is named as such, not as one with no child.
  ['ambiguous_child', { channel: 'children', scope: 'session', count: 1, eventIds: ['D2'] }, 'delegations_ambiguous', 1],
];

for (const [code, shape, cause, n] of DECLARED) {
  test(`F170 a report whose only cap is a declared ${code} (${shape.channel}) names it in the header`, () => {
    const r = report([{ code, ...shape, note: 'synthetic' }]);
    assert.ok(capped(r), 'premise: the gap caps coverage');
    const header = headerOf(r);
    assert.equal(header, `Not covered: ${said(cause, n)}.`, 'the cause, with its count when it has one');
    const count = n !== null && typeof n === 'object' ? n.n : n;
    assert.ok(header.includes(String(count)), header);
  });
}

test('F170 a code outside the vocabulary (a retired one, reloaded) still caps, and the header still says so', () => {
  for (const code of ['fused_statement', 'constructor', '__proto__']) {
    const r = report([{ code, channel: 'commentary', scope: 'session', count: 1 }]);
    assert.ok(capped(r), `premise: ${code} caps`);
    assert.equal(headerOf(r), `Not covered: ${said('other_gap', 1)}.`, code);
  }
});

test('F170 every internal unrecorded write caps, and the header names their count', () => {
  const r = report([unrecorded([covered, bare])]);
  assert.ok(capped(r), 'premise');
  assert.equal(headerOf(r), `Not covered: ${said('unrecorded_body', 2)}.`);
});

test('F170 an outside-repository write does not claim a session cap in the header', () => {
  const r = report([unrecorded([outside])]);
  assert.equal(capped(r), false, 'premise: the only write is outside the repository');
  assert.deepEqual(coverageCauses(r), []);
  assert.equal(headerOf(r), null);
  // Beside a real cap, it is still not named: only the window that did not complete is.
  const partial = report([unrecorded([outside])], { coverageFacts: FACTS({ windowsFailed: 1 }) });
  assert.equal(headerOf(partial), `Not covered: ${COVERAGE_SENTENCE.windows_incomplete({ n: 1, m: 2 })}.`);
});

test('F170 the header names a gap exactly when honestStatuses caps it — every code, on every channel and scope', () => {
  const channels = ['instructions', 'commentary', 'actions', 'observations', 'children', 'identity', 'code', undefined];
  const scopes = ['session', 'pr', undefined];
  const disagreements = [];
  for (const code of GAP_CODES) for (const channel of channels) for (const scope of scopes)
    for (const writes of code === 'unrecorded_body' ? [[covered, outside], [covered, bare]] : [undefined]) {
      const gap = { code, channel, scope, count: writes ? writes.length : 1, ...(writes ? { writes } : {}) };
      const r = report([gap]);
      const named = coverageCauses(r).length > 0;
      if (named !== capped(r)) disagreements.push(`${code}/${channel}/${scope}${writes ? `/${writes.length}w` : ''}: named ${named}, capped ${capped(r)}`);
    }
  assert.deepEqual(disagreements, [], 'the header and the coverage reduction must agree on what caps');
});

test('F170 one loss is named once, however many routes declared it', () => {
  // An elided ask: the adapter declares it as an instructions-channel `incomplete_inventory`, and the
  // facts count the same ask. One cause, the fact's.
  const elided = report([{ code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: 2,
    note: 'instruction text was elided by the recorder' }], { coverageFacts: FACTS({ instructionsElided: 2 }) });
  assert.equal(headerOf(elided), `Not covered: ${said('instructions_elided', 2)}.`);
  // A delegation declared by the adapter, and counted by the facts over every route.
  const delegated = report([{ code: 'missing_child', channel: 'children', scope: 'session', count: 1, eventIds: ['D1'] }],
    { coverageFacts: FACTS({ delegationsUnlinked: 1 }) });
  assert.equal(headerOf(delegated), `Not covered: ${said('delegations_unlinked', 1)}.`);
  // The same declaration on both lists — live and reloaded — is one loss (F164).
  const clipped = { code: 'source_clipped', channel: 'code', scope: 'session', count: 2, eventIds: ['A1', 'A2'] };
  const twice = report([clipped], { session: Object.assign(new Session({ sessionKey: 'sess-f170', events: [] }),
    { adapterGaps: [{ ...clipped, eventIds: ['A2', 'A1'], note: 'reloaded' }] }) });
  assert.equal(headerOf(twice), `Not covered: ${said('source_clipped', 2)}.`);
  // Two declarations of one code are summed; one with no count counts as one and makes the sum a
  // lower bound (M33, C-06: a cause is always shown with a count).
  const two = report([clipped, { code: 'source_clipped', channel: 'commentary', scope: 'session', count: 1 }]);
  assert.equal(headerOf(two), `Not covered: ${said('source_clipped', 3)}.`);
  const unstated = report([clipped, { code: 'source_clipped', channel: 'commentary', scope: 'session' }]);
  assert.equal(headerOf(unstated), `Not covered: ${said('source_clipped', atLeast(3))}.`);
});

test('F170 several causes are named in the one fixed order, whatever order they were declared in', () => {
  const gaps = [
    { code: 'code_unreviewable', channel: 'code', scope: 'pr', count: 1 },
    { code: 'write_outcome_unknown', channel: 'observations', scope: 'session', count: 1, eventIds: ['A9'] },
    unrecorded([bare]),
    { code: 'unsupported_message', channel: 'commentary', scope: 'session', count: 1 },
    { code: 'source_clipped', channel: 'code', scope: 'session', count: 1 },
    { code: 'incomplete_inventory', channel: 'actions', scope: 'session', count: null },
  ];
  const r = report(gaps, { coverageFacts: FACTS({ windowsFailed: 1 }) });
  const order = coverageCauses(r).map(([cause]) => cause);
  assert.deepEqual(order, COVERAGE_CAUSES.filter((cause) => order.includes(cause)), 'COVERAGE_CAUSES order');
  assert.deepEqual(order, ['windows_incomplete', 'incomplete_inventory', 'source_clipped', 'unsupported_message',
    'unrecorded_body', 'write_outcome_unknown', 'code_unreviewable']);
  assert.deepEqual(coverageCauses({ ...r, gaps: [...gaps].reverse() }), coverageCauses(r));
});

// ---- F172: the count counts every repair -------------------------------------------------------

test('F172 counts.receiptsRepaired counts a snapped settled value beside a repaired receipt', () => {
  const blobs = {
    ask: 'SYNTHETIC_F172_ASK: use the exact backend value “Redis” for the cache layer.',
    said: 'SYNTHETIC_F172_SAID: I’ll wire the “Redis” client into the cache layer now.',
    body: 'export const SYNTHETIC_F172_BACKEND = "redis";\n', ok: 'SYNTHETIC_F172_OK\n',
  };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const session = new Session({ sessionKey: 'sess-f172', adapter: 'claude', blobs, events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', text: whole('ask'), supersedes: [] },
    { id: 'C1', kind: 'commentary', sequence: 1, phase: 'working', text: whole('said') },
    { id: 'A1', kind: 'invocation', sequence: 2, callKey: 'a1', tool: 'Write', operation: 'write',
      paths: [{ path: 'src/cache.js' }], command: [], input: [],
      changes: [{ path: 'src/cache.js', before: [], after: whole('body'), diff: [] }] },
    { id: 'A1-r', kind: 'observation', sequence: 3, invocation: 'A1', callKey: 'a1', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: whole('ok'), sourceOfResult: 'native', terminalStatusProven: true },
  ] });
  const candidate = { actorSession: session.sessionKey, dimension: 'cache backend', chosen: 'Redis',
    value: null, valueReceipt: null, actions: ['A1'],
    // Straight quotes where the recording has curly ones: both are snapped by code.
    stated: { eventId: 'C1', role: 'commentary', quote: 'I\'ll wire the "Redis" client' },
    constrainedBy: { instruction: { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_F172_ASK' },
      settles: true, settledValueQuote: 'backend value "Redis" for' } };
  const built = ledger.buildLedger({ repo: REPO, session, pr: null, candidates: [candidate] });
  const [decision] = built.decisions;
  assert.equal(decision?.column, 'asked-settled', 'premise: the decision grounded as settled');
  assert.equal(decision.stated.repaired, true, 'premise: one repaired receipt');
  assert.notEqual(decision.constrainedBy.settledValueQuote, 'backend value "Redis" for', 'premise: one snapped settled value');
  assert.equal(built.counts.receiptsRepaired, 2, 'premise: the count counts both (F158)');

});

// ---- F163: an unrecorded write caps by the writes nothing covered -------------------------------

for (const [name, writes] of [
  ['inside and outside paths', [covered, outside, bare]],
  ['only a path in the reviewed diff', [covered]],
  ['only outside the repository', [outside]],
  ['only nothing', [bare]],
]) {
  test(`F163 an unrecorded_body gap with ${name} caps by its internal writes, and the causes say how many`, () => {
    const r = report([unrecorded(writes)]);
    const capping = writes.filter((w) => w !== outside).length;
    assert.equal(capped(r), capping > 0, 'premise: each internal write with an unrecorded body caps');
    if (capping) assert.equal(headerOf(r), `Not covered: ${said('unrecorded_body', capping)}.`);
    else assert.equal(headerOf(r), null, 'writes outside the repository do not limit coverage');
  });
}

test('F163 an unrecorded_body the ledger caps whole is named with every write it declares', () => {
  // A declaration on the children channel is not classified write by write (ledger.js `gapCaps`): it caps the session
  // whatever covered its writes.
  const gap = unrecorded([covered, outside], { channel: 'children', note: 'SYNTHETIC delegated writes' });
  const r = report([gap]);
  assert.equal(capped(r), true, 'premise: the ledger caps it');
  assert.equal(headerOf(r), `Not covered: ${said('unrecorded_body', 2)}.`, 'and the causes name what capped');
});

test('F163 a declaration with no writes listed and no count caps, counted as at least one', () => {
  const r = report([{ code: 'unrecorded_body', channel: 'code', scope: 'session' }]);
  assert.equal(capped(r), true, 'fails closed');
  assert.equal(headerOf(r), `Not covered: ${said('unrecorded_body', atLeast(1))}.`);
});

// ---- F190: one gap list, each declaration once ------------------------------------------------

const withAdapterGaps = (adapterGaps) => Object.assign(new Session({ sessionKey: 'sess-f190', events: [] }), { adapterGaps });
const clipped = { code: 'source_clipped', channel: 'code', scope: 'session', count: 2, eventIds: ['A1', 'A2'],
  note: 'SYNTHETIC two clipped bodies' };
// The same declaration as reloaded from disk: keys and event ids in another order, a recomputed note.
const reloaded = { note: 'SYNTHETIC reloaded copy', eventIds: ['A2', 'A1'], count: 2, scope: 'session', channel: 'code',
  code: 'source_clipped' };

test('F190 a declaration on the report twice — live and reloaded — is counted once', () => {
  assert.equal(headerOf(report([clipped, reloaded])), `Not covered: ${said('source_clipped', 2)}.`);
  // And across the two lists: the report's copy and the session's are one declaration.
  assert.equal(headerOf(report([clipped], { session: withAdapterGaps([reloaded]) })),
    `Not covered: ${said('source_clipped', 2)}.`);
});

test('F190 a gap declared only on the session caps and is named', () => {
  const unsupported = { code: 'unsupported_message', channel: 'commentary', scope: 'session', count: 3,
    note: 'SYNTHETIC three records' };
  const r = report([], { session: withAdapterGaps([unsupported]) });
  assert.ok(capped(r), 'premise: the session-only gap caps coverage');
  assert.equal(headerOf(r), `Not covered: ${said('unsupported_message', 3)}.`);
});

test('F190 the report\'s declarations and the session\'s own are each named once', () => {
  const missing = { code: 'missing_child', channel: 'children', scope: 'session', count: 1, eventIds: ['D1'],
    note: 'Task delegation with no verified child session' };
  const unsupported = { code: 'unsupported_message', channel: 'observations', scope: 'session', count: 1 };
  const r = report([missing, clipped], { session: withAdapterGaps([reloaded, unsupported, missing]) });
  assert.equal(headerOf(r), `Not covered: ${[said('delegations_unlinked', 1), said('source_clipped', 2),
    said('unsupported_message', 1)].join('; ')}.`, 'each of them once');
});

// ---- F191: a delegation matched to several candidates is named as such -------------------------

test('F191 ambiguous_child has its own closed phrase in the header phrasebook', () => {
  assert.equal(review.GAP_HEADER_CAUSE.ambiguous_child, 'delegations_ambiguous');
  assert.equal(review.GAP_HEADER_CAUSE.missing_child, 'delegations_unlinked', 'a missing child is unchanged');
  assert.ok(COVERAGE_CAUSES.includes('delegations_ambiguous'));
  assert.equal(said('delegations_ambiguous', 2), '2 delegations to a helper match more than one helper recording');
  assert.equal(said('delegations_ambiguous', null), 'some delegations to a helper match more than one helper recording');
  assert.doesNotMatch(said('delegations_ambiguous', 1), /no captured child session/);
});

const missingGap = { code: 'missing_child', channel: 'children', scope: 'session', count: 1, eventIds: ['D1'],
  note: 'Task delegation with no verified child session' };
const ambiguousGap = { code: 'ambiguous_child', channel: 'children', scope: 'session', count: 1, eventIds: ['D2'],
  note: 'Task delegation matched more than one candidate child session' };

// The fact (`delegationsUnlinked`) counts every delegation left unlinked, the ambiguous ones included;
// each loss is named once, by the sentence that is true of it.
for (const [name, gaps, facts, expected] of [
  ['declared, with no fact counting it', [ambiguousGap], {}, [['delegations_ambiguous', 1]]],
  ['counted by the fact too', [ambiguousGap], { delegationsUnlinked: 1 }, [['delegations_ambiguous', 1]]],
  ['beside a missing one, no fact', [missingGap, ambiguousGap], {}, [['delegations_unlinked', 1], ['delegations_ambiguous', 1]]],
  ['beside a missing one, both counted by the fact', [missingGap, ambiguousGap], { delegationsUnlinked: 2 },
    [['delegations_unlinked', 1], ['delegations_ambiguous', 1]]],
  ['beside losses only the fact counts', [ambiguousGap], { delegationsUnlinked: 3 },
    [['delegations_unlinked', 2], ['delegations_ambiguous', 1]]],
  ['with a count that states none', [{ ...ambiguousGap, count: undefined }], { delegationsUnlinked: 1 },
    [['delegations_ambiguous', atLeast(1)]]],
  ['with a count that states none, beside a missing one', [missingGap, { ...ambiguousGap, count: undefined }],
    { delegationsUnlinked: 2 }, [['delegations_unlinked', 1], ['delegations_ambiguous', atLeast(1)]]],
]) {
  test(`F191 an ambiguous delegation ${name} is said to have matched several candidates, never to have none`, () => {
    const r = report(gaps, { coverageFacts: FACTS(facts) });
    assert.ok(capped(r), 'premise');
    const header = headerOf(r);
    assert.equal(header, `Not covered: ${expected.map(([cause, n]) => said(cause, n)).join('; ')}.`);
    if (!expected.some(([cause]) => cause === 'delegations_unlinked'))
      assert.doesNotMatch(header, /no captured child session/, 'no delegation here had no candidate');
  });
}

test('F191 end to end: a hand-off whose child link is ambiguous is said to have matched several', async () => {
  const blobs = { ask: 'SYNTHETIC_F191_ASK: split the migration out.', brief: 'SYNTHETIC_F191_BRIEF: write db/migrate.sql.' };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const session = new Session({ sessionKey: 'sess-f191', blobs, children: [{ assignmentEvent: 'D1', state: 'ambiguous' }],
    events: [
      { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: whole('ask') },
      { id: 'D1', kind: 'invocation', sequence: 1, callKey: 'd1', tool: 'Task', operation: 'delegate',
        paths: [], command: [], changes: [], input: whole('brief') }] });
  const built = await runReview({ session, pr: { repo: REPO, number: 191, files: [] },
    judge: async () => ({ decisions: [], pivots: [], claims: [], requirements: [] }) });
  assert.deepEqual(built.gaps.map((g) => g.code), ['ambiguous_child'], 'premise: the ledger declares it');
  assert.equal(built.coverageFacts.delegationsUnlinked, 1, 'premise: and the fact counts it');
  assert.equal(headerOf(built), `Not covered: ${said('delegations_ambiguous', 1)}.`);
});
