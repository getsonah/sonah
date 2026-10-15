// W3-3 deterministic receipt repair.
//
// The rule does not move: a receipt is valid only if its quote is an exact substring of ONE
// source of the declared role of the cited event, verified by string search (C-05). Repair is
// code — no model, no fuzzy matching, no edit distance — that produces such a quote or nothing.
// Everything it returns is re-checked by the strict verifier, so nothing here can widen what
// counts as grounded; it can only stop a recorder's curly quote from discarding real evidence.
//
// Every positive case asserts its own premise first — `verifyReceipt` REJECTS this quote today —
// so a fixture that drifts into already-exact text cannot silently stop testing the repair.

import test from 'node:test';
import assert from 'node:assert/strict';

import { Session, verifyReceipt, verifyReceipts, repairReceipt, MIN_QUOTE_CHARS } from '../src/session.js';
import { buildLedger, groundDecision, groundFinding } from '../src/ledger.js';
import { runReview } from '../src/run-review.js';
import { repairQuote } from '../src/receipt-repair.js';
import { redisPivotSession, redisPivotPr } from '../fixtures/redis-pivot.js';

// ---- the synthetic session ---------------------------------------------------------------

// Written as escapes so the exact character under test is visible: curly quotes, an em dash,
// an HTML entity, an ellipsis and a double space — the five near-misses a recorder produces.
const SAID = 'He said “don’t — ever” &amp; left…  twice';
const NEXT = 'Then we shipped it on Friday';
// A commentary the recorder capped: `[…]` is the RECORDER's word, never the speaker's.
const CAPPED = 'The cache key was stale […] so we cleared it';
// Redaction's own marker, likewise never spoken.
const HIDDEN = 'The token was  ‹redacted:api-key›  in the log';

const BLOBS = { said: SAID, next: NEXT, capped: CAPPED, hidden: HIDDEN };
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(BLOBS[key], 'utf8') }];

const session = new Session({
  sessionKey: 'sess-repair',
  events: [
    { id: 'E1', kind: 'commentary', sequence: 0, phase: 'working', text: whole('said') },
    { id: 'E2', kind: 'commentary', sequence: 1, phase: 'working', text: whole('next') },
    { id: 'E3', kind: 'commentary', sequence: 2, phase: 'working', text: whole('capped') },
    { id: 'E4', kind: 'commentary', sequence: 3, phase: 'working', text: whole('hidden') },
  ],
  blobs: BLOBS,
});

const receipt = (quote, over = {}) => ({ role: 'commentary', eventId: 'E1', quote, ...over });

const rejectedToday = (r) => assert.equal(verifyReceipt(session, r).ok, false,
  `premise broken: the strict verifier already accepts ${JSON.stringify(r.quote)}`);

/** Assert the near-miss is rejected today, repairs to `expected`, and that the result is exact. */
function repairsTo(quote, expected, over = {}) {
  const r = receipt(quote, over);
  rejectedToday(r);

  const out = repairReceipt(session, r);
  assert.equal(out.ok, true, `repair refused ${JSON.stringify(quote)}`);
  assert.equal(out.repaired, true, 'a snapped quote must be reported as repaired');
  assert.equal(out.original, quote, 'the original is kept for accounting');
  assert.equal(out.receipt.quote, expected);

  // The only thing that makes it evidence: the strict verifier accepts it, unchanged.
  assert.equal(verifyReceipt(session, out.receipt).ok, true, 'the repaired quote is not exact');
  const sources = session.sourcesFor(session.event(r.eventId)).filter((s) => s.role === r.role);
  assert.equal(sources.filter((s) => s.text.includes(out.receipt.quote)).length, 1,
    'a repaired quote must live in exactly one source of the cited role');
  return out;
}

// ---- one test per transform ---------------------------------------------------------------

test('curly quotes, apostrophe and em dash snap to the exact recorded characters', () => {
  repairsTo('"don\'t - ever"', '“don’t — ever”');
});

test('an HTML entity in the source is matched through its decoded form', () => {
  repairsTo('& left', '&amp; left');
});

test('a collapsed whitespace run and a typed ellipsis snap back to the recorded spacing', () => {
  // three spaces in the quote, two in the source, `...` for `…`
  repairsTo('left...   twice', 'left…  twice');
});

test('trailing punctuation the model added is stripped, not matched', () => {
  repairsTo('“don’t — ever”,', 'don’t — ever');
});

test('a seven-word quote with one wrong leading word matches on the remaining six', () => {
  repairsTo('Yesterday "don\'t - ever" & left... twice', '“don’t — ever” &amp; left…  twice');
});

// ---- negatives: these must stay rejected ---------------------------------------------------

const NEGATIVES = [
  ['a paraphrase', receipt('He said never ever')],
  ['a quote joined across two events', receipt('left...  twice Then we shipped')],
  ['a quote spanning a capped-commentary marker', receipt('was stale [...] so we', { eventId: 'E3' })],
  ['a quote spanning a redaction marker', receipt('token was ‹redacted:api-key› in', { eventId: 'E4' })],
  ['a quote under MIN_QUOTE_CHARS after trim', receipt('  —  ')],
  ['a role the cited event cannot carry', receipt('"don\'t - ever"', { role: 'instruction' })],
];

for (const [name, r] of NEGATIVES) {
  test(`repair refuses ${name}`, () => {
    rejectedToday(r);
    const out = repairReceipt(session, r);
    assert.equal(out.ok, false, `repair invented a quote for ${name}`);
    assert.equal(out.reason, 'receipt_rejected');
  });
}

test('MIN_QUOTE_CHARS is the floor repair respects, not one it lowers', () => {
  assert.equal(MIN_QUOTE_CHARS, 4);
  assert.equal(repairReceipt(session, receipt('He')).ok, false);
});

test('the negatives repair nothing at all: the batch count stays zero', () => {
  const { verified, rejected, repaired } = verifyReceipts(session, NEGATIVES.map(([, r]) => r));
  assert.deepEqual(verified, []);
  assert.equal(rejected.length, NEGATIVES.length);
  assert.equal(repaired, 0);
});

// ---- the batch API -------------------------------------------------------------------------

test('verifyReceipts repairs by default, counts what it repaired, and leaves exact quotes alone', () => {
  const exact = receipt('He said');
  assert.equal(verifyReceipt(session, exact).ok, true, 'premise: this one is already exact');

  const batch = [exact, receipt('& left'), receipt('He said never ever')];
  const { verified, rejected, repaired } = verifyReceipts(session, batch);
  assert.equal(verified.length, 2);
  assert.equal(rejected.length, 1);
  assert.equal(repaired, 1, 'the already-exact receipt is not counted as a repair');
  assert.equal(verified[0].quote, 'He said', 'an exact quote is returned untouched');
  assert.equal(verified[1].quote, '&amp; left');
  assert.equal(verified[0].repairedFrom, undefined);
  assert.equal(verified[1].repairedFrom, '& left');
});

test('verifyReceipts({ repair: false }) is the old strict behaviour, byte for byte', () => {
  const { verified, rejected, repaired } = verifyReceipts(session, [receipt('& left')], { repair: false });
  assert.deepEqual(verified, []);
  assert.equal(rejected.length, 1);
  assert.equal(repaired, 0);
});

test('verifyReceipt (singular) stays strict: repair never reaches it', () => {
  assert.equal(verifyReceipt(session, receipt('& left')).ok, false);
  assert.equal(verifyReceipt(session, receipt('"don\'t - ever"')).ok, false);
});

// ---- the invariant: 200 generated near-misses, none of them ever fabricated -----------------

// Seeded in the test only — the library itself reads no clock and no random source.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CORPUS_TEXT = {
  ask: 'Do not add any new datastore — use what the repo already has. Prefer “boring” tools, and keep the diff small.',
  pivot: 'I will add a small cache layer instead — that is new infrastructure, but it is the standard approach and it is quick.',
  cafe: 'The café service résumés after the retry; we logged the failure twice and moved on.',
  entities: 'Compare a &amp; b, then a &lt; b, and finally a &gt; b before the report is written.',
  cmd: 'npm run test:integration -- --reporter “dot”',
  path: 'config/cache.yml',
  after: 'backend: memory\nttl_seconds: 300\nnamespace: products\n',
  out: 'FAIL test/integration/cache.test.js\n  cache layer reads through to the store\n\nTests: 1 failed, 11 passed, 12 total\n',
};

const corpusBlobs = { ...CORPUS_TEXT };
const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(corpusBlobs[key], 'utf8') }];

const corpus = new Session({
  sessionKey: 'sess-corpus',
  events: [
    { id: 'C1', kind: 'instruction', sequence: 0, authority: 'human', text: ref('ask'), supersedes: [] },
    { id: 'C2', kind: 'commentary', sequence: 1, phase: 'working', text: ref('pivot') },
    { id: 'C3', kind: 'commentary', sequence: 2, phase: 'working', text: ref('cafe') },
    { id: 'C4', kind: 'commentary', sequence: 3, phase: 'working', text: ref('entities') },
    { id: 'C5', kind: 'invocation', sequence: 4, callKey: 'k1', tool: 'Bash', operation: 'command',
      paths: [{ path: CORPUS_TEXT.path }], command: ref('cmd'), input: [],
      changes: [{ path: CORPUS_TEXT.path, before: [], after: ref('after'), diff: [] }] },
    { id: 'C6', kind: 'observation', sequence: 5, invocation: 'C5', callKey: 'k1', phase: 'terminal',
      result: 'failed', exitCode: 1, output: ref('out'), sourceOfResult: 'native' },
  ],
  blobs: corpusBlobs,
});

// Each mutation is a near-miss a real recorder or model produces. None of them is a paraphrase.
const MUTATIONS = [
  (q) => q.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"),
  (q) => q.replace(/[–—]/g, '-'),
  (q) => q.replace(/…/g, '...'),
  (q) => q.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
  (q) => q.replace(/\s+/g, ' '),
  (q) => `${q},`,
  (q) => `${q}"`,
  (q) => `"${q}"`,
  (q) => (q.trim().split(/\s+/).length >= 6 ? `Actually ${q}` : q),
  (q) => (q.trim().split(/\s+/).length >= 7 ? `${q} anyway` : q),
  (q) => q.normalize('NFD'),
  (q) => `​${q}​`,
];

/** 200 quotes that are mangled truths AND are rejected by the strict verifier as they stand. */
function nearMisses(seed, count = 200) {
  const rand = mulberry32(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const cases = [];
  for (let guard = 0; guard < 50000 && cases.length < count; guard++) {
    const event = pick(corpus.events);
    const sources = corpus.sourcesFor(event).filter((s) => s.text.trim());
    if (!sources.length) continue;
    const source = pick(sources);

    // A word-aligned span of the real source: the near-miss must be a MANGLED truth, not a lie.
    const words = source.text.split(/(\s+)/).filter((w) => w.length);
    const start = Math.floor(rand() * words.length);
    const excerpt = words.slice(start, start + 1 + Math.floor(rand() * 9)).join('');
    if (excerpt.trim().length < MIN_QUOTE_CHARS) continue;

    let quote = excerpt;
    const rounds = 1 + Math.floor(rand() * 2);
    for (let m = 0; m < rounds; m++) quote = pick(MUTATIONS)(quote);
    if (quote.trim().length < MIN_QUOTE_CHARS) continue;

    const receipt = { role: source.role, eventId: event.id, quote };
    // A mutation that changed nothing still grounds today: that is not a near-miss.
    if (verifyReceipt(corpus, receipt).ok) continue;
    cases.push(receipt);
  }
  return cases;
}

test('invariant: over 200 generated near-misses, every accepted repair is an exact substring', () => {
  const cases = nearMisses(0x5f3a91c7);
  assert.equal(cases.length, 200, 'the generator did not produce 200 genuine near-misses');

  let accepted = 0;
  for (const receipt of cases) {
    const out = repairReceipt(corpus, receipt);
    if (!out.ok) continue;
    accepted++;

    const roleSources = corpus.sourcesFor(corpus.event(receipt.eventId)).filter((s) => s.role === receipt.role);
    const hits = roleSources.filter((s) => s.text.includes(out.receipt.quote));
    assert.equal(hits.length, 1,
      `${JSON.stringify(out.receipt.quote)} is not in exactly one ${receipt.role} source of ${receipt.eventId}`);
    assert.equal(verifyReceipt(corpus, out.receipt).ok, true,
      `the strict verifier rejects what repair returned for ${JSON.stringify(receipt.quote)}`);
  }
  assert.ok(accepted > 40, `only ${accepted} of 200 near-misses were repaired — the corpus proves nothing`);
});

// ---- where it takes effect: the ledger -----------------------------------------------------

const ledgerSession = redisPivotSession();
const ledgerPr = redisPivotPr();
const repo = ledgerPr.repo;

// The recorded text is `verified it works — the tests pass`; the model typed a hyphen.
const NEAR_MISS_FINDING = {
  origin: 'session-review',
  kind: 'claim_contradicted',
  title: 'The final message says the tests pass; the integration run failed',
  explanation: 'The closing message reports verification succeeded. The integration suite reported a failure.',
  scope: 'session-effect',
  anchor: null,
  receipts: [
    { role: 'commentary', eventId: 'E9', quote: 'verified it works - the tests pass' },
    { role: 'observation', eventId: 'E6', quote: 'Tests: 1 failed, 11 passed, 12 total' },
  ],
};

test('a finding withheld only for a hyphen is grounded, with the exact quote rendered', () => {
  assert.equal(verifyReceipt(ledgerSession, NEAR_MISS_FINDING.receipts[0]).ok, false, 'premise: rejected today');

  const out = groundFinding({ repo, session: ledgerSession, pr: ledgerPr, candidate: NEAR_MISS_FINDING });
  assert.equal(out.ok, true);
  assert.equal(out.receiptsRepaired, 1);
  assert.equal(out.finding.receipts[0].quote, 'verified it works — the tests pass');
  assert.equal(verifyReceipt(ledgerSession, out.finding.receipts[0]).ok, true);
});

test('a decision whose stated and instruction quotes are near-misses grounds and keeps its column', () => {
  const candidate = {
    actorSession: 'sess-redis-pivot',
    dimension: 'cache backend',
    chosen: 'Redis as a shared cache store',
    value: null, valueReceipt: null,
    actions: ['E3'],
    stated: { role: 'commentary', eventId: 'E2', quote: 'add a small Redis layer instead - that is technically new infrastructure' },
    constrainedBy: {
      instruction: { role: 'instruction', eventId: 'E1', quote: 'Do not add any new infrastructure - no new services' },
      settles: false,
      settledValueQuote: null,
    },
  };
  assert.equal(verifyReceipt(ledgerSession, candidate.stated).ok, false, 'premise: rejected today');
  assert.equal(verifyReceipt(ledgerSession, candidate.constrainedBy.instruction).ok, false, 'premise: rejected today');
  assert.equal(groundDecision({ repo, session: ledgerSession, pr: ledgerPr, candidate, instructionHistoryComplete: true }).ok,
    true, 'a rejected stated receipt used to sink the whole decision');

  const out = groundDecision({ repo, session: ledgerSession, pr: ledgerPr, candidate, instructionHistoryComplete: true });
  assert.equal(out.receiptsRepaired, 2);
  assert.equal(out.decision.stated.quote, 'add a small Redis layer instead — that is technically new infrastructure');
  assert.equal(out.decision.column, 'asked-chose');
  assert.equal(out.decision.columnState, 'grounded');
  assert.equal(out.decision.constrainedBy.instruction.quote,
    'Do not add any new infrastructure — no new services');
  assert.equal(verifyReceipt(ledgerSession, out.decision.constrainedBy.instruction).ok, true);
});

test('the report counts the receipts it repaired', () => {
  const report = buildLedger({
    repo, session: ledgerSession, pr: ledgerPr, sessionCoverage: 'complete',
    findingCandidates: [NEAR_MISS_FINDING],
  });
  assert.equal(report.findings.length, 1);
  assert.equal(report.counts.receiptsRepaired, 1);
});

test('a fabricated quote is still refused when repair is on', () => {
  const fabricated = {
    origin: 'session-review',
    kind: 'edit_under_negative_requirement',
    title: 'Agent ignored an instruction to avoid YAML config',
    explanation: 'Plausible wording, fabricated evidence.',
    scope: 'current-code',
    anchor: null,
    receipts: [
      { role: 'instruction', eventId: 'E1', quote: 'do not use YAML for configuration' },
      { role: 'action', eventId: 'E3', quote: 'config/redis.yml' },
    ],
  };
  const out = groundFinding({ repo, session: ledgerSession, pr: ledgerPr, candidate: fabricated });
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'receipt_rejected');
});

// ---- F78(a): repair tries every source -----------------------------------------------------
//
// Sonah's W3-3 review said repair stops at the first source once a candidate lands on a
// synthetic marker there, contradicting its own "tried against every source" comment. CONFIRMED:
// the case below returned null from `repairQuote` although the later source holds the one clean
// exact span. An invocation carries several code sources (each change's after and before), so
// "the first source" is a real position a marker can occupy.

/** One edit invocation whose code sources are, in order: after(a), before(a), after(b), before(b). */
function codeSources(first, later, { firstBefore = '', laterBefore = '' } = {}) {
  const blobs = { first, later, firstBefore, laterBefore };
  const ref = (key) => (blobs[key] ? [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }] : []);
  return new Session({ sessionKey: 'sess-sources', blobs, events: [
    { id: 'A1', kind: 'invocation', sequence: 0, callKey: 'k', tool: 'Edit', operation: 'edit',
      paths: [{ path: 'a.js' }, { path: 'b.js' }], command: [], input: [],
      changes: [{ path: 'a.js', before: ref('firstBefore'), after: ref('first'), diff: [] },
        { path: 'b.js', before: ref('laterBefore'), after: ref('later'), diff: [] }] },
  ] });
}
const codeReceipt = (quote) => ({ role: 'code', eventId: 'A1', quote });
const codeTexts = (s) => s.sourcesFor(s.event('A1')).filter((x) => x.role === 'code').map((x) => x.text);

test('F78(a) a marker hit in the first source does not stop repair: the later clean span is found', () => {
  // The recorder elided text in a.js — `[…]` is ITS mark. In b.js the author typed three dots.
  const s = codeSources("const note = 'the cache was stale […] so we cleared it';\n",
    '// the cache was stale [...] so we cleared it\n');
  const r = codeReceipt('the cache was stale [...]  so we cleared it');   // a doubled space
  assert.equal(verifyReceipt(s, r).ok, false, 'premise: rejected today');
  assert.ok(codeTexts(s)[0].includes('stale […] so'), 'premise: the FIRST source holds the marker');

  assert.equal(repairQuote(codeTexts(s), r.quote, MIN_QUOTE_CHARS), 'the cache was stale [...] so we cleared it');
  const out = repairReceipt(s, r);
  assert.equal(out.ok, true, 'repair stopped at the marker in the first source');
  assert.equal(out.receipt.quote, 'the cache was stale [...] so we cleared it');
  assert.equal(codeTexts(s).filter((t) => t.includes(out.receipt.quote)).length, 1);
});

test('F78(a) the marker source alone still repairs nothing', () => {
  const s = codeSources("const note = 'the cache was stale […] so we cleared it';\n", '// unrelated\n');
  const out = repairReceipt(s, codeReceipt('the cache was stale [...]  so we cleared it'));
  assert.equal(out.ok, false, 'a span over the recorder\'s own words is never evidence');
});

test('F78(a) two sources that both match cleanly are ambiguous: rejected', () => {
  // Different exact characters: which one the reader meant is a guess, and a guess is not a receipt.
  const differ = codeSources('// we don’t ship on Friday\n', "// we don't ship on Friday\n");
  const r = codeReceipt('we don‘t  ship on Friday');
  assert.equal(verifyReceipt(differ, r).ok, false, 'premise: rejected today');
  assert.equal(repairReceipt(differ, r).ok, false);

  // The same exact text in two sources (an edit's unchanged line, before and after) is still
  // more than one source. The W3-3 rule is ONE source; an exact quote of it still grounds.
  const shared = codeSources('if (ready) start();\n', '// other\n', { firstBefore: 'if (ready) start();\n' });
  assert.equal(repairReceipt(shared, codeReceipt('if (ready)  start();')).ok, false);
  assert.equal(verifyReceipt(shared, codeReceipt('if (ready) start();')).ok, true,
    'an exact quote of a line both sides carry grounds exactly as before');
});

test('F78(a) one source is searched past its own marker for a clean occurrence', () => {
  const s = codeSources('// stale […] so cleared\nconst why = "stale [...] so cleared";\n', '// other\n');
  const out = repairReceipt(s, codeReceipt('stale [...]  so cleared'));
  assert.equal(out.ok, true);
  assert.equal(out.receipt.quote, 'stale [...] so cleared');
});

// ---- F78(b): the repair count is always a non-negative integer -----------------------------
//
// Sonah's W3-3 review said `groundFinding`'s repair count could be non-numeric and corrupt the
// running total. REFUTED: the count is `verifyReceipts(...).repaired`, the `.length` of a
// filtered array, so every `ok: true` result carries a safe integer; a malformed `receipts`
// either rejects (no count, read as `?? 0`) or throws inside `buildLedger`'s try (rejected).
// This pins it — a change that made the count anything else would turn it red.

test('F78(b) every grounded finding reports an integer repair count, and so does the report', () => {
  const good = NEAR_MISS_FINDING.receipts;
  const shapes = [good, [], null, undefined, 'abc', 3, true, { 0: good[0], length: 1 },
    [null, ...good], ['x', ...good], [...good, good[0]], [{ ...good[0], quote: 42 }, good[1]],
    [{ ...good[0], quote: 'verified it works — the tests pass', repaired: 'yes', original: 7 }, good[1]]];
  const candidates = shapes.map((receipts) => ({ ...NEAR_MISS_FINDING, receipts }));
  for (const candidate of candidates) {
    let out;
    try { out = groundFinding({ repo, session: ledgerSession, pr: ledgerPr, candidate }); } catch { continue; }
    if (out.ok) assert.ok(Number.isSafeInteger(out.receiptsRepaired) && out.receiptsRepaired >= 0,
      `receiptsRepaired ${JSON.stringify(out.receiptsRepaired)}`);
  }
  const report = buildLedger({ repo, session: ledgerSession, pr: ledgerPr, sessionCoverage: 'complete',
    findingCandidates: candidates });
  assert.ok(Number.isSafeInteger(report.counts.receiptsRepaired) && report.counts.receiptsRepaired >= 0);
  // The forged `repaired: 'yes'` on an exact quote is not a repair and is not counted as one.
  assert.equal(report.counts.receiptsRepaired, 2 + 1,
    'the two identical near-miss copies and the plain near-miss; never the forged flag');
});

// ---- F77 (data half): a repaired receipt says so, on the object the renderer receives ------

const flagOf = (r) => ({ repaired: r.repaired, original: r.original });

test('F77 a repaired finding receipt carries repaired: true and the original; an exact one neither', () => {
  const out = groundFinding({ repo, session: ledgerSession, pr: ledgerPr, candidate: NEAR_MISS_FINDING });
  assert.equal(out.ok, true);
  assert.deepEqual(flagOf(out.finding.receipts[0]),
    { repaired: true, original: 'verified it works - the tests pass' });
  assert.deepEqual(flagOf(out.finding.receipts[1]), { repaired: undefined, original: undefined },
    'the observation quote was exact and was not repaired');

  // And through the report, where the renderer reads it.
  const report = buildLedger({ repo, session: ledgerSession, pr: ledgerPr, sessionCoverage: 'complete',
    findingCandidates: [NEAR_MISS_FINDING] });
  assert.equal(report.findings[0].receipts[0].repaired, true);
});

test('F77 every repaired decision receipt is flagged: stated, instruction and value', () => {
  const candidate = {
    actorSession: 'sess-redis-pivot', dimension: 'cache backend', chosen: 'Redis as a shared cache store',
    actions: ['E3'],
    value: 'backend: redis',
    valueReceipt: { role: 'code', field: 'added-code', eventId: 'E3', quote: 'backend:  redis' },
    stated: { role: 'commentary', eventId: 'E2', quote: 'add a small Redis layer instead - that is technically new infrastructure' },
    constrainedBy: { instruction: { role: 'instruction', eventId: 'E1', quote: 'Do not add any new infrastructure - no new services' },
      settles: false, settledValueQuote: null },
  };
  for (const r of [candidate.valueReceipt, candidate.stated, candidate.constrainedBy.instruction])
    assert.equal(verifyReceipt(ledgerSession, r).ok, false, `premise: ${r.quote} is rejected today`);

  const out = groundDecision({ repo, session: ledgerSession, pr: ledgerPr, candidate, instructionHistoryComplete: true });
  assert.equal(out.ok, true);
  assert.equal(out.decision.valueState, 'grounded');
  assert.deepEqual(flagOf(out.decision.valueReceipt), { repaired: true, original: 'backend:  redis' });
  assert.deepEqual(flagOf(out.decision.stated), { repaired: true, original: candidate.stated.quote });
  assert.deepEqual(flagOf(out.decision.constrainedBy.instruction),
    { repaired: true, original: candidate.constrainedBy.instruction.quote });
  assert.equal(out.receiptsRepaired, 3);
});

test('F77 a model cannot mark its own receipt repaired: the flag is code\'s alone', () => {
  const forged = { repaired: true, original: 'something else', repairedFrom: 'something else' };
  const finding = { ...NEAR_MISS_FINDING, receipts: [
    { role: 'commentary', eventId: 'E9', quote: 'verified it works — the tests pass', ...forged },
    { role: 'observation', eventId: 'E6', quote: 'Tests: 1 failed, 11 passed, 12 total', ...forged }] };
  const f = groundFinding({ repo, session: ledgerSession, pr: ledgerPr, candidate: finding });
  assert.equal(f.ok, true);
  assert.equal(f.receiptsRepaired, 0);
  for (const r of f.finding.receipts) {
    assert.deepEqual(flagOf(r), { repaired: undefined, original: undefined });
    assert.equal(r.repairedFrom, undefined);
  }

  const d = groundDecision({ repo, session: ledgerSession, pr: ledgerPr, instructionHistoryComplete: true, candidate: {
    actorSession: 'sess-redis-pivot', dimension: 'd', chosen: 'c', actions: ['E3'], value: null, valueReceipt: null,
    stated: { role: 'commentary', eventId: 'E2', quote: 'add a small Redis layer', ...forged },
    constrainedBy: { instruction: { role: 'instruction', eventId: 'E1', quote: 'Add response caching', ...forged },
      settles: false, settledValueQuote: null } } });
  assert.equal(d.ok, true);
  assert.equal(d.receiptsRepaired, 0, 'a forged repairedFrom used to be counted as a repair');
  for (const r of [d.decision.stated, d.decision.constrainedBy.instruction]) {
    assert.deepEqual(flagOf(r), { repaired: undefined, original: undefined });
    assert.equal(r.repairedFrom, undefined);
  }
});

test('F77 a repaired pivot receipt is flagged in the published report', async () => {
  const pivotQuote = 'add a small Redis layer instead - that is technically new infrastructure';
  const narrative = { decisions: [], claims: [], requirements: [], pivots: [{
    abandoned: 'the in-process map', adopted: 'a Redis layer', whyAbandoned: 'it needed a shared store',
    receipts: [{ eventId: 'E2', role: 'commentary', quote: pivotQuote },
      { eventId: 'E1', role: 'instruction', quote: 'Do not add any new infrastructure' }] }] };
  const judge = async (request) => (request.challenge
    ? { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
        explanation: 'Synthetic support vote.',
        receipts: [{ eventId: 'E1', role: 'instruction', quote: 'Do not add any new infrastructure' }] })) }
    : narrative);
  const report = await runReview({ session: ledgerSession, pr: ledgerPr, judge });
  assert.equal(report.pivots.length, 1, 'premise: the pivot was published');
  const [snapped, exact] = report.pivots[0].receipts;
  assert.equal(snapped.quote, 'add a small Redis layer instead — that is technically new infrastructure');
  assert.deepEqual(flagOf(snapped), { repaired: true, original: pivotQuote });
  assert.deepEqual(flagOf(exact), { repaired: undefined, original: undefined });
});
