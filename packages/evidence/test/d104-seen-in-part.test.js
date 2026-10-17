// D104 (owner pick 2026-10-17; F5 part 4, the mark): each row of the session review whose evidence cites a result that a
// request showed only in part carries a mark naming the lines left out and the result's place; the report counts the
// results the session review saw only in part, as the sum over its windows, in a closed cause that never caps coverage;
// a settled row keeps its status and carries the mark.
//
// Invariants, as tests: a window lists exactly its own results its request cut, with the facts its omission line names
// (the lines and bytes, a line shown in part, a numbered read's file lines); the report's count is the sum over its
// windows' records, and every result a row is marked for is recorded on exactly one window (one carried from a window
// the session review did not read included); the marked rows are exactly the rows that cite a cut result (computed
// apart, from the window's cut); the mark moves nothing else of a row; a window the session review did not read counts
// none of its own; the coverage, the review's completion and the capping causes do not move; the same review marks the
// same bytes.
//
// Synthetic sessions and judges only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { eventView, windowSettingsOf, bytesOfTokens } from '../src/windows.js';
import { planWindowRequests } from '../src/run-review.js';
import { citedEventIds } from '../src/prompt.js';
import { coverageCauses, uncappedCauses, UNCAPPED_CAUSES, COVERAGE_CAUSES, COVERAGE_SENTENCE } from '../src/review.js';
import { coverageFrom } from '../src/ledger.js';
import { SEEN_IN_PART_SOURCES, shownInPart, seenInPartOfWindows, rowSeenInPart, markSeenInPart, seenInPartOf }
  from '../src/seen-in-part.js';
import { refs, receipt, OK, long, MIDDLE, SUITE, SHORT, builders, oneTurn, twoTurns, cutShapes, reviewed, ROWS, CUT_ROWS,
  citingCut, markedRows, recordedIds } from './d104-seen-in-part-fixture.js';

/** The results one planned window records as seen in part, its narrative answered. */
const ownCut = (s, built) => seenInPartOfWindows(s, [{ answered: true, events: built.window.events,
  shownIds: Object.keys(built.sourceMap ?? {}), settings: built.settings }]).records[0];
/** The words of the request's own omission line for one recorded cut (prompt.js `omittedLine`). */
const omissionNamed = (seen) => {
  const range = (a, b) => (a === b ? `line ${a.toLocaleString('en-US')}`
    : `lines ${a.toLocaleString('en-US')}–${b.toLocaleString('en-US')}`);
  const part = [...new Set([seen.partFrom ? seen.fromLine : null, seen.partThrough ? seen.throughLine : null]
    .filter((n) => n !== null))].map((n) => `line ${n.toLocaleString('en-US')}`);
  return `omitted: ${range(seen.fromLine, seen.throughLine)} of this output`
    + `${seen.fileLines ? ` (file ${range(seen.fileLines.from, seen.fileLines.through)})` : ''}, `
    + `${seen.bytes.toLocaleString('en-US')} UTF-8 bytes, ${seen.fromLine === seen.throughLine ? 'is' : 'are'} not shown`
    + `${part.length ? `; ${part.join(' and ')} in part` : ''}`;
};
/** Every result a report's rows are marked for is recorded on exactly one window, and the count is their sum. */
function assertCounted(report) {
  const recorded = recordedIds(report).flat();
  assert.equal(new Set(recorded).size, recorded.length, 'no result is recorded on two windows');
  assert.equal(report.coverageFacts.resultsSeenInPart ?? 0, recorded.length, 'the count is the sum over the windows');
  for (const key of markedRows(report)) {
    const [source, at] = key.split(':');
    for (const seen of report[source][Number(at)].seenInPart) assert.ok(recorded.includes(seen.eventId),
      `${key}: ${seen.eventId} is counted`);
  }
}

// ---- the window's cut ------------------------------------------------------------------------------------------------

test('D104 a window lists exactly its own results its request cut, with the facts its omission line names', () => {
  for (const [adapter, s] of [['claude', oneTurn()], ['codex', oneTurn('codex')], ['claude', cutShapes()]]) {
    const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
    const [built] = plan.requests;
    const listed = ownCut(s, built);
    const long = s.events.filter((event) => event.kind === 'observation'
      && eventView(s, event, built.settings).fields[0].omitted).map((event) => event.id);
    assert.deepEqual(listed.map((seen) => seen.eventId), long, `${adapter}: the long results, in order`);
    assert.ok(long.length >= 4, 'premise: four long results');
    for (const seen of listed) {
      const view = eventView(s, s.event(seen.eventId), built.settings);
      const { omitted, omittedBytes } = view.fields[0];
      assert.deepEqual([seen.fromLine, seen.throughLine, seen.partFrom, seen.partThrough, seen.fileLines, seen.bytes],
        [omitted.fromLine, omitted.throughLine, omitted.partFrom, omitted.partThrough, view.fileLines, omittedBytes]);
      assert.equal(seen.sequence, s.event(seen.eventId).sequence, 'its place in the recording');
      // The very facts the window's request names on the result's omission line.
      assert.ok(built.request.prompt.includes(omissionNamed(seen)), `${adapter}: ${omissionNamed(seen)}`);
    }
    // The skim is the harness's: Codex keeps more of the middle out.
    if (adapter === 'codex') assert.ok(listed[0].bytes > 40_000);
    assert.equal(shownInPart(s, s.event('A1'), built.settings), null, 'an action is no result');
    assert.equal(shownInPart(s, s.event(long[0]), null), null, 'no settings: everything whole');
  }
  const s = oneTurn();
  assert.equal(shownInPart(s, s.event('A3-r'), planWindowRequests({ session: s, reviewScope: 'session-only' })
    .requests[0].settings), null, 'a short result is shown whole');
});

test('D104 a cut inside a line and a numbered read\'s file lines are recorded as the request names them', () => {
  const s = cutShapes();
  const [built] = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests;
  const by = new Map(ownCut(s, built).map((seen) => [seen.eventId, seen]));
  // One line of 30,011 bytes at 12,000 a side: only its middle 6,011 bytes are left out, inside line 1.
  assert.deepEqual(by.get('A5-r'), { eventId: 'A5-r', sequence: 2, fromLine: 1, throughLine: 1, partFrom: true,
    partThrough: true, fileLines: null, bytes: 6_011 });
  // A first line longer than the side: the head shows its start.
  assert.deepEqual([by.get('A6-r').fromLine, by.get('A6-r').partFrom, by.get('A6-r').partThrough], [1, true, false]);
  // A read from line 101 of its file: the output's lines and the file's.
  const read = by.get('R2-r');
  assert.deepEqual(read.fileLines, { from: read.fromLine + 100, through: read.throughLine + 100 });
  assert.equal(by.get('A7-r').fileLines, null, 'a command\'s output names no file lines');
});

test('D104 a helper\'s report cut only past the work budget is a result shown in part too', () => {
  const blobs = {};
  const { asked, command, result } = builders(refs(blobs), 'T1');
  const huge = long(30_000, 15_000, MIDDLE);
  const events = [asked('I1', 'SYNTHETIC_D104_ASK: ask two helpers.'), command('D1', 'delegate'),
    { ...result('D1-r', 'D1', huge), helperReported: true }, command('D2', 'delegate'),
    { ...result('D2-r', 'D2', SUITE), helperReported: true }].map((event, sequence) => ({ ...event, sequence }));
  const s = new Session({ sessionKey: 'd104-helper', adapter: 'claude', blobs, events, children: [] });
  const settings = windowSettingsOf('session-only', undefined, 'claude');
  assert.ok(Buffer.byteLength(huge) > bytesOfTokens(settings.workTokens), 'premise: past the work budget');
  const seen = shownInPart(s, s.event('D1-r'), settings);
  assert.ok(seen && seen.bytes > 0 && seen.fromLine > 1);
  assert.equal(shownInPart(s, s.event('D2-r'), settings), null, 'a report within the budget is shown whole');
});

// ---- the count -------------------------------------------------------------------------------------------------------

test('D104 the report counts the results seen in part as the sum over its windows\' records', async () => {
  const s = twoTurns();
  const { plan, report } = await reviewed(s, [{}, {}]);
  assert.equal(plan.windows.length, 2, 'premise: two windows');
  // The second window carries the first's failed suite run, shown in part too: it is the first window's, counted once.
  assert.ok(Object.hasOwn(plan.requests[1].sourceMap, 'A1-r'), 'premise: the second window carries the suite run');
  assert.deepEqual(recordedIds(report), [['A1-r'], ['A2-r']]);
  assert.equal(report.coverageFacts.resultsSeenInPart, 2);
  assertCounted(report);
});

test('D104 a result carried from a window the session review did not read is counted where it was read, and marked', async () => {
  const s = twoTurns();
  // The second window states a claim and cites the suite run its request carried, shown in part, as contradicting it.
  const w2 = { claims: [{ text: 'The lint ran.', stated: receipt('C2', 'commentary', 'SYNTHETIC_D104_DONE: The lint ran.'),
    contradictedBy: receipt('A1-r', 'observation', `line 1: ${OK}`) }] };
  const { report } = await reviewed(s, [{}, w2], { failWindow: 1 });
  assert.notEqual(report.windowResults[0].failure, null, 'premise: the first window was not read');
  const finding = report.findings.find((row) => row.receipts.some((rc) => rc.eventId === 'A1-r'));
  assert.ok(finding, 'premise: the finding cites the carried result');
  assert.deepEqual(finding.seenInPart.map((seen) => seen.eventId), ['A1-r'], 'the row cites a carried result: marked');
  // Counted on the window that read it, so the count holds every result a row is marked for.
  assert.deepEqual(recordedIds(report), [[], ['A1-r', 'A2-r']]);
  assert.equal(report.coverageFacts.resultsSeenInPart, 2);
  assertCounted(report);
});

test('D104 a window the session review did not read counts no result and carries no list', async () => {
  const s = twoTurns();
  const { report } = await reviewed(s, [{}, {}], { failWindow: 2 });
  assert.notEqual(report.windowResults[1].failure, null, 'premise: the second window was not read');
  assert.equal(Object.hasOwn(report.windowResults[1], 'seenInPart'), false);
  assert.deepEqual(report.windowResults[0].seenInPart.map((seen) => seen.eventId), ['A1-r']);
  assert.equal(report.coverageFacts.resultsSeenInPart, 1);
  assertCounted(report);
});

test('D104 a review with no result cut counts none and its facts keep their bytes', async () => {
  const blobs = {};
  const { asked, said, command, result } = builders(refs(blobs), 'T1');
  const events = [asked('I1', 'SYNTHETIC_D104_ASK: build it.'), command('A3', 'npm run build'), result('A3-r', 'A3', SHORT),
    said('C1', 'SYNTHETIC_D104_CLOSING: The build is done.')].map((event, sequence) => ({ ...event, sequence }));
  const s = new Session({ sessionKey: 'd104-none', adapter: 'claude', blobs, events, children: [] });
  const { report } = await reviewed(s, [{}]);
  assert.equal(Object.hasOwn(report.coverageFacts, 'resultsSeenInPart'), false);
  assert.equal(Object.hasOwn(report.windowResults[0], 'seenInPart'), false);
  assert.deepEqual(uncappedCauses(report), []);
});

// ---- the mark --------------------------------------------------------------------------------------------------------

test('D104 the marked rows are exactly the rows that cite a result the window cut, each with that cut', async () => {
  const s = oneTurn();
  const { report } = await reviewed(s, [ROWS]);
  const apart = citingCut(s, report);
  assert.deepEqual([...apart.cut].sort(), ['A1-r', 'A2-r', 'A4-r', 'R1-r']);
  assert.deepEqual(apart.rows, ['requirements:0', 'failures:0', 'failures:1', 'failures:2', 'promises:0', 'promises:2'],
    'premise: rows cite cut results');
  assert.deepEqual(markedRows(report), apart.rows, 'marked = citing a cut result');
  const index = new Map(report.windowResults.flatMap((w) => w.seenInPart ?? []).map((seen) => [seen.eventId, seen]));
  for (const source of SEEN_IN_PART_SOURCES) for (const row of report[source] ?? []) {
    if (!row.seenInPart) continue;
    const cited = [...citedEventIds({ ...row, seenInPart: undefined })].filter((id) => apart.cut.has(id));
    assert.deepEqual(row.seenInPart.map((seen) => seen.eventId), [...new Set(cited)].sort((a, b) =>
      s.event(a).sequence - s.event(b).sequence));
    for (const seen of row.seenInPart) assert.deepEqual(seen, index.get(seen.eventId), 'the window\'s own cut');
    assert.deepEqual(seenInPartOf(row), row.seenInPart, 'a reader reads it as written');
  }
  // A row that cites only a short result carries no mark.
  const build = report.requirements.find((row) => row.deliverable?.eventId === 'A3-r');
  assert.ok(build && !Object.hasOwn(build, 'seenInPart'));
  assertCounted(report);
});

test('D104 a settled row keeps its status and carries the mark; a not-checked row that cites the result carries it too', async () => {
  const s = oneTurn();
  const { report } = await reviewed(s, [ROWS]);
  const suite = report.requirements.find((row) => row.deliverable?.quote === `line 1: ${OK}`);
  assert.deepEqual([suite.status, suite.reason ?? null, suite.seenInPart.map((seen) => seen.eventId)],
    ['done', null, ['A1-r']]);
  const claim = report.promises.find((row) => row.receipts.some((rc) => rc.eventId === 'A2-r'));
  assert.deepEqual([claim.status, claim.seenInPart.map((seen) => seen.eventId)], ['verified', ['A2-r']]);
  const told = report.failures.find((row) => row.eventId === 'A1-r');
  assert.deepEqual([told.handling, told.seenInPart.map((seen) => seen.eventId)], ['told-human', ['A1-r']]);
  // The failure row the session review could not check names its own result, which the window cut.
  const open = report.failures.find((row) => row.eventId === 'A2-r');
  assert.deepEqual([open.handling, open.seenInPart.map((seen) => seen.eventId)], ['not-checked', ['A2-r']]);
  // A row code lowered keeps no receipt (D71 b: the weakest status needs none), so it cites no result and carries no
  // mark, though the deliverable it lost named the cut result.
  const lint = report.requirements.find((row) => row.instruction.quote === 'the lint');
  assert.deepEqual([lint.status, lint.reason, Object.hasOwn(lint, 'deliverable'), Object.hasOwn(lint, 'seenInPart')],
    ['not-checked', 'deliverable_ungrounded', false, false]);
});

test('D104 the mark moves nothing else of a row, and marking again gives the same rows', () => {
  const seen = { eventId: 'R1', sequence: 4, fromLine: 10, throughLine: 90, partFrom: false, partThrough: false,
    fileLines: { from: 110, through: 190 }, bytes: 4_000 };
  const index = new Map([['R1', seen]]);
  const rows = {
    requirements: [{ status: 'done', deliverable: receipt('R1', 'observation', 'x') }, { status: 'done',
      deliverable: receipt('R2', 'observation', 'y') }],
    failures: [{ eventId: 'R1', handling: 'not-checked', reason: 'challenge_unsettled' }],
    decisions: [{ id: 'd', actions: ['R1'], stated: receipt('C1', 'commentary', 'z') }],
    promises: [{ status: 'open', stated: receipt('C1', 'commentary', 'z'), seenInPart: [seen] }],
    codePass: { findings: [{ trace: [receipt('R1', 'observation', 'x')] }] },
  };
  const before = structuredClone(rows);
  const report = structuredClone(rows);
  assert.equal(markSeenInPart(report, index), 3);
  const strip = (value) => JSON.parse(JSON.stringify(value, (key, v) => (key === 'seenInPart' ? undefined : v)));
  assert.deepEqual(strip(report), strip(before), 'every other field as it was');
  assert.deepEqual(report.requirements.map((row) => Boolean(row.seenInPart)), [true, false]);
  assert.deepEqual(report.failures[0].seenInPart, [seen]);
  assert.equal(Boolean(report.decisions[0].seenInPart), true, 'an id a row names is cited, as a challenge reads it');
  assert.equal(Object.hasOwn(report.promises[0], 'seenInPart'), false, 'a stale mark is never kept');
  assert.equal(Object.hasOwn(report.codePass.findings[0], 'seenInPart'), false, 'the code step\'s rows carry none');
  const again = structuredClone(report);
  markSeenInPart(again, index);
  assert.deepEqual(again, report);
  assert.notEqual(report.failures[0].seenInPart[0], seen, 'a copy, never the index\'s own entry');
  assert.notEqual(report.failures[0].seenInPart[0].fileLines, seen.fileLines, 'its file lines too');
});

test('D104 each result is recorded once: on its own window, or on the first later window that read it carried', () => {
  const s = twoTurns();
  const settings = windowSettingsOf('session-only', undefined, 'claude');
  const turn = (t) => s.events.filter((event) => event.turn === t);
  const windows = (first) => [{ answered: first, events: turn('T1'), shownIds: turn('T1').map((event) => event.id), settings },
    { answered: true, events: turn('T2'), shownIds: ['I2', 'A2-r', 'A1-r', 'nowhere'], settings }];
  // Both read: each window records its own; the carried copy is not counted again.
  const both = seenInPartOfWindows(s, windows(true));
  assert.deepEqual(both.records.map((list) => list.map((seen) => seen.eventId)), [['A1-r'], ['A2-r']]);
  // The first not read: the second records the result it carried, so the count still holds it.
  const one = seenInPartOfWindows(s, windows(false));
  assert.deepEqual(one.records.map((list) => list.map((seen) => seen.eventId)), [[], ['A1-r', 'A2-r']]);
  for (const run of [both, one]) assert.deepEqual([...run.index.keys()].sort(),
    run.records.flat().map((seen) => seen.eventId).sort(), 'the index holds exactly the recorded results');
  assert.deepEqual(rowSeenInPart({ contradictedBy: receipt('A1-r', 'observation', 'x') }, one.index).map((x) => x.eventId),
    ['A1-r']);
  assert.deepEqual(rowSeenInPart({ stated: receipt('I2', 'instruction', 'x') }, one.index), []);
  assert.deepEqual(rowSeenInPart(null, one.index), []);
  assert.deepEqual(rowSeenInPart({ eventId: 'A2-r' }, new Map()), []);
  assert.deepEqual(seenInPartOfWindows(s, null), { records: [], index: new Map() });
});

test('D104 a reader keeps only marks of the form this package writes', () => {
  const good = { eventId: 'R1', sequence: 3, fromLine: 2, throughLine: 9, partFrom: true, partThrough: false,
    fileLines: null, bytes: 100 };
  const row = { seenInPart: [good, { ...good }, { ...good, eventId: 'R2', fromLine: 9, throughLine: 2 },
    { ...good, eventId: 'R3', bytes: -1 }, { ...good, eventId: '' }, null, 'R4', { ...good, eventId: 'R5', sequence: 'x' },
    { ...good, eventId: 'R0', sequence: 1 }, { ...good, eventId: 'R6', partFrom: 'yes' },
    { ...good, eventId: 'R7', partThrough: undefined }, { ...good, eventId: 'R8', fileLines: { from: 1, through: 99 } },
    { ...good, eventId: 'R9', fileLines: { from: 12, through: 19 } }, { ...good, eventId: 'R10', fileLines: undefined }] };
  assert.deepEqual(seenInPartOf(row).map((seen) => [seen.eventId, seen.sequence]),
    [['R0', 1], ['R1', 3], ['R9', 3], ['R5', null]]);
  assert.deepEqual(seenInPartOf(row).find((seen) => seen.eventId === 'R9').fileLines, { from: 12, through: 19 });
  assert.deepEqual(seenInPartOf({ seenInPart: 'R1' }), []);
  assert.deepEqual(seenInPartOf(null), []);
});

// ---- the cause --------------------------------------------------------------------------------------------------------

test('D104 the closed cause counts the results seen in part and never caps the coverage or the review', async () => {
  const s = oneTurn();
  const { report } = await reviewed(s, [ROWS]);
  assert.equal(report.coverageFacts.resultsSeenInPart, 4);
  assert.equal(coverageFrom(report.coverageFacts), 'complete');
  assert.deepEqual([report.coverage, report.sessionReview], ['complete', 'complete']);
  assert.deepEqual(coverageCauses(report), [], 'no capping cause names it');
  assert.deepEqual(uncappedCauses(report), [['results_seen_in_part', { n: 4 }]]);
  assert.ok(COVERAGE_CAUSES.includes('results_seen_in_part') && UNCAPPED_CAUSES.every((cause) => COVERAGE_CAUSES
    .includes(cause)));
  assert.equal(COVERAGE_SENTENCE.results_seen_in_part({ n: 2 }),
    'Sonah first showed the session review only part of 2 recorded results');
  assert.equal(COVERAGE_SENTENCE.results_seen_in_part({ n: 1 }),
    'Sonah first showed the session review only part of 1 recorded result');
});

test('D104 the same review marks the same bytes', async () => {
  const one = (await reviewed(oneTurn(), [ROWS])).report;
  const two = (await reviewed(oneTurn(), [ROWS])).report;
  const marks = (report) => JSON.stringify([report.coverageFacts, report.windowResults.map((w) => w.seenInPart ?? null),
    ...SEEN_IN_PART_SOURCES.map((source) => (report[source] ?? []).map((row) => row.seenInPart ?? null))]);
  assert.equal(marks(one), marks(two));
});
