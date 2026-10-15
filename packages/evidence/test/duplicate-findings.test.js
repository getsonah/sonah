// W3-6: one finding per defect.
//
// In every review run so far, the same defect could arrive twice in two framings — the CLI-wave
// review reported the trailing-backslash bug in `github.js` once as "a rendered line can end on a
// backslash" and once as "escapePublic drops only one trailing backslash". Same file, same lines,
// same kind: one defect, two accusations, and a reader with no way to tell that from two.
//
// The merge is STRUCTURAL and nothing else. Title similarity is not evidence — two genuinely
// different problems are often phrased alike, and merging those would hide one of them.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLedger, mergeDuplicateFindings, codeSourceTexts } from '../src/ledger.js';
import { renderReview } from '../src/review.js';
import { Session } from '../src/session.js';

const repo = { host: 'github.com', id: 'sonah/sonah' };
const FILE = 'packages/cli/src/github.js';
const pr = { number: 12, files: [{ path: FILE, change: 'modified', contentState: 'complete' }],
  enumeration: 'complete' };

const codeFinding = (over = {}) => ({
  origin: 'code-review',
  kind: 'code_issue',
  title: 'a rendered line can end on a backslash',
  explanation: 'the cut keeps the doubled backslash and only one is removed',
  scope: 'current-code',
  status: 'DECIDE',
  anchor: { path: FILE, side: 'RIGHT', startLine: 33, endLine: 44 },
  receipts: [{ role: 'code', eventId: 'rev:github.js', quote: 'flat.slice(0, 300)' }],
  id: 'f-a',
  ...over,
});

// L5: the recorded code each code receipt's event holds. A shared quote is one place only when it occurs there exactly
// once; these sources stand in for the frozen diff sources a code review reads.
const LEDGER_SOURCE = [
  'function sameDefect(a, b) {',
  '  if (a.anchor.path !== b.anchor.path) return false;',
  '  if (!guard(a)) return null;',
  '  return a.anchor.startLine <= b.anchor.endLine;',
  '}',
  'function survivorOf(kept, finding) {',
  '  if (!kept) return null;',
  '  const [survivor, absorbed] = order(kept, finding);',
  '  return survivor;',
  '}',
].join('\n');
const SOURCES = { 'rev:github.js': ['const flat = text.replace(/\\\\+$/, \'\');\nreturn flat.slice(0, 300);\nescapePublic(flat);'],
  'rev:ledger.js': [LEDGER_SOURCE] };
const sourcesOf = (eventId) => SOURCES[eventId] ?? null;

const ledgerOf = (codeFindings) => buildLedger({ repo, session: null, pr, codeFindings,
  codeCoverage: 'complete', codeSourcesOf: sourcesOf });

// ---- the CLI-wave pair ---------------------------------------------------------------------

test('two findings on the same file, overlapping lines and the same kind become one (W3-6)', () => {
  const first = codeFinding();
  const second = codeFinding({
    id: 'f-b',
    title: 'escapePublic removes only one trailing backslash',
    anchor: { path: FILE, side: 'RIGHT', startLine: 40, endLine: 43 },
    receipts: [
      { role: 'code', eventId: 'rev:github.js', quote: 'replace(/\\\\+$/' },
      { role: 'code', eventId: 'rev:github.js', quote: 'escapePublic' },
    ],
  });

  const report = ledgerOf([first, second]);
  assert.equal(report.findings.length, 1, 'one defect, one finding');
  assert.equal(report.counts.findingsMerged, 1, 'the merge is counted, never silent');

  const [survivor] = report.findings;
  assert.equal(survivor.title, second.title, 'the framing with more receipts is the one kept');
  assert.deepEqual(survivor.alsoReportedAs, [first.title],
    'the other framing is carried, not discarded');

  const md = renderReview({ ...report, session: null });
  assert.match(md, /also reported as: a rendered line can end on a backslash/);
});

test('two findings on different lines of one file, citing different code, stay two (W3-6, F94)', () => {
  // F94 made a shared exact receipt a second key, so this fixture now cites DISJOINT receipts:
  // disjoint lines AND disjoint evidence is the only shape that says "two places, two defects".
  const report = ledgerOf([
    codeFinding(),
    codeFinding({ id: 'f-c', title: 'a second, unrelated defect',
      anchor: { path: FILE, side: 'RIGHT', startLine: 100, endLine: 104 },
      receipts: [{ role: 'code', eventId: 'rev:github.js', quote: 'return lines.join' }] }),
  ]);
  assert.equal(report.findings.length, 2, 'non-overlapping ranges are different places');
  assert.equal(report.counts.findingsMerged, 0);
});

// ---- F93: the side of the diff is part of where a finding points ----------------------------

test('F93 a LEFT and a RIGHT anchor at the same lines are two findings', () => {
  // Line 40 of the base file and line 40 of the head file are different lines of different text.
  // The receipts are identical on purpose: side must be identity before any other key is read.
  const { findings, merged } = mergeDuplicateFindings([
    codeFinding({ anchor: { path: FILE, side: 'LEFT', startLine: 33, endLine: 44 } }),
    codeFinding({ id: 'f-left', title: 'the removed guard no longer runs',
      anchor: { path: FILE, side: 'RIGHT', startLine: 33, endLine: 44 } }),
  ]);
  assert.equal(merged, 0, 'LEFT and RIGHT are different files at the same line numbers');
  assert.equal(findings.length, 2);
});

// ---- F94: a shared exact receipt is the same defect -----------------------------------------

// The W3b review's own shape: four framings of one defect, anchored on four different,
// NON-overlapping lines of one function, each citing the same hunk quote. Line overlap alone
// kept all four; the evidence they share says they are one.
const SAME_HUNK = { role: 'code', eventId: 'rev:ledger.js', quote: 'a.anchor.path !== b.anchor.path' };
const LEDGER = 'packages/evidence/src/ledger.js';
const framing = (id, title, startLine, endLine, extra = [], status = 'FYI') => codeFinding({
  id, title, status,
  anchor: { path: LEDGER, side: 'RIGHT', startLine, endLine },
  receipts: [SAME_HUNK, ...extra],
});

test('F94 four framings on different lines of one function, one shared quote, are one finding', () => {
  const four = [
    framing('w-1', 'sameDefect ignores anchor.side', 496, 496),
    framing('w-2', 'LEFT and RIGHT findings at one line are conflated', 499, 500,
      [{ role: 'code', eventId: 'rev:ledger.js', quote: 'a.anchor.startLine <= b.anchor.endLine' }], 'DECIDE'),
    framing('w-3', 'the merge key omits the diff side', 490, 491),
    framing('w-4', 'a base-side comment can absorb a head-side one', 503, 503),
  ];
  // Premise: no two of these ranges overlap, so the W3-6 key alone could never merge them.
  for (const a of four) for (const b of four) if (a !== b)
    assert.ok(a.anchor.endLine < b.anchor.startLine || b.anchor.endLine < a.anchor.startLine,
      `premise broken: ${a.id} and ${b.id} overlap`);

  const report = ledgerOf(four);
  assert.equal(report.findings.length, 1, 'one defect, one finding');
  assert.equal(report.counts.findingsMerged, 3);
  const [survivor] = report.findings;
  assert.equal(survivor.title, 'LEFT and RIGHT findings at one line are conflated',
    'the framing with the most receipts is the one kept');
  assert.deepEqual([...survivor.alsoReportedAs].sort(), [
    'a base-side comment can absorb a head-side one',
    'sameDefect ignores anchor.side',
    'the merge key omits the diff side',
  ]);
  assert.equal(survivor.status, 'DECIDE', 'the stronger status survives the merge (W3b)');
});

test('F94 two findings in one file with disjoint receipts and disjoint lines are two', () => {
  const { findings, merged } = mergeDuplicateFindings([
    framing('d-1', 'the side is ignored', 496, 496),
    codeFinding({ id: 'd-2', title: 'the survivor drops the absorbed receipts',
      anchor: { path: LEDGER, side: 'RIGHT', startLine: 535, endLine: 546 },
      receipts: [{ role: 'code', eventId: 'rev:ledger.js', quote: 'const [survivor, absorbed]' }] }),
  ], { sourcesOf });
  assert.equal(merged, 0);
  assert.equal(findings.length, 2);
});

test('F94 "the same receipt" means the same event AND the same exact quote', () => {
  const at = (id, startLine, receipt) => codeFinding({ id, title: id,
    anchor: { path: LEDGER, side: 'RIGHT', startLine, endLine: startLine }, receipts: [receipt] });
  const both = { sourcesOf: (id) => (id === 'rev:ledger.js@base' ? [LEDGER_SOURCE] : sourcesOf(id)) };
  assert.equal(mergeDuplicateFindings([at('e-0', 10, SAME_HUNK), at('e-00', 20, SAME_HUNK)], both).merged, 1, 'premise');
  // Same quote at a different revision event: a different source, so not shared evidence.
  assert.equal(mergeDuplicateFindings([at('e-1', 10, SAME_HUNK),
    at('e-2', 20, { ...SAME_HUNK, eventId: 'rev:ledger.js@base' })], both).merged, 0);
  // Same event, a quote that differs by one character: not the same receipt.
  assert.equal(mergeDuplicateFindings([at('e-3', 10, SAME_HUNK),
    at('e-4', 20, { ...SAME_HUNK, quote: 'a.anchor.path != b.anchor.path' })], both).merged, 0);
});

test('F94 a shared receipt never merges across side, path, kind or origin', () => {
  const base = framing('k-0', 'base', 10, 10);
  const variants = [
    framing('k-side', 'side', 20, 20), framing('k-path', 'path', 20, 20),
    framing('k-kind', 'kind', 20, 20), framing('k-origin', 'origin', 20, 20),
  ];
  variants[0].anchor = { ...variants[0].anchor, side: 'LEFT' };
  variants[1].anchor = { ...variants[1].anchor, path: FILE };
  variants[2].kind = 'claim_contradicted';
  variants[3].origin = 'session-review';
  assert.equal(mergeDuplicateFindings([base, framing('k-same', 'same', 20, 20)], { sourcesOf }).merged, 1, 'premise');
  for (const v of variants)
    assert.equal(mergeDuplicateFindings([base, v], { sourcesOf }).merged, 0, `${v.id} merged across its own key`);
});

test('F94 a shared rule is not a shared defect: only a code receipt is the second key', () => {
  // Two edits under one prohibition, at two places in one file, both cite the SAME instruction.
  // That is one rule broken twice. Merging them would delete the second place with no trace.
  const rule = { role: 'instruction', eventId: 'E1', quote: 'Do not touch the migrations directory' };
  const edit = (id, eventId, startLine) => ({
    origin: 'session-review', kind: 'edit_under_negative_requirement', title: `edit ${id}`,
    explanation: 'e', scope: 'current-code', status: 'DECIDE', id,
    anchor: { path: 'db/migrate.sql', side: 'RIGHT', startLine, endLine: startLine + 2 },
    receipts: [rule, { role: 'action', eventId, quote: 'db/migrate.sql' }],
  });
  const { findings, merged } = mergeDuplicateFindings([edit('m-1', 'E3', 10), edit('m-2', 'E7', 80)]);
  assert.equal(merged, 0);
  assert.equal(findings.length, 2);
});

// ---- F94 risk (W3c-3), L5: a shared receipt must locate ONE place to merge -----------------
// `return null;` is in every guard clause of a file. Two defects in two functions that each quote
// it share a string, not a defect — merging them deletes the second one with no trace. Whether a
// quote locates one place is read from the recorded source, in any language: it occurs there once.

const citing = (id, startLine, quote, eventId = 'rev:ledger.js') => codeFinding({ id, title: `defect ${id}`,
  anchor: { path: LEDGER, side: 'RIGHT', startLine, endLine: startLine },
  receipts: [{ role: 'code', eventId, quote }] });
const pair = (quote, source) => mergeDuplicateFindings([citing('q-1', 10, quote, 'rev:q'), citing('q-2', 90, quote, 'rev:q')],
  { sourcesOf: (id) => (id === 'rev:q' ? source : null) }).merged;

test('F94 risk: two distinct defects in one file both quoting `return null;` stay two', () => {
  assert.equal(LEDGER_SOURCE.split('return null;').length - 1, 2, 'premise: the line is in two functions');
  const { findings, merged } = mergeDuplicateFindings([
    citing('n-1', 120, 'return null;'), citing('n-2', 480, 'return null;')], { sourcesOf });
  assert.equal(merged, 0);
  assert.deepEqual(findings.map((f) => f.id), ['n-1', 'n-2']);
});

test('L5: a shared quote merges when it occurs exactly once in the cited source, whatever it reads like', () => {
  // A brace, a keyword, a short token: no list decides; the recorded source does.
  for (const quote of ['}', 'nil', 'Ok(())', 'END;', 'return null;'])
    assert.equal(pair(quote, [`begin\n  x := 1;\n  ${quote}\nfinish`]), 1, `once: ${JSON.stringify(quote)}`);
  // The same quotes, twice in the source (in one span or across the edit's two sides), locate no one place.
  for (const quote of ['}', 'nil', 'Ok(())', 'END;', 'const value = map.get(k12);']) {
    assert.equal(pair(quote, [`${quote}\n${quote}`]), 0, `twice: ${JSON.stringify(quote)}`);
    // Once in each of two spans — an edit's two sides, or two changes — is two occurrences: the record cannot show
    // they are one place (L5 review F2, below).
    assert.equal(pair(quote, [quote, `a\n${quote}`]), 0, `once on each side: ${JSON.stringify(quote)}`);
  }
  assert.equal(pair('aa', ['aaa']), 0, 'overlapping occurrences count');
  assert.equal(pair('else {', ['} else {\n}']), 1);
});

test('L5: a source the merge cannot read proves no quote distinctive — it merges nothing on a receipt', () => {
  assert.equal(pair('const [survivor, absorbed]', null), 0, 'an event the source does not hold');
  assert.equal(mergeDuplicateFindings([citing('s-1', 10, 'const [survivor, absorbed]'),
    citing('s-2', 90, 'const [survivor, absorbed]')]).merged, 0, 'no source at all');
  assert.equal(pair('const [survivor, absorbed]', [LEDGER_SOURCE]), 1, 'premise: with its source it merges');
});

// L5 review F2: should a quote held once by an edit's written side and once by its prior state count once? Not on what
// the record holds. A path's first edit carries the WHOLE file as its prior state and only the written segment as its
// after side, so an unchanged guard line the write kept and a guard line the write added beside an old one record the
// same counts, one on each side; the second is two places in the file. And two changes of one event (a MultiEdit's
// entries) are two places, each holding the quote once. Counting each side or span on its own would merge both.
const ORDER_PATH = 'src/order.js';
const blobRefs = (key, text) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
const editSession = (changes) => {
  const blobs = {};
  const recorded = changes.map(({ after, before = null, priorState }, i) => {
    blobs[`after${i}`] = after;
    if (before !== null) blobs[`before${i}`] = before;
    return { path: ORDER_PATH, after: blobRefs(`after${i}`, after), before: before === null ? [] : blobRefs(`before${i}`, before),
      diff: [], extent: { recorded: true, priorState } };
  });
  return new Session({ sessionKey: 'l5-sides', blobs, events: [{ id: 'A1', kind: 'invocation', tool: 'Edit',
    operation: 'edit', sequence: 0, paths: [{ path: ORDER_PATH }], command: [], input: [], changes: recorded }] });
};
const GUARD = 'if (amount > order.total) throw new RangeError(amount);';
const atOrder = (id, startLine) => codeFinding({ id, title: `defect ${id}`,
  anchor: { path: ORDER_PATH, side: 'RIGHT', startLine, endLine: startLine },
  receipts: [{ role: 'code', eventId: 'A1', quote: GUARD }] });
const mergedIn = (session) => mergeDuplicateFindings([atOrder('o-1', 10), atOrder('o-2', 40)],
  { sourcesOf: (eventId) => codeSourceTexts(session, eventId) }).merged;

test('L5 review F2: a quote on both sides of a first edit, or in two changes of one event, is not one place', () => {
  const kept = editSession([{ priorState: 'first-write',
    before: `function refund(order, amount) {\n  ${GUARD}\n  return pay(amount);\n}`,
    after: `  ${GUARD}\n  return pay(Math.min(amount, order.balance));` }]);
  const added = editSession([{ priorState: 'first-write',
    before: `function refund(order, amount) {\n  ${GUARD}\n  return pay(amount);\n}\nfunction charge(order, amount) {\n}`,
    after: `function charge(order, amount) {\n  ${GUARD}\n}` }]);
  const sideCounts = (session) => codeSourceTexts(session, 'A1').map((text) => text.split(GUARD).length - 1);
  assert.deepEqual(sideCounts(kept), [1, 1], 'premise: the kept guard is once on each side');
  assert.deepEqual(sideCounts(added), [1, 1], 'premise: the added second guard records the same counts');
  assert.equal(mergedIn(kept), 0);
  assert.equal(mergedIn(added), 0, 'two guards in the file after the edit: two places, never merged');
  const twoEntries = editSession([
    { priorState: 'edit-text', before: 'return pay(amount);', after: `${GUARD}\nreturn pay(amount);` },
    { priorState: 'edit-text', before: 'return charge(amount);', after: `${GUARD}\nreturn charge(amount);` }]);
  assert.deepEqual(sideCounts(twoEntries), [1, 0, 1, 0], 'premise: each change wrote it once');
  assert.equal(mergedIn(twoEntries), 0, 'two changes of one event are two places');
  assert.equal(mergedIn(editSession([{ priorState: 'none', after: `${GUARD}\nreturn pay(amount);` }])), 1,
    'premise: written once and held nowhere else, it is one place and merges');
});

test('F94 risk: the W3b four-framings quote is one place, so that case still merges', () => {
  assert.equal(LEDGER_SOURCE.split(SAME_HUNK.quote).length - 1, 1, 'premise: the shared quote is in the source once');
  assert.equal(mergeDuplicateFindings([framing('v-1', 'a', 496, 496), framing('v-2', 'b', 503, 503)], { sourcesOf }).merged, 1);
});

test('an unmerged report says nothing about merging (W3-6)', () => {
  const report = ledgerOf([codeFinding()]);
  assert.equal(report.counts.findingsMerged, 0);
  assert.ok(!renderReview({ ...report, session: null }).includes('also reported as'));
});

// ---- what must never merge -----------------------------------------------------------------

test('a code finding and a session finding never merge, however alike they look (W3-6)', () => {
  const code = codeFinding();
  const session = codeFinding({ id: 'f-d', origin: 'session-review',
    title: 'the agent said it fixed the backslash and did not' });
  const { findings, merged } = mergeDuplicateFindings([code, session]);
  assert.equal(merged, 0, 'origin is part of the identity: two capabilities, two claims');
  assert.equal(findings.length, 2);
});

test('two kinds on the same lines never merge (W3-6)', () => {
  const { findings, merged } = mergeDuplicateFindings([
    codeFinding(),
    codeFinding({ id: 'f-e', kind: 'claim_contradicted', title: 'a contradicted claim' }),
  ]);
  assert.equal(merged, 0, 'a different kind is a different defect at the same place');
  assert.equal(findings.length, 2);
});

test('two files never merge, even at identical line numbers (W3-6)', () => {
  const { merged } = mergeDuplicateFindings([
    codeFinding(),
    codeFinding({ id: 'f-f', anchor: { path: 'packages/cli/src/pr-review.js', side: 'RIGHT',
      startLine: 33, endLine: 44 } }),
  ]);
  assert.equal(merged, 0);
});

test('an anchored finding never absorbs an unanchored one (W3-6)', () => {
  const { merged } = mergeDuplicateFindings([codeFinding(), codeFinding({ id: 'f-g', anchor: null })]);
  assert.equal(merged, 0, 'a claim about a line and a claim about the session are not the same claim');
});

// ---- session findings have no lines, so their receipts are the identity --------------------

const sessionFinding = (over = {}) => ({
  origin: 'session-review', kind: 'claim_contradicted', title: 'the summary contradicts the run',
  explanation: 'e', scope: 'session-effect', status: 'DECIDE', anchor: null,
  receipts: [{ role: 'commentary', eventId: 'S4', quote: 'all tests pass' },
    { role: 'observation', eventId: 'S5', quote: '1 failing' }],
  id: 's-a', ...over,
});

test('session findings resting on exactly the same events merge (W3-6)', () => {
  const { findings, merged } = mergeDuplicateFindings([
    sessionFinding(),
    sessionFinding({ id: 's-b', title: 'the agent reported a green suite over a red one',
      receipts: [...sessionFinding().receipts, { role: 'observation', eventId: 'S5', quote: 'exit 1' }] }),
  ]);
  assert.equal(merged, 1);
  assert.equal(findings[0].title, 'the agent reported a green suite over a red one');
  assert.deepEqual(findings[0].alsoReportedAs, ['the summary contradicts the run']);
});

test('session findings on different events stay two (W3-6)', () => {
  const { merged } = mergeDuplicateFindings([
    sessionFinding(),
    sessionFinding({ id: 's-c', receipts: [{ role: 'commentary', eventId: 'S9', quote: 'all tests pass' },
      { role: 'observation', eventId: 'S10', quote: '1 failing' }] }),
  ]);
  assert.equal(merged, 0);
});

// ---- a merge must not soften a verdict ------------------------------------------------------

test('merging never downgrades DECIDE to FYI (W3-6)', () => {
  const { findings } = mergeDuplicateFindings([
    codeFinding({ status: 'FYI', receipts: [...codeFinding().receipts, { role: 'code',
      eventId: 'rev:github.js', quote: 'escapeCode' }] }),
    codeFinding({ id: 'f-h', status: 'DECIDE', title: 'the same defect, reported as blocking' }),
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].status, 'DECIDE',
    'the survivor carried more receipts but the weaker status; a merge must not clear a decision');
});
