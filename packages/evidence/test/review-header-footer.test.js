// W3d-7 — the header names every cap, the footer every repair, and an unrecorded write is said by
// what covered it.
//   F170 "Not covered:" named no declared session gap but `unrecorded_body`: a `source_clipped`,
//        `unsupported_message`, `incomplete_inventory` or `write_outcome_unknown` capped coverage
//        and the header said only that coverage was partial, never why.
//   F172 the repaired-quote footer counted receipts only; `counts.receiptsRepaired` also counts a
//        settled value code snapped to the instruction (F158), so the two disagreed on one report.
//   F163 an unrecorded write is said by what covered it, and never by a line that contradicts the
//        verdict or another line.
//   F190 (W3e-2) "What was not checked" listed `report.gaps` alone and without the header's
//        de-duplication: a duplicate was listed twice, and a gap declared only on the session was
//        named in the header and listed nowhere.
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

const { renderReview, coverageCauses, COVERAGE_CAUSES, COVERAGE_SENTENCE, GAP_SENTENCE, GAP_SENTENCE_CHILDREN,
  UNRECORDED_COVER_SENTENCE } = review;
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

const headerOf = (md) => md.split('\n').find((line) => line.startsWith('Not covered:')) ?? null;
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

test('saved Markdown shows counts-only finding stages without candidate or malformed report text', () => {
  const direct = (proposed, unusable, rejected, eligible, voted, complete, survived, grounded) => ({
    proposed, responseUnusable: unusable, deterministicRejected: rejected, challengeEligible: eligible,
    challengeVoted: voted, challengeComplete: complete, challengeSurvived: survived, grounded,
  });
  const privateText = 'PRIVATE_MODEL_CANDIDATE_835';
  const md = renderReview(report([], { findingFunnel: {
    direct: { code: direct(1, 0, 1, 0, 0, 0, 0, 0),
      session: { ...direct(0, 0, 0, 0, 0, 0, 0, 0), note: privateText } },
    narrativeContradictedClaims: { proposed: 0, challengeEligible: 0, challengeVoted: 0,
      challengeComplete: 0, challengeSurvived: 0, grounded: 0 },
    final: { published: 0, code: 0, session: 0, merged: 0 },
  } }));
  assert.match(md, /### Finding checks/);
  assert.match(md, /Code: 1 proposed; 0 in unusable replies; 1 rejected before challenge;/);
  assert.match(md, /0 survived; 0 grounded\./);
  assert.match(md, /Published: 0 after deduplication/);
  assert.doesNotMatch(md, /PRIVATE_MODEL_CANDIDATE_835/);
  assert.doesNotMatch(renderReview(report([], { findingFunnel: { direct: { code: { proposed: privateText } } } })),
    /### Finding checks|PRIVATE_MODEL_CANDIDATE_835/);
});

test('all-zero finding stages stay out of the reader report', () => {
  const direct = { proposed: 0, responseUnusable: 0, deterministicRejected: 0,
    challengeEligible: 0, challengeVoted: 0, challengeComplete: 0,
    challengeSurvived: 0, grounded: 0 };
  const claims = { proposed: 0, challengeEligible: 0, challengeVoted: 0,
    challengeComplete: 0, challengeSurvived: 0, grounded: 0 };
  const md = renderReview(report([], { findingFunnel: { direct: { code: direct, session: direct },
    narrativeContradictedClaims: claims, final: { published: 0, code: 0, session: 0, merged: 0 } } }));
  assert.doesNotMatch(md, /### Finding checks|Published: 0/);
});

test('empty decisions distinguish complete reading, unchecked scope and unsettled proposal', () => {
  const complete = renderReview(report([]));
  assert.match(complete, /No grounded decisions were identified in the checked session/);
  assert.doesNotMatch(complete, /This is a coverage gap/);

  const gap = { code: 'incomplete_inventory', channel: 'observations', scope: 'session', count: 2,
    note: 'synthetic action results could not be linked' };
  const incomplete = renderReview(report([gap]));
  assert.match(incomplete, /Not covered: 2 action results were missing, withheld, or could not be linked/);
  assert.match(incomplete, /No decision was published from the checked session material; the rest was not checked/);
  assert.doesNotMatch(incomplete, /Session evidence \*\*partial\*\*|part\(s\) of the recording were not captured/);
  assert.ok(incomplete.indexOf('Not covered:') < incomplete.indexOf('Session evidence incomplete'));

  const unsettled = renderReview(report([gap], { windowResults: [{ challenge: { results: [
    { type: 'decision', executionComplete: true, resolved: false, survived: false },
  ] } }] }));
  assert.match(unsettled, /1 proposed decision could not be settled by the challengers, so none was published/);
  assert.match(unsettled, /Other session evidence was not checked/);

  const withheld = renderReview(report([], { rejectedDecisions: [{ reason: 'receipt_rejected' }] }));
  assert.match(withheld, /1 proposed decision could not be grounded, so none was published/);

  const noSession = report([], { session: null, hasSessionEvidence: false, coverage: 'missing' });
  assert.match(renderReview(noSession), /Code review complete; session evidence unavailable/);
  assert.match(renderReview(noSession), /This is a coverage gap: the decisions were not checked/);
  assert.doesNotMatch(renderReview({ ...noSession, codeCoverage: 'missing' }),
    /Code review complete; session evidence unavailable/);
});

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
    const header = headerOf(renderReview(r));
    assert.equal(header, `Not covered: ${said(cause, n)}.`, 'the cause, with its count when it has one');
    const count = n !== null && typeof n === 'object' ? n.n : n;
    assert.ok(header.includes(String(count)), header);
  });
}

test('F170 a code outside the vocabulary (a retired one, reloaded) still caps, and the header still says so', () => {
  for (const code of ['fused_statement', 'constructor', '__proto__']) {
    const r = report([{ code, channel: 'commentary', scope: 'session', count: 1 }]);
    assert.ok(capped(r), `premise: ${code} caps`);
    assert.equal(headerOf(renderReview(r)), `Not covered: ${said('other_gap', 1)}.`, code);
  }
});

test('F170 every internal unrecorded write caps, and the header names their count', () => {
  const r = report([unrecorded([covered, bare])]);
  assert.ok(capped(r), 'premise');
  assert.equal(headerOf(renderReview(r)), `Not covered: ${said('unrecorded_body', 2)}.`);
});

test('F170 an outside-repository write does not claim a session cap in the header', () => {
  const r = report([unrecorded([outside])]);
  assert.equal(capped(r), false, 'premise: the only write is outside the repository');
  assert.deepEqual(coverageCauses(r), []);
  const md = renderReview(r);
  assert.equal(headerOf(md), null, md);
  assert.ok(md.includes('Session evidence complete.'));
  // Beside a real cap, it is still not named: only the window that did not complete is.
  const partial = report([unrecorded([outside])], { coverageFacts: FACTS({ windowsFailed: 1 }) });
  assert.equal(headerOf(renderReview(partial)), `Not covered: ${COVERAGE_SENTENCE.windows_incomplete({ n: 1, m: 2 })}.`);
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
  assert.equal(headerOf(renderReview(elided)), `Not covered: ${said('instructions_elided', 2)}.`);
  // A delegation declared by the adapter, and counted by the facts over every route.
  const delegated = report([{ code: 'missing_child', channel: 'children', scope: 'session', count: 1, eventIds: ['D1'] }],
    { coverageFacts: FACTS({ delegationsUnlinked: 1 }) });
  assert.equal(headerOf(renderReview(delegated)), `Not covered: ${said('delegations_unlinked', 1)}.`);
  // The same declaration on both lists — live and reloaded — is one loss (F164).
  const clipped = { code: 'source_clipped', channel: 'code', scope: 'session', count: 2, eventIds: ['A1', 'A2'] };
  const twice = report([clipped], { session: Object.assign(new Session({ sessionKey: 'sess-f170', events: [] }),
    { adapterGaps: [{ ...clipped, eventIds: ['A2', 'A1'], note: 'reloaded' }] }) });
  assert.equal(headerOf(renderReview(twice)), `Not covered: ${said('source_clipped', 2)}.`);
  // Two declarations of one code are summed; one with no count counts as one and makes the sum a
  // lower bound (M33, C-06: a cause is always shown with a count).
  const two = report([clipped, { code: 'source_clipped', channel: 'commentary', scope: 'session', count: 1 }]);
  assert.equal(headerOf(renderReview(two)), `Not covered: ${said('source_clipped', 3)}.`);
  const unstated = report([clipped, { code: 'source_clipped', channel: 'commentary', scope: 'session' }]);
  assert.equal(headerOf(renderReview(unstated)), `Not covered: ${said('source_clipped', atLeast(3))}.`);
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

// ---- F172: the footer counts what the count counts ----------------------------------------------

test('F172 the repaired-quote footer counts a snapped settled value, so it equals counts.receiptsRepaired', () => {
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

  const footer = renderReview(built).split('\n').filter((line) => /snapped to the exact recorded text/.test(line));
  assert.equal(footer.length, 1, 'one footer line');
  const n = Number(/^_(\d+) receipt quote\(s\)/.exec(footer[0])?.[1]);
  assert.equal(n, built.counts.receiptsRepaired, footer[0]);
});

test('F172 a report whose count says nothing was repaired prints no repaired-quote footer', () => {
  const md = renderReview(report([], { counts: { decisions: 0, byColumn: {}, receiptsRepaired: 0 } }));
  assert.doesNotMatch(md, /snapped to the exact recorded text/);
});

// ---- F163: one sentence per cover, and no line contradicts another ------------------------------

const UNCHECKED = '### What was not checked';
const gapLines = (md) => {
  const lines = md.split('\n');
  const at = lines.findIndex((l) => l.startsWith('- `unrecorded_body`'));
  if (at < 0) return null;
  const covers = [];
  for (let i = at + 1; i < lines.length && lines[i].startsWith('  - '); i++) covers.push(lines[i]);
  return { headline: lines[at], covers };
};
const coverLine = (n, cover) => `  - ${n} ${UNRECORDED_COVER_SENTENCE[cover]}.`;

for (const [name, writes, expected] of [
  ['inside and outside paths', [covered, outside, bare], [coverLine(1, 'outside'), coverLine(2, 'none')]],
  ['only a path in the reviewed diff', [covered], [coverLine(1, 'none')]],
  ['only outside the repository', [outside], [coverLine(1, 'outside')]],
  ['only nothing', [bare], [coverLine(1, 'none')]],
]) {
  test(`F163 an unrecorded_body gap with ${name} prints one sentence per classified outcome`, () => {
    const r = report([unrecorded(writes)]);
    const md = renderReview(r);
    assert.ok(md.includes(UNCHECKED), md);
    const { headline, covers } = gapLines(md);
    assert.deepEqual(covers, expected, 'only the covers present, in a fixed order');
    assert.ok(!md.includes(GAP_SENTENCE.unrecorded_body), 'no generic headline says every write is unreadable');
    assert.ok(headline.endsWith(':'), 'the gap line introduces its covers');
    const capping = writes.filter((w) => w !== outside).length;
    assert.equal(capped(r), capping > 0, 'premise: each internal write with an unrecorded body caps');
    const header = headerOf(md);
    // The header and the cover lines say the same thing about what capped.
    if (capping) assert.equal(header, `Not covered: ${said('unrecorded_body', capping)}.`);
    else assert.equal(header, null, `a cover line says these do not limit coverage; the header agrees:\n${md}`);
  });
}

test('F163 an unrecorded_body the ledger caps whole says so in one sentence, never with a cover line that says it does not cap', () => {
  // A declaration on the children channel is not classified write by write (ledger.js `gapCaps`):
  // it caps the session whatever covered its writes. A cover line saying "they do not limit session
  // coverage" would contradict the verdict printed above it.
  const gap = unrecorded([covered, outside], { channel: 'children', note: 'SYNTHETIC delegated writes' });
  const r = report([gap]);
  assert.equal(capped(r), true, 'premise: the ledger caps it');
  const md = renderReview(r);
  const { headline, covers } = gapLines(md);
  assert.deepEqual(covers, [], `no cover line claims these writes do not limit coverage:\n${md}`);
  assert.ok(headline.includes(GAP_SENTENCE_CHILDREN.unrecorded_body), headline);
  assert.ok(!md.includes('do not limit session coverage'), md);
  assert.equal(headerOf(md), `Not covered: ${said('unrecorded_body', 2)}.`, 'and the header names what capped');
});

test('F163 a declaration with no writes listed and no count keeps its one sentence, and caps', () => {
  const r = report([{ code: 'unrecorded_body', channel: 'code', scope: 'session' }]);
  assert.equal(capped(r), true, 'fails closed');
  const md = renderReview(r);
  assert.ok(md.includes(`- \`unrecorded_body\` — ${GAP_SENTENCE.unrecorded_body}.`), md);
  assert.equal(headerOf(md), `Not covered: ${said('unrecorded_body', atLeast(1))}.`);
});

// ---- F190: one gap list for the header and the body --------------------------------------------

/** The declared-gap lines of "What was not checked", in order. */
const bodyGapLines = (md) => {
  const lines = md.split('\n');
  const at = lines.indexOf(UNCHECKED);
  if (at < 0) return [];
  const out = [];
  for (let i = at + 1; i < lines.length && !lines[i].startsWith('### '); i++) if (/^- `[^`]+`/.test(lines[i])) out.push(lines[i]);
  return out;
};
const withAdapterGaps = (adapterGaps) => Object.assign(new Session({ sessionKey: 'sess-f190', events: [] }), { adapterGaps });
const clipped = { code: 'source_clipped', channel: 'code', scope: 'session', count: 2, eventIds: ['A1', 'A2'],
  note: 'SYNTHETIC two clipped bodies' };
// The same declaration as reloaded from disk: keys and event ids in another order, a recomputed note.
const reloaded = { note: 'SYNTHETIC reloaded copy', eventIds: ['A2', 'A1'], count: 2, scope: 'session', channel: 'code',
  code: 'source_clipped' };
const clippedLine = `- \`source_clipped\` at \`A1\` (2) — ${GAP_SENTENCE.source_clipped}; SYNTHETIC two clipped bodies.`;

test('F190 a declaration on the report twice — live and reloaded — is listed once, as the header counts it', () => {
  const md = renderReview(report([clipped, reloaded]));
  assert.equal(headerOf(md), `Not covered: ${said('source_clipped', 2)}.`, 'premise: the header counts one loss');
  assert.deepEqual(bodyGapLines(md), [clippedLine], `one line, the first declaration's:\n${md}`);
  // And across the two lists: the report's copy and the session's are one declaration.
  const across = renderReview(report([clipped], { session: withAdapterGaps([reloaded]) }));
  assert.deepEqual(bodyGapLines(across), [clippedLine]);
});

test('F190 a gap declared only on the session, and named in the header, is listed in the body too', () => {
  const unsupported = { code: 'unsupported_message', channel: 'commentary', scope: 'session', count: 3,
    note: 'SYNTHETIC three records' };
  const r = report([], { session: withAdapterGaps([unsupported]) });
  assert.ok(capped(r), 'premise: the session-only gap caps coverage');
  const md = renderReview(r);
  assert.equal(headerOf(md), `Not covered: ${said('unsupported_message', 3)}.`, 'premise: the header names it');
  assert.deepEqual(bodyGapLines(md),
    [`- \`unsupported_message\` (3) — ${GAP_SENTENCE.unsupported_message}; SYNTHETIC three records.`]);
});

test('F190 the body lists exactly the declarations the header reads: the report\'s first, then the session\'s own', () => {
  const missing = { code: 'missing_child', channel: 'children', scope: 'session', count: 1, eventIds: ['D1'],
    note: 'Task delegation with no verified child session' };
  const unsupported = { code: 'unsupported_message', channel: 'observations', scope: 'session', count: 1 };
  const md = renderReview(report([missing, clipped], { session: withAdapterGaps([reloaded, unsupported, missing]) }));
  assert.deepEqual(bodyGapLines(md).map((line) => /^- `([^`]+)`/.exec(line)[1]),
    ['missing_child', 'source_clipped', 'unsupported_message']);
  assert.equal(headerOf(md), `Not covered: ${[said('delegations_unlinked', 1), said('source_clipped', 2),
    said('unsupported_message', 1)].join('; ')}.`, 'and the header names each of them once');
});

// ---- F191: a delegation matched to several candidates is named as such -------------------------

test('F191 ambiguous_child has its own closed phrase in the header phrasebook', () => {
  assert.equal(review.GAP_HEADER_CAUSE.ambiguous_child, 'delegations_ambiguous');
  assert.equal(review.GAP_HEADER_CAUSE.missing_child, 'delegations_unlinked', 'a missing child is unchanged');
  assert.ok(COVERAGE_CAUSES.includes('delegations_ambiguous'));
  assert.equal(said('delegations_ambiguous', 2), '2 delegation(s) matched more than one candidate child session');
  assert.equal(said('delegations_ambiguous', null), 'some delegation(s) matched more than one candidate child session');
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
    const header = headerOf(renderReview(r));
    assert.equal(header, `Not covered: ${expected.map(([cause, n]) => said(cause, n)).join('; ')}.`);
    if (!expected.some(([cause]) => cause === 'delegations_unlinked'))
      assert.doesNotMatch(header, /no captured child session/, 'no delegation here had no candidate');
  });
}

test('F191 end to end: a hand-off whose child link is ambiguous is said, in the header and the body, to have matched several', async () => {
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
  const md = renderReview(built);
  assert.equal(headerOf(md), `Not covered: ${said('delegations_ambiguous', 1)}.`);
  assert.deepEqual(bodyGapLines(md).map((line) => /^- `([^`]+)`/.exec(line)[1]), ['ambiguous_child'], 'listed once');
});

test('M29c session-only renderer makes no PR survival or diff claim and labels retained evidence', () => {
  const zero = { proposed: 0, responseUnusable: 0, deterministicRejected: 0,
    challengeEligible: 0, challengeVoted: 0, challengeComplete: 0,
    challengeSurvived: 0, grounded: 0 };
  const one = { ...zero, proposed: 1, challengeEligible: 1, challengeVoted: 1,
    challengeComplete: 1, challengeSurvived: 1, grounded: 1 };
  const r = report([], { pr: null, codeCoverage: 'missing', codeCoverageFacts: null,
    reviewScope: 'session-only', session: new Session({ sessionKey: 'synthetic', events: [] }),
    pivots: [{ abandoned: 'attempt one', adopted: 'attempt two', receipts: [] }],
    findings: [{ origin: 'session-review', status: 'FYI', kind: 'session-note', title: 'A session note',
      explanation: 'Recorded session effect.', scope: 'session-effect', receipts: [] }],
    findingFunnel: { direct: { code: zero, session: one },
      narrativeContradictedClaims: { proposed: 0, challengeEligible: 0, challengeVoted: 0,
        challengeComplete: 0, challengeSurvived: 0, grounded: 0 },
      final: { published: 1, code: 0, session: 1, merged: 0 } },
  });
  const md = renderReview(r);
  assert.match(md, /session only/);
  assert.match(md, /These approaches were attempted and abandoned in the recorded session/);
  assert.match(md, /This concerns recorded session events; no PR location was reviewed/);
  assert.match(md, /Retained evidence stays in the local evidence store; declared gaps remain unavailable/);
  assert.match(md, /Session: 1 proposed/);
  assert.doesNotMatch(md, /Only the survivor appears in the diff|has no line in the diff|Code: 0 proposed|nothing is blocking/);
});

test('M29c session-only no-evidence report does not claim a PR was linked', () => {
  const md = renderReview(report([], { pr: null, codeCoverage: 'missing', codeCoverageFacts: null,
    reviewScope: 'session-only', hasSessionEvidence: false,
    coverageFacts: FACTS({ windows: 0, windowsWithNarrative: 0, actions: 0 }) }));
  assert.match(md, /No coding session was supplied/);
  assert.doesNotMatch(md, /linked to this PR|PR #\?/);
});

test('M29c stale PR relevance shortfall cannot appear in session-only prose', () => {
  const md = renderReview(report([], { pr: null, codeCoverage: 'missing', codeCoverageFacts: null,
    reviewScope: 'session-only', windowResults: [{ shortfall: {
      narrative: 'ok', grounding: { sessionGrounded: true, relevanceUnchecked: 2 },
      challenge: { reason: null }, transport: null } }] }));
  assert.doesNotMatch(md, /PR file list was not available|could not be placed in the PR/);
});
