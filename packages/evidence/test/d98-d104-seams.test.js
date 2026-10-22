// The seams between D98-D100 (one reading per recorder fact, an absence only where code proves it, the audit of absence
// sentences), D101 (say which test refused a quote) and D102-D104 (the evidence merge, the skim keyed by the recording's
// harness, the shown-in-part mark), which were built apart and joined after their reviews. Each test holds one place
// where two of them meet, and fails if either side stops holding its part there:
//   1. D101 beside D103 and D104: the quote gate searches what the window showed under the skim of the recording's
//      harness; a quote in the part the window cut reads `not_found` at the place cited, and the same cut is the mark the
//      run's failure row carries next to its own cause, in the evidence and in every reader.
//   2. D99 inside D102: an end Sonah could not read lowers a re-asked window's copy of an ask by its own reason, so the
//      merge keeps the first answer's copy that passed that check, and a row both answers lower keeps D99's reason.
//   3. D98 inside D102: a written statement of a write refused before it ran is lowered by the merge as publication
//      withholds it, so a re-ask never replaces a first answer's statement of a write that landed.
//   4. D100 over D101 and D104: the audit of absence sentences has read every sentence the other two added, and none
//      of them stands as an absence without a proof of the reach its words claim.
//
// Synthetic sessions and judges only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, effectOf } from '../src/session.js';
import * as reviewRun from '../src/run-review.js';
import { resultOutcome, actionOutcome } from '../src/ledger.js';
import { SKIM_SIDE_BYTES, skimSideBytesOf } from '../src/windows.js';
import { CHECKLIST_GROUNDING_CAUSE_WORDS, CHECKLIST_QUOTE_ANCHOR_WORDS, CHECKLIST_REQUIREMENT_REASON_WORDS,
  COVERAGE_SENTENCE, checklistReasonWords } from '../src/review.js';
import { reportModel } from '../../render/report-model.js';
import { renderSessionPage } from '../../render/session-page.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import { REPORT_SEEN_WORDS } from '../../render/report-words.js';
import { READ_CENSUS, ABSENCE_REGISTRY, ABSENCE_HELD, ABSENCE_PROOFS, fingerprintOf }
  from '../../render/test/absence-audit.js';
import { moduleEntries } from '../../render/test/style-lint.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const KEY = 'sess-seams';
const refs = (blobs) => {
  let n = 0;
  return (text) => {
    const key = `b${++n}`;
    blobs[key] = text;
    return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
  };
};
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const empty = () => ({ decisions: [], pivots: [], claims: [], requirements: [], failures: [] });

/** The event builders of one recording (`ref` its blob writer), all in one turn. */
const builders = (ref) => ({
  asked: (id, text) => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(text), turn: 'T1' }),
  command: (id, text, recorded = undefined, extra = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash',
    operation: 'command', paths: [], command: ref(text), input: [], changes: [], turn: 'T1',
    ...(recorded ? { recorded } : {}), ...extra }),
  result: (id, invocation, output, { failed = false, proven = true } = {}) => ({ id, kind: 'observation', invocation,
    callKey: invocation, phase: 'terminal', result: failed ? 'failed' : 'succeeded',
    exitCode: proven ? (failed ? 1 : 0) : null, terminalStatusProven: proven, sourceOfResult: 'native',
    output: ref(output), turn: 'T1' }),
  write: (id, path, body, recorded = undefined) => ({ id, kind: 'invocation', callKey: id, tool: 'Write',
    operation: 'write', paths: [{ path }], command: [], input: [], turn: 'T1', ...(recorded ? { recorded } : {}),
    changes: [{ path, diff: [], before: [], after: ref(body) }] }),
  said: (id, text, phase = 'working') => ({ id, kind: 'commentary', phase, beforeInvocation: null, text: ref(text),
    turn: 'T1' }),
});

const TEXT = {
  ask: 'SYNTHETIC_SEAM_ASK: fix the parser, run the tests and start the server.',
  notes: '# Notes\nSYNTHETIC_SEAM_NOTE: the parser reads every header.\n',
  refused: '# Plan\nSYNTHETIC_SEAM_REFUSED: the parser reads every header.\n',
  passed: 'SYNTHETIC_SEAM_PASSED: 12 passing',
  serving: 'Command running in background with ID: bgseam1.',
  said: 'SYNTHETIC_SEAM_SAID: I fixed the parser and ran the tests.',
  closing: 'SYNTHETIC_SEAM_CLOSING: The parser is fixed and the server is up.',
};
/** A line of the long output, numbered from 1, each about 54 bytes. */
const lineOf = (k) => `line ${k}: ${k === 1_000 ? 'SYNTHETIC_SEAM_MIDDLE: one test timed out' : `ok ${'.'.repeat(40)}`}`;
/** A Claude Code result over twice its skim (D103: 12,000 bytes a side) many times over: 2,000 lines, its middle line
 *  1,000 in the part every skim cuts. */
const LONG = Array.from({ length: 2_000 }, (_, k) => lineOf(k + 1)).join('\n');
const MIDDLE_LINE = 1_000;
/** A line in the head the 12,000-byte skim shows and the 3,600-byte one would cut. */
const HEAD_LINE = 150;

/** One turn: the ask; a written note; a write the person refused; a long failing test run; a passing run; a server
 *  started in the background whose end Sonah could not read; a working message and the closing message. */
function session() {
  const blobs = {};
  const ref = refs(blobs);
  const { asked, command, result, write, said } = builders(ref);
  const events = [
    asked('I1', TEXT.ask),
    write('W1', '/srv/x/NOTES.md', TEXT.notes), result('W1-r', 'W1', 'file created'),
    write('R1', '/srv/x/PLAN.md', TEXT.refused, { denial: 'user-rejected' }),
    result('R1-r', 'R1', 'The user doesn\'t want to proceed with this tool use.', { failed: true }),
    command('T1', 'npm test'), result('T1-r', 'T1', LONG, { failed: true }),
    command('P1', 'npm run check'), result('P1-r', 'P1', TEXT.passed),
    command('G1', 'npm run serve', { backgroundTaskId: 'bgseam1' }, { backgroundEnd: 'unread' }),
    result('G1-r', 'G1', TEXT.serving, { proven: false }),
    said('C0', TEXT.said), said('C1', TEXT.closing, 'final'),
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs, events, children: [] });
}

const INSTRUCTION = receipt('I1', 'instruction', TEXT.ask);
const ask = (status, extra = {}) => ({ text: 'Fix the parser.', instruction: INSTRUCTION, status, ...extra });
/** A second ask of the same message, one row by its own instruction quote. */
const RUN_TESTS = receipt('I1', 'instruction', 'run the tests');
/** A row's every receipt (and a failure row's own RESULT) named by the window's alias `a`. */
const ALIASED = ['instruction', 'deliverable', 'shortfall', 'response', 'stated', 'contradictedBy', 'supportedBy'];
const aliased = (a, row) => Object.fromEntries(Object.entries(row).map(([field, value]) => [field,
  ALIASED.includes(field) && value ? { ...value, eventId: a(value.eventId) } : field === 'eventId' ? a(value) : value]));
const answerOf = (a, members) => ({ ...empty(), ...Object.fromEntries(Object.entries(members)
  .map(([member, rows]) => [member, rows.map((row) => aliased(a, row))])) });

/** A whole session-only review of `s`: its first window's answer holds `first` (and, when `reask` is given, one evidence
 *  request for the long output's middle, answered with `reask`); every challenge item is upheld with no receipt. */
async function reviewed(first, reask = null, s = session()) {
  const plan = reviewRun.planWindowRequests({ session: s, reviewScope: 'session-only' });
  const a = (id) => plan.requests[0].aliases.of(id);
  const judge = async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key,
      verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [] })) };
    if (!/^narrative:w1(:|$)/.test(request.label)) return empty();
    if (request.label.endsWith(':evidence')) return answerOf(a, reask);
    return { ...answerOf(a, first), ...(reask ? { evidenceRequests: [{ eventId: a('T1-r'), fromLine: MIDDLE_LINE - 1,
      throughLine: MIDDLE_LINE + 1 }] } : {}) };
  };
  const report = await reviewRun.runReview({ session: s, pr: null, reviewScope: 'session-only', plan, judge });
  return { s, plan, report };
}

/** The words a reader shows for a row the gate lowered, as a sentence. */
const asSentence = (words) => `${words[0].toUpperCase()}${words.slice(1)}.`;
const NOT_FOUND = CHECKLIST_GROUNDING_CAUSE_WORDS.not_found({});

test('premise: the long output is cut by the Claude Code skim, its head line within it and its middle line outside it',
  () => {
    const s = session();
    assert.equal(skimSideBytesOf(s.adapter), SKIM_SIDE_BYTES.claude);
    const head = Buffer.byteLength(Array.from({ length: HEAD_LINE }, (_, k) => lineOf(k + 1)).join('\n'), 'utf8');
    assert.ok(head < SKIM_SIDE_BYTES.claude && head > Math.min(...Object.values(SKIM_SIDE_BYTES)), String(head));
    assert.ok(Buffer.byteLength(LONG, 'utf8') > 4 * SKIM_SIDE_BYTES.claude);
    // The recorder facts each test reads: a refused write changed nothing; the server's end could not be read.
    assert.equal(effectOf(s, s.event('R1')), 'none');
    assert.equal(effectOf(s, s.event('W1')), 'landed');
    assert.equal(resultOutcome(s, s.event('G1-r')).class, 'end-unread');
    assert.equal(actionOutcome(s, s.event('G1')).class, 'end-unread');
  });

// ---- 1. D101 beside D103 and D104 ----------------------------------------------------------------------------------

test('D101 beside D104: a quote in the cut part reads not found there, and the same cut is the mark beside its cause',
  async () => {
    const middle = lineOf(MIDDLE_LINE).slice('line 1000: '.length);
    const head = lineOf(HEAD_LINE);
    const { s, report } = await reviewed({
      requirements: [
        // Quotes the long output's middle, which the window cut: the gate searched only what the window showed.
        ask('done', { deliverable: receipt('T1-r', 'observation', middle) }),
        // Quotes a head line the 12,000-byte skim shows (a 3,600-byte one would cut it): it grounds at the gate.
        { ...ask('done', { deliverable: receipt('T1-r', 'observation', head) }), text: 'Run the tests.',
          instruction: RUN_TESTS }],
      // The failed run's row: a response quote the closing message does not hold, refused at the gate.
      failures: [{ eventId: 'T1-r', handling: 'told-human',
        response: receipt('C1', 'commentary', 'SYNTHETIC_SEAM_UNSAID: one test timed out') }] });
    const [window] = report.windowResults;
    // D104: the window records the result once, its left-out lines holding the middle line and not the head line.
    const record = (window.seenInPart ?? []).find((r) => r.eventId === 'T1-r');
    assert.ok(record, JSON.stringify(window.seenInPart));
    assert.ok(record.fromLine <= MIDDLE_LINE && MIDDLE_LINE <= record.throughLine, JSON.stringify(record));
    assert.ok(HEAD_LINE < record.fromLine, JSON.stringify(record));
    assert.equal(report.coverageFacts.resultsSeenInPart, 1);
    // D101: the middle quote is refused not found, nowhere in what the window showed; the head quote passes the gate.
    const [cut, shown] = ['Fix the parser.', 'Run the tests.'].map((text) => report.requirements.find((r) => r.text === text));
    assert.deepEqual([cut.status, cut.reason, cut.cause, cut.quotePlace],
      ['not-checked', 'deliverable_ungrounded', 'not_found', 'nowhere']);
    assert.equal(shown.cause, undefined, JSON.stringify(shown));
    assert.notEqual(shown.reason, 'deliverable_ungrounded');
    // A row code lowered keeps no receipt, so the ask carries no mark (D104); the result is still counted.
    assert.equal(Object.hasOwn(cut, 'seenInPart'), false);
    // The failure row carries both: D101's cause beside D104's mark of its own result, the same cut as the window's.
    const failure = report.failures.find((row) => row.eventId === 'T1-r');
    assert.deepEqual([failure.handling, failure.reason, failure.cause],
      ['not-checked', 'response_ungrounded', 'not_found']);
    assert.deepEqual(failure.seenInPart, [record]);
    assert.equal(checklistReasonWords(failure, 'failure'), NOT_FOUND);
    // The readers: the ask's line says the cause's words; the run's failure row shows the mark; what Sonah could not
    // check counts the result. Neither replaces the other, on the page and in the .md alike.
    const model = reportModel(s, report, {});
    const askLines = model.prompt.asks.map((a) => [...a.lines, ...a.folded].map((line) => line.map((part) => part.text).join('')));
    assert.ok(askLines.some((lines) => lines.includes(asSentence(NOT_FOUND))), JSON.stringify(askLines));
    const run = model.did.runs.shown.find((r) => r.text === 'npm test');
    assert.ok(run, JSON.stringify(model.did.runs.shown.map((r) => r.text)));
    const seen = (run?.seen ?? []).map((line) => line.map((part) => part.text).join(''));
    const left = REPORT_SEEN_WORDS.cut(record);
    assert.ok(seen.some((line) => line.includes(left)), JSON.stringify(seen));
    const counted = asSentence(COVERAGE_SENTENCE.results_seen_in_part({ n: 1 }));
    for (const text of [renderSessionPage(s, report, { sessionHash: 'a'.repeat(64) }), renderReportMarkdown(s, report, {})]) {
      assert.ok(text.includes(asSentence(NOT_FOUND).slice(0, -1)), 'the cause\'s words');
      assert.ok(text.includes(left.split(' (')[0]), 'the mark\'s left-out lines');
      assert.ok(text.includes(counted.slice(0, -1)), 'the count');
    }
  });

// ---- 2. D99 inside D102 -------------------------------------------------------------------------------------------

/** The evidence re-ask's merge check on the review's first window (`mergeChecks`), by its end. */
function mergeCheck(s = session()) {
  const plan = reviewRun.planWindowRequests({ session: s, reviewScope: 'session-only' });
  const [built] = plan.requests;
  const end = Math.max(...built.window.events.map((event) => event.sequence));
  return reviewRun.mergeChecks({ session: s, sourceMap: built.sourceMap, window: built.window, windowEnd: end });
}
const START_SERVER = receipt('I1', 'instruction', 'start the server');
const serverAsk = (deliverable) => ({ text: 'Start the server.', instruction: START_SERVER, status: 'done', deliverable });
const PASSED_RUN = receipt('P1-r', 'observation', TEXT.passed);
const SERVER_RUN = receipt('G1', 'action', 'npm run serve');

test('D99 inside D102: a re-asked copy that cites an end Sonah could not read never replaces a first copy that held',
  async () => {
    // The merge reads a copy by publication's one check of an ask, D99's end reading in it.
    const { checked } = mergeCheck();
    assert.deepEqual(checked('requirements', serverAsk(SERVER_RUN)), { passed: [], lowered: ['row'] });
    assert.deepEqual(checked('requirements', serverAsk(PASSED_RUN)), { passed: ['row'], lowered: [] });
    // The re-ask's copy is lowered by D99's reason and the first copy passed that check: the first copy stands.
    const stood = (await reviewed({ requirements: [serverAsk(PASSED_RUN)] }, { requirements: [serverAsk(SERVER_RUN)] }))
      .report;
    const [window] = stood.windowResults;
    assert.equal(window.evidence.kept, 'merged', 'premise: the re-ask answered and was merged');
    assert.equal(window.evidence.firstStood, 1);
    const row = stood.requirements.find((r) => r.text === 'Start the server.');
    assert.notEqual(row.reason, 'check_end_unread', JSON.stringify(row));
    // Both copies cite the server: the row keeps D99's own reason, which no gate cause replaces, and reads its words.
    const both = await reviewed({ requirements: [serverAsk(SERVER_RUN)] }, { requirements: [serverAsk(SERVER_RUN)] });
    assert.equal(both.report.windowResults[0].evidence.firstStood, 0);
    const lowered = both.report.requirements.find((r) => r.text === 'Start the server.');
    assert.deepEqual([lowered.status, lowered.reason, lowered.cause], ['not-checked', 'check_end_unread', undefined]);
    const words = checklistReasonWords(lowered, 'requirement');
    assert.equal(words, CHECKLIST_REQUIREMENT_REASON_WORDS.check_end_unread);
    const lines = reportModel(both.s, both.report, {}).prompt.asks.flatMap((a) => [...a.lines, ...a.folded])
      .map((line) => line.map((part) => part.text).join(''));
    assert.ok(lines.includes(asSentence(words)), JSON.stringify(lines));
    // The server's run is never a failure row of the re-asked window: its end was not read, so it did not fail.
    assert.equal(both.report.failures.some((f) => f.eventId === 'G1-r'), false);
  });

// ---- 3. D98 inside D102 -------------------------------------------------------------------------------------------

/** A statement written into a file, contradicted by a line of the failing run that the window shows. */
const written = (id, quote) => ({ text: 'The notes say the parser reads every header.', stated: receipt(id, 'code', quote),
  contradictedBy: receipt('T1-r', 'observation', lineOf(2)) });
const LANDED = written('W1', 'SYNTHETIC_SEAM_NOTE: the parser reads every header.');
const REFUSED = written('R1', 'SYNTHETIC_SEAM_REFUSED: the parser reads every header.');

test('D98 inside D102: a written statement of a write refused before it ran never stands in a re-asked window',
  async () => {
    // The window shows the refused write's body, so only the one effect rule tells it apart from a write that landed.
    const plan = reviewRun.planWindowRequests({ session: session(), reviewScope: 'session-only' });
    assert.ok((plan.requests[0].sourceMap.R1 ?? []).some((source) => source.role === 'code'
      && source.text.includes(REFUSED.stated.quote)), 'premise: the refused body is shown');
    // The merge reads each copy by publication's check: the refused write's statement is lowered, the landed one is not.
    const { checked } = mergeCheck();
    assert.deepEqual(checked('writtenClaims', REFUSED), { passed: [], lowered: ['row'] });
    assert.deepEqual(checked('writtenClaims', LANDED), { passed: ['row'], lowered: [] });
    // In a re-asked window, whichever answer gives it, a statement of the refused write is withheld as not landed and
    // the landed write's statement is published; the page lists the landed file alone.
    for (const [first, reask] of [[{ writtenClaims: [LANDED] }, { writtenClaims: [REFUSED] }],
      [{ writtenClaims: [REFUSED] }, { writtenClaims: [LANDED] }]]) {
      const { s, report } = await reviewed(first, reask);
      assert.equal(report.windowResults[0].evidence.kept, 'merged', 'premise: the re-ask answered and was merged');
      assert.deepEqual(report.writtenClaims.map((w) => w.stated.eventId), ['W1']);
      assert.equal(report.withheld.causes.written_not_landed, 1);
      const files = reportModel(s, report, {}).did.files.groups.flatMap((g) => g.files.map((f) => f.path));
      assert.deepEqual(files, ['/srv/x/NOTES.md']);
    }
  });

// ---- 4. D100 over D101 and D104 -------------------------------------------------------------------------------------

/** The word keys D101 and D104 added, by the module the audit reads them in, each with its rendered texts' census. */
const ADDED = Object.freeze({
  'packages/evidence/src/review.js': [...Object.keys(CHECKLIST_GROUNDING_CAUSE_WORDS)
    .map((cause) => `CHECKLIST_GROUNDING_CAUSE_WORDS.${cause}`),
  ...Object.keys(CHECKLIST_QUOTE_ANCHOR_WORDS).map((anchor) => `CHECKLIST_QUOTE_ANCHOR_WORDS.${anchor}`),
  'COVERAGE_SENTENCE.results_seen_in_part'],
  'packages/render/report-words.js': Object.keys(REPORT_SEEN_WORDS).map((key) => `REPORT_SEEN_WORDS.${key}`),
});

test('D100 over D101 and D104: the audit read every sentence the other two added, and each stands on what it claims',
  async () => {
    const keys = Object.entries(ADDED).flatMap(([module, list]) => list.map((key) => [module, key]));
    assert.equal(keys.length, 21, 'D101: 12 causes and 2 anchors; D104: the count and 6 parts of the mark');
    for (const [module, key] of keys) {
      const read = READ_CENSUS[module]?.[key];
      assert.ok(read, `${module} ${key}: read by a person`);
      // An absence stands only on a registered proof whose code checks the reach its words claim, or is held.
      if (read[0] === 'absence') {
        const proofs = ABSENCE_REGISTRY[module]?.[key];
        assert.ok(proofs || ABSENCE_HELD[module]?.[key], `${module} ${key}: proved or held`);
        for (const [proof, scope] of Object.entries(proofs ?? {}))
          assert.ok(ABSENCE_PROOFS[proof]?.scopes.includes(scope), `${module} ${key}: ${proof} checks ${scope}`);
      }
    }
    // Their words are the words the person read: each key's rendered texts (every fixture, as the style linter renders
    // them) have the census's fingerprint. A sentence of either decision that changes fails here, as in the audit.
    for (const [module, list] of Object.entries(ADDED)) {
      const ns = await import(pathToFileURL(join(ROOT, module)).href);
      const texts = new Map();
      for (const entry of moduleEntries(module, ns).entries)
        texts.set(entry.key, [...(texts.get(entry.key) ?? []), entry.text]);
      for (const key of list) assert.equal(fingerprintOf(texts.get(key) ?? []), READ_CENSUS[module][key][1], key);
    }
  });
