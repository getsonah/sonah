// D104 (F5 part 4, the mark): the synthetic sessions and the review the shown-in-part tests share — the evidence
// package's (d104-seen-in-part.test.js) and the readers' (render/test/d104-seen-in-part-render.test.js). Every string
// here is invented. No recording, no model, no network.
import { Session } from '../src/session.js';
import { eventView, windowSettingsOf, bytesOfTokens, WINDOW_SETTINGS } from '../src/windows.js';
import { planWindowRequests, runReview } from '../src/run-review.js';
import { citedEventIds } from '../src/prompt.js';
import { SEEN_IN_PART_SOURCES } from '../src/seen-in-part.js';

export const refs = (blobs) => {
  let n = 0;
  return (text) => {
    const key = `b${++n}`;
    blobs[key] = text;
    return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
  };
};
export const receipt = (eventId, role, quote) => ({ eventId, role, quote });
export const OK = `ok ${'.'.repeat(40)}`;
/** `n` lines of about 53 bytes, `odd` at line `at` (1-based). 1,000 lines are past twice Claude Code's 12,000. */
export const long = (n, at, odd, tag = 'line') => Array.from({ length: n }, (_, k) => `${tag} ${k + 1}: `
  + `${k + 1 === at ? odd : OK}`).join('\n');
export const MIDDLE = 'SYNTHETIC_D104_MIDDLE: 1 failing';
export const SUITE = long(1_000, 500, MIDDLE);
export const LINT = long(1_000, 500, 'SYNTHETIC_D104_LINT: one warning', 'lint');
export const CONFIG = long(1_000, 500, 'workers = 12', 'config');
export const E2E = long(1_000, 500, 'SYNTHETIC_D104_E2E: 2 failing', 'e2e');
export const SHORT = 'SYNTHETIC_D104_SHORT: built in 2 s';
export const CLOSING = 'SYNTHETIC_D104_CLOSING: The build is done. The suite and the lint ran. The config is read. '
  + 'The e2e run is over.';

export const builders = (ref, turn) => ({
  asked: (id, text) => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(text), turn }),
  said: (id, text, phase = 'final') => ({ id, kind: 'commentary', phase, beforeInvocation: null, text: ref(text), turn }),
  command: (id, text) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
    command: ref(text), input: [], changes: [], turn }),
  read: (id, path) => ({ id, kind: 'invocation', callKey: id, tool: 'Read', operation: 'read', paths: [{ path }],
    command: [], input: [], changes: [], turn }),
  result: (id, invocation, output, failed = false) => ({ id, kind: 'observation', invocation, callKey: invocation,
    phase: 'terminal', result: failed ? 'failed' : 'succeeded', exitCode: failed ? 1 : 0, terminalStatusProven: true,
    sourceOfResult: 'native', output: ref(output), turn }),
});

/** One turn: the ask, a long suite run that failed (its failing line in the cut middle), a long lint run that failed, a
 *  short build, a long file read, a long end-to-end run that failed, and the closing message. */
export function oneTurn(adapter = 'claude') {
  const blobs = {};
  const { asked, said, command, read, result } = builders(refs(blobs), 'T1');
  const events = [asked('I1', 'SYNTHETIC_D104_ASK: run the suite, the lint and the build, and tell me.'),
    command('A1', 'npm test'), result('A1-r', 'A1', SUITE, true),
    command('A2', 'npm run lint'), result('A2-r', 'A2', LINT, true),
    command('A3', 'npm run build'), result('A3-r', 'A3', SHORT),
    read('R1', 'config.txt'), result('R1-r', 'R1', CONFIG),
    command('A4', 'npm run e2e'), result('A4-r', 'A4', E2E, true),
    said('C1', CLOSING)].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: `d104-${adapter}`, adapter, blobs, events, children: [] });
}

/** Two turns in two windows, each with its own long result and a long working message: each turn fits a window's work
 *  budget, and the two together do not. */
export function twoTurns() {
  const blobs = {};
  const ref = refs(blobs);
  const one = builders(ref, 'T1'), two = builders(ref, 'T2');
  const pad = `SYNTHETIC_D104_PAD:${'x'.repeat(bytesOfTokens(WINDOW_SETTINGS.workTokens) * 0.55)}`;
  const events = [one.asked('I1', 'SYNTHETIC_D104_ASK: run the suite.'), one.command('A1', 'npm test'),
    one.result('A1-r', 'A1', SUITE, true), one.said('P1', pad, 'working'), one.said('C1', 'SYNTHETIC_D104_CLOSING: ran.'),
    two.asked('I2', 'SYNTHETIC_D104_NEXT: run the lint.'), two.command('A2', 'npm run lint'),
    two.result('A2-r', 'A2', LINT), two.said('P2', pad, 'working'), two.said('C2', 'SYNTHETIC_D104_DONE: The lint ran.')]
    .map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: 'd104-two', adapter: 'claude', blobs, events, children: [] });
}

/** One line of exactly 30,011 bytes: past twice Claude Code's skim of 12,000 bytes a side, so the cut falls inside it. */
export const ONE_LINE = (() => { const lead = 'SYNTHETIC_D104_ONE:'; return lead + 'z'.repeat(30_011 - lead.length); })();
/** A first line of 15,020 bytes, then 1,000 short lines: the head ends inside line 1, the tail on a whole line. */
export const WIDE_FIRST = `SYNTHETIC_D104_WIDE:${'y'.repeat(15_000)}\n${long(1_000, 500, 'x', 'wide')}`;
/** The read's output: the file's lines 101 to 1,100, as a numbered read records them. */
export const BIG_READ = long(1_000, 500, 'SYNTHETIC_D104_BIG: the middle', 'big');
export const PASSING = long(1_000, 500, 'SYNTHETIC_D104_PASS: all passed', 'test');

/** One turn whose cuts take each shape: a one-line output cut inside its line (a failed run), a failed run whose first
 *  line is longer than the skim's side, a numbered read from line 101 of its file, and a long run that passed (exit 0,
 *  before any edit: the Runs list does not name it), then the closing message. */
export function cutShapes() {
  const blobs = {};
  const { asked, said, command, read, result } = builders(refs(blobs), 'T1');
  const events = [asked('I1', 'SYNTHETIC_D104_ASK: dump the data, read the big file and run the suite.'),
    command('A5', 'node dump.js'), result('A5-r', 'A5', ONE_LINE, true),
    command('A6', 'node report.js'), result('A6-r', 'A6', WIDE_FIRST, true),
    { ...read('R2', 'big.txt'), recorded: { tool: 'Read', read: { startLine: 101, numLines: 1_000, totalLines: 2_000 } } },
    result('R2-r', 'R2', BIG_READ),
    command('A7', 'npm test'), result('A7-r', 'A7', PASSING),
    said('C1', 'SYNTHETIC_D104_CLOSING: The suite passed. The big file is read.')]
    .map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: 'd104-shapes', adapter: 'claude', blobs, events, children: [] });
}
/** The claims `cutShapes` answers: one confirmed by the passing run's first line, one by the read's first line. Code
 *  keeps a not-checked failure row for each failed run. */
export const CUT_ROWS = Object.freeze({
  claims: [{ text: 'The suite passed.', stated: receipt('C1', 'commentary', 'The suite passed.'),
    supportedBy: receipt('A7-r', 'observation', `test 1: ${OK}`) },
  { text: 'The big file is read.', stated: receipt('C1', 'commentary', 'The big file is read.'),
    supportedBy: receipt('R2-r', 'observation', `big 1: ${OK}`) }],
});

const empty = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });
const ALIASED = ['instruction', 'deliverable', 'shortfall', 'response', 'stated', 'contradictedBy', 'supportedBy'];
/** A proposal with every receipt's event (and a failure row's RESULT) named by the window's alias `a`. */
const aliased = (a, row) => Object.fromEntries(Object.entries(row).map(([field, value]) => [field,
  ALIASED.includes(field) && value ? { ...value, eventId: a(value.eventId) } : field === 'eventId' ? a(value) : value]));
const voteReceipt = ({ candidate }) => candidate.response ?? candidate.deliverable ?? candidate.contradictedBy
  ?? candidate.supportedBy ?? candidate.stated ?? candidate.instruction;

/** A session-only review of `s` whose window `k` (1-based) answers `members[k - 1]`, every challenge upholding each item
 *  with its own receipt; `failWindow` (1-based) answers nothing a reader can read. */
export async function reviewed(s, members, { failWindow = null } = {}) {
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const judge = async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key,
      verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [voteReceipt(item)] })) };
    const k = Number(/^narrative:w(\d+)/.exec(request.label)?.[1]);
    if (k === failWindow) return null;
    const a = (id) => plan.requests[k - 1].aliases.of(id);
    return { ...empty(), ...Object.fromEntries(Object.entries(members[k - 1] ?? {})
      .map(([member, rows]) => [member, rows.map((row) => aliased(a, row))])) };
  };
  return { plan, report: await runReview({ session: s, pr: null, reviewScope: 'session-only', plan, judge }) };
}

const ASK = receipt('I1', 'instruction', 'SYNTHETIC_D104_ASK: run the suite, the lint and the build');
/**
 * Rows of every kind the readers place, citing long and short results of `oneTurn`:
 *   - asks: done, its deliverable the suite's shown first line (long); done, its deliverable the suite's cut middle (not
 *     found where the window showed it: lowered to not checked, with no deliverable); done, its deliverable the build
 *     (short);
 *   - claims: confirmed by the lint's shown first line (long), by the build (short), by the config file's first line (a
 *     long read, no command);
 *   - failure rows: the suite told to you, the lint not checked, the end-to-end run passed over (each a long result).
 */
export const ROWS = Object.freeze({
  requirements: [{ text: 'Run the suite.', instruction: ASK, status: 'done',
    deliverable: receipt('A1-r', 'observation', `line 1: ${OK}`) },
  { text: 'Run the lint.', instruction: receipt('I1', 'instruction', 'the lint'), status: 'done',
    deliverable: receipt('A1-r', 'observation', MIDDLE) },
  { text: 'Run the build.', instruction: receipt('I1', 'instruction', 'the build'), status: 'done',
    deliverable: receipt('A3-r', 'observation', SHORT) }],
  claims: [{ text: 'The lint ran.', stated: receipt('C1', 'commentary', 'The suite and the lint ran.'),
    supportedBy: receipt('A2-r', 'observation', `lint 1: ${OK}`) },
  { text: 'The build is done.', stated: receipt('C1', 'commentary', 'The build is done.'),
    supportedBy: receipt('A3-r', 'observation', SHORT) },
  { text: 'The config is read.', stated: receipt('C1', 'commentary', 'The config is read.'),
    supportedBy: receipt('R1-r', 'observation', `config 1: ${OK}`) }],
  failures: [{ eventId: 'A1-r', handling: 'told-human', response: receipt('C1', 'commentary', 'The suite and the lint ran.') },
    { eventId: 'A2-r', handling: 'not-checked' },
    { eventId: 'A4-r', handling: 'passed-over', response: receipt('C1', 'commentary', 'The e2e run is over.') }],
});

/** Apart from the evidence package: the results the review's window cut (its settings, `eventView`), and each row that
 *  cites one of them by event id, as `source:index`. */
export function citingCut(s, report) {
  const settings = windowSettingsOf('session-only', undefined, s.adapter);
  const cut = new Set(s.events.filter((event) => event.kind === 'observation'
    && eventView(s, event, settings).fields[0].omitted).map((event) => event.id));
  const rows = [];
  for (const source of SEEN_IN_PART_SOURCES) for (const [index, row] of (report[source] ?? []).entries())
    if ([...citedEventIds(row)].some((id) => cut.has(id))) rows.push(`${source}:${index}`);
  return { cut, rows };
}
/** The ids of every result some window of a report records as seen in part, each window's list in order. */
export const recordedIds = (report) => report.windowResults.map((w) => (w.seenInPart ?? []).map((seen) => seen.eventId));
/** The rows of a report that carry the mark, as `source:index`. */
export const markedRows = (report) => SEEN_IN_PART_SOURCES.flatMap((source) => (report[source] ?? [])
  .map((row, index) => (Array.isArray(row.seenInPart) ? `${source}:${index}` : null)).filter(Boolean));
