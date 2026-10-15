// C-06 "M33 per-part verdicts". The session-review harness summary carries a histogram of the parts'
// statuses (every public status always present), how many parts carry each closed reason, the
// NO_FINDINGS part causes, whether the session-wide entry is a limit, and how many windows were asked
// again for an unreadable proposal. Integers and closed codes only. Through the harness, the one
// re-ask of an unreadable proposal is the identical request, so the answer store keeps it as the
// next D60 occurrence: a second review replays both answers and makes no call.
// Synthetic session (/srv/x paths) and a fake transport only: no recording, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Session } from '../../evidence/src/session.js';
import { PART_CAUSES, PART_REASONS, PUBLIC_STATUSES } from '../../evidence/src/ledger.js';

const HARNESS = pathToFileURL(fileURLToPath(new URL('../../../scripts/session-review.mjs', import.meta.url))).href;
const harness = await import(HARNESS);
const SENTINEL = 'SYNTHETIC_PH';

const blobs = {
  ask1: `${SENTINEL}_ASK1: run the synthetic checks.`,
  ask2: `${SENTINEL}_ASK2: run them again.`,
  ask3: `${SENTINEL}_ASK3: and once more.`,
  cmd: 'node /srv/x/check.js',
  out: `${SENTINEL}_OUT: 3 passed`,
  post: `${SENTINEL}_POST: a note recorded after the last turn.`,
  long: `${SENTINEL}_LONG: still working.\n${'w'.repeat(370_000)}`,
};
const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
/** Three recorded human turns, one window each (a compaction between them). `post` adds a compaction and
 *  one turnless root note after the last turn: a session-wide event, in a fourth window of its own. M35 windowing: a
 *  compaction no longer splits a window, so each turn ends on a long thought (370k bytes: no two fit one 200k-token
 *  window), and `post`'s note follows a long turnless thought (`S8`), so the last turn is cut there and the notes are
 *  its second piece. */
const session = ({ post = false } = {}) => new Session({ sessionKey: 'session', adapter: 'claude', blobs, events: [
  ...[1, 2, 3].flatMap((n) => [
    { id: `I${n}`, kind: 'instruction', authority: 'human', supersedes: [], text: ref(`ask${n}`), turn: `T${n}` },
    { id: `A${n}`, kind: 'invocation', callKey: `A${n}`, tool: 'Bash', operation: 'command', paths: [], command: ref('cmd'),
      input: [], changes: [], turn: `T${n}` },
    { id: `A${n}-r`, kind: 'observation', phase: 'terminal', invocation: `A${n}`, callKey: `A${n}`, result: 'succeeded',
      exitCode: 0, terminalStatusProven: true, sourceOfResult: 'native', output: ref('out'), turn: `T${n}` },
    { id: `L${n}`, kind: 'commentary', phase: 'working', beforeInvocation: null, text: ref('long'), turn: `T${n}` },
    ...(n < 3 || post ? [{ id: `B${n}`, kind: 'boundary', boundary: 'compaction', relatedSession: null, turn: `T${n}` }] : []),
  ]),
  ...(post ? [{ id: 'S8', kind: 'commentary', phase: 'working', beforeInvocation: null, text: ref('long') },
    { id: 'S9', kind: 'commentary', phase: 'working', beforeInvocation: null, text: ref('post') }] : []),
].map((event, sequence) => ({ ...event, sequence })) });

const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const UNREADABLE = { ...EMPTY, decisions: [{ dimension: `${SENTINEL}_UNREADABLE` }] };

async function run(base, answer, calls, load = session) {
  const createJudge = ({ onResult }) => async (request) => {
    calls.push(request.label);
    await onResult({ ok: true, attestation: 'attested', providerClass: null, elapsedMs: 1, inputBytes: 1 });
    return answer(request);
  };
  let stdout = '';
  const { summary } = await harness.runSessionReviewHarness({ parent: join(base, 'SYNTHETIC.jsonl'),
    codexHome: base, out: join(base, 'out'), backend: 'claude-cli', model: 'claude-synthetic-1', maxCalls: 50,
    maxSeconds: 60, timeoutMs: 1000, sessionKey: 'session', concurrency: 1 },
  { loadSession: async () => load(), createJudge, write: (text) => { stdout += text; },
    progress: () => {}, installSignals: false });
  assert.doesNotMatch(stdout, new RegExp(SENTINEL), 'no session text leaves the harness');
  assert.deepEqual(JSON.parse(stdout.trim()), summary, 'stdout is the summary');
  return summary;
}

test('M33 P the harness summary schema is /11 (/5 for the parts histogram and the session-wide cause; /6 M33 J; /11 D71: no status)', () => {
  assert.equal(harness.HARNESS_SUMMARY_SCHEMA, 'sonah.session-review-harness/17');
});

test('M33 P the harness summary carries the parts\' reasons and causes, and a re-asked answer is a stored D60 occurrence', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'sonah-m33-parts-harness-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  // Window 2's answer is unreadable on its first request only; window 3's on both.
  const asked = new Map();
  const answer = (request) => {
    if (request.challenge) return { votes: [] };
    const nth = asked.get(request.label) ?? 0;
    asked.set(request.label, nth + 1);
    if (request.label === 'narrative:w2' && nth === 0) return UNREADABLE;
    if (request.label === 'narrative:w3') return UNREADABLE;
    return EMPTY;
  };
  const calls = [];
  const summary = await run(base, answer, calls);
  assert.equal(summary.state, 'finished');
  assert.deepEqual(calls.filter((label) => label === 'narrative:w1').length, 1);
  assert.deepEqual(calls.filter((label) => label === 'narrative:w2').length, 2, 'asked again once');
  assert.deepEqual(calls.filter((label) => label === 'narrative:w3').length, 2, 'bounded: once more, no further');
  // D71 (a): no part's status leaves the harness; its reasons and the part causes do.
  assert.ok(!Object.hasOwn(summary.parts, 'byStatus'));
  assert.doesNotMatch(JSON.stringify(summary), /"(DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)"/);
  assert.equal(summary.parts.total, 3);
  assert.deepEqual(Object.keys(summary.parts.byReason).sort(), [...PART_REASONS].sort(), 'every reason, always');
  assert.equal(summary.parts.byReason.proposal_unreadable, 1);
  assert.deepEqual(Object.keys(summary.parts.causes).sort(), [...PART_CAUSES].sort());
  assert.deepEqual(summary.parts.causes,
    { parts_fully_checked: 2, parts_partial: 0, parts_decide_unsettled: 0, parts_unchecked: 1, session_wide_unchecked: 0 });
  assert.deepEqual(summary.parts.sessionWide, { limited: false, reasons: [] });
  assert.deepEqual(summary.proposalReasks, { asked: 2, recovered: 1, unreadable: 1 });
  assert.equal(summary.sessionReview, 'incomplete');
  // The answer store kept both answers of window 2 as occurrences 0 and 1 of one request.
  const stored = (await readdir(join(base, 'out', 'answers'), { recursive: true })).filter((name) => /\.1\.json$/.test(name));
  assert.equal(stored.length, 1, 'one second occurrence is kept: the recovered window\'s');
  // A second review replays both of window 2's answers without a call. Window 3's answers left it
  // incomplete, so they were forgotten (F226) and it is asked again — once more, and no further.
  const again = [];
  const second = await run(base, answer, again);
  assert.equal(again.filter((label) => label === 'narrative:w1').length, 0);
  assert.equal(again.filter((label) => label === 'narrative:w2').length, 0, 'both occurrences replayed');
  assert.equal(again.filter((label) => label === 'narrative:w3').length, 2);
  assert.deepEqual([second.parts.byReason, second.parts.causes], [summary.parts.byReason, summary.parts.causes],
    'the same parts, replayed');
});

test('M33 P the harness summary counts an unchecked session-wide entry apart from the parts', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'sonah-m33-parts-harness-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  // Window 4 holds only the turnless notes; its answer is unreadable on both requests.
  const answer = (request) => (request.challenge ? { votes: [] }
    : request.label === 'narrative:w4' ? UNREADABLE : EMPTY);
  const calls = [];
  const summary = await run(base, answer, calls, () => session({ post: true }));
  assert.equal(summary.state, 'finished');
  assert.deepEqual(calls.filter((label) => label === 'narrative:w4').length, 2, 'premise: the note has a window of its own');
  assert.deepEqual(summary.parts.causes,
    { parts_fully_checked: 3, parts_partial: 0, parts_decide_unsettled: 0, parts_unchecked: 0, session_wide_unchecked: 1 },
    'the session-wide entry is no part: counted apart, never as an unchecked part');
  assert.deepEqual(summary.parts.sessionWide, { limited: true, reasons: ['proposal_unreadable'] });
  assert.equal(summary.sessionReview, 'incomplete');
  assert.ok(!Object.hasOwn(summary, 'sessionStatus'), 'D71 (a): no status');
});
