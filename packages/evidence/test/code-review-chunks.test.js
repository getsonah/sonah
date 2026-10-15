// W3-1 / F24 / F31. After the windows, the code review covers every remaining reviewable file
// in chunked code-only calls, declares what it could not review, and records per-window
// shortfall. Synthetic input only: no model, no provider, no recording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCodeReview } from '../src/code-review.js';
import { runReview, NARRATIVE_SHORTFALL, CHALLENGE_SHORTFALL } from '../src/run-review.js';
import { renderReview, SHORTFALL_SENTENCE } from '../src/review.js';
import { FILE_STATES } from '../src/code-review-prompt.js';
import { Session } from '../src/session.js';
import { MAX_REVIEW_INPUT_BYTES } from '../src/challenge.js';
import { redisPivotSession, redisPivotPr } from '../fixtures/redis-pivot.js';

const shownFiles = (prompt) => [...prompt.matchAll(/^- (\S+) · [^\n]*· shown$/gm)].map((m) => m[1]);
const manifestLine = (prompt, path) =>
  prompt.split('\n').find((line) => line.startsWith(`- ${path} ·`)) ?? null;

function block(path, lines, marker) {
  const body = Array.from({ length: lines }, (_, n) => `+const ${marker}_${n} = ${n};`);
  return [`diff --git a/${path} b/${path}`, 'new file mode 100644',
    'index 0000000..1111111 100644', '--- /dev/null', `+++ b/${path}`,
    `@@ -0,0 +1,${lines} @@`, ...body, ''].join('\n');
}

const prOf = (files) => ({ repo: { host: 'github.com', id: '9' }, number: 24, baseOid: 'b'.repeat(40),
  diffBaseOid: 'b'.repeat(40), headOid: 'a'.repeat(40), gitAlgorithm: 'sha1',
  enumeration: 'complete', files });

const TEXT = {
  ask: 'SYNTHETIC_CHUNK_ASK: add the kept module and nothing else.',
  bodyA: 'const SYNTHETIC_CHUNK_WRITE = 1;\n',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];

function sessionTouching(path) {
  const events = [
    { id: 'E1', kind: 'instruction', sequence: 0, authority: 'human', text: whole('ask'), supersedes: [] },
    { id: 'E3', kind: 'invocation', sequence: 1, callKey: 'c1', tool: 'Write', operation: 'write',
      paths: [{ path }], command: [], input: [],
      changes: [{ path, before: [], after: whole('bodyA'), diff: [] }] },
    { id: 'E4', kind: 'observation', sequence: 2, invocation: 'E3', callKey: 'c1', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: [], sourceOfResult: 'native' },
  ];
  return new Session({ sessionKey: 'sess-chunks', adapter: 'claude', events, blobs: { ...TEXT } });
}

function recordingJudge(requests) {
  return async (request) => {
    requests.push(request);
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key,
      verdict: 'not-refuted', explanation: 'Synthetic support.', receipts: [] })) };
    return { decisions: [], pivots: [], claims: [], requirements: [],
      codeFindings: [], sessionFindings: [], reviewedFiles: shownFiles(request.prompt) };
  };
}

test('F24: one file withheld by redaction no longer switches code review off for every file', async () => {
  const kept = 'src/kept.js', withheld = 'src/withheld.js';
  // Redaction drops the withheld block entirely and marks only that file partial (F23).
  const diff = block(kept, 6, 'SYNTHETIC_F24_KEPT');
  const pr = prOf([{ path: kept, change: 'added', contentState: 'complete' },
    { path: withheld, change: 'added', contentState: 'partial' }]);
  const requests = [];
  const report = await runCodeReview({ session: sessionTouching(kept), pr, diff,
    judge: recordingJudge(requests) });

  const withHunks = requests.filter((r) => !r.challenge && r.prompt.includes('SYNTHETIC_F24_KEPT_0'));
  assert.ok(withHunks.length >= 1, 'the complete file must be reviewed although its neighbour was withheld');
  assert.deepEqual(report.codeCoverageFacts.placed, [kept]);
  assert.equal(report.codeCoverage, 'partial');
  const gap = report.gaps.find((g) => g.code === 'code_unreviewable' && g.channel === 'code' && g.scope === 'pr');
  assert.ok(gap, 'the withheld file must be declared');
  assert.match(gap.note, /1 withheld by redaction/);
  assert.equal(gap.count, 1);
  assert.match(manifestLine(withHunks[0].prompt, withheld), /withheld · not reviewable$/);
  assert.match(manifestLine(withHunks[0].prompt, kept), /· shown$/);
});

test('every reviewable file no window touched is covered by a code-only chunk call', async () => {
  const touched = 'src/touched.js';
  const paths = [touched, 'src/other-a.js', 'src/other-b.js'];
  const diff = paths.map((p, i) => block(p, 5, `SYNTHETIC_CHUNK_${i}`)).join('');
  const requests = [];
  const report = await runCodeReview({ session: sessionTouching(touched),
    pr: prOf(paths.map((path) => ({ path, change: 'added', contentState: 'complete' }))),
    diff, judge: recordingJudge(requests) });

  const windows = requests.filter((r) => /^code\+narrative:/.test(r.label));
  const chunks = requests.filter((r) => /^code\+chunk:/.test(r.label));
  assert.equal(windows.length, 1);
  assert.equal(chunks.length, 1);
  assert.deepEqual(shownFiles(windows[0].prompt), [touched]);
  assert.deepEqual(shownFiles(chunks[0].prompt), ['src/other-a.js', 'src/other-b.js']);
  assert.match(chunks[0].prompt, /Code-only chunk/);
  assert.deepEqual(report.codeCoverageFacts.placed, [...paths].sort());
  assert.equal(report.codeCoverage, 'complete');
});

test('M35 an oversized command is cut in its window (M36: to the work budget), so the whole file reaches the reviewer beside it', async () => {
  const path = 'src/one.js';
  const ask = 'SYNTHETIC_CHUNK_ASK: review the one changed file.';
  const command = `SYNTHETIC_OVERSIZED_CONTEXT:${'x'.repeat(520_000)}`;
  const blobs = { ask, command };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const session = new Session({ sessionKey: 'synthetic-large-chunk-context', adapter: 'claude', blobs,
    events: [
      { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', text: ref('ask'), supersedes: [] },
      { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'c1', tool: 'Bash', operation: 'run',
        paths: [{ path }], command: ref('command'), input: [], changes: [] },
      { id: 'O1', kind: 'observation', sequence: 2, invocation: 'A1', callKey: 'c1', phase: 'terminal',
        result: 'succeeded', exitCode: 0, output: [], sourceOfResult: 'native' },
    ] });
  const requests = [];
  const report = await runCodeReview({ session, pr: prOf([{ path, change: 'added', contentState: 'complete' }]),
    diff: block(path, 1, 'SYNTHETIC_WHOLE_FILE'), judge: recordingJudge(requests) });

  // M35 (windowing): the command is cut in its window, so the window's own request carries the whole file; no code-only
  // chunk is needed, and nothing is over the byte bound. M36 phase 2 (D68 P; C-07 "M36 window format"): a command line
  // is what the agent produced, shown whole unless it is larger than the window's whole work budget alone — this one is
  // (520,000 bytes over a combined window's 196,606), so its head and tail are shown up to that budget, the gap declared.
  const window = requests.find((request) => request.label === 'code+narrative:w1');
  assert.ok(window, 'the complete file should reach the reviewer');
  assert.match(window.prompt, /SYNTHETIC_WHOLE_FILE_0/);
  assert.match(window.prompt, /SYNTHETIC_CHUNK_ASK/);
  assert.match(window.prompt, /SYNTHETIC_OVERSIZED_CONTEXT/, 'the command\'s head');
  assert.match(window.prompt, /\(action_over_budget: larger than a window's whole work budget\)/);
  assert.ok(window.prompt.includes('x'.repeat(90_000)), 'up to half the work budget on each side');
  assert.ok(!window.prompt.includes('x'.repeat(196_607)), 'never its whole body');
  assert.equal(requests.filter((request) => /^code\+chunk:/.test(request.label)).length, 0);
  assert.deepEqual(report.codeCoverageFacts.placed, [path]);
  assert.deepEqual(report.codeCoverageFacts.unreviewable, []);
  assert.equal(report.codeCoverageFacts.overBudgetRequests, 0);
  assert.equal(report.codeCoverage, 'complete');
  assert.equal(report.coverage, 'complete', 'M35: the trimmed session action is reviewed in its window');
  assert.deepEqual(report.instrument.windowCompletion.byReason, {});
});

test('F31: the null-judge dry run sees one bounded entry per window and per chunk', async () => {
  const touched = 'src/touched.js';
  const paths = [touched, 'src/other-a.js'];
  const diff = paths.map((p, i) => block(p, 5, `SYNTHETIC_DRY_${i}`)).join('');
  const calls = [];
  // The same accounting `boundedJudge` performs in the CLI, without importing the CLI.
  const bounded = (judge) => async (request) => {
    const bytes = Buffer.byteLength(request.system ?? '', 'utf8') + Buffer.byteLength(request.prompt ?? '', 'utf8');
    calls.push({ label: request.label, bytes, allowed: bytes <= MAX_REVIEW_INPUT_BYTES });
    return judge(request);
  };
  const report = await runCodeReview({ session: sessionTouching(touched),
    pr: prOf(paths.map((path) => ({ path, change: 'added', contentState: 'complete' }))),
    diff, judge: bounded(async () => null) });

  assert.equal(calls.length, 3, 'one window request and one bounded retry for each omitted chunk');
  assert.equal(calls.filter((c) => /narrative/.test(c.label)).length, 1);
  assert.equal(calls.filter((c) => /chunk/.test(c.label)).length, 2);
  for (const call of calls) {
    assert.ok(Number.isSafeInteger(call.bytes) && call.bytes > 0);
    assert.equal(call.allowed, true);
  }
  assert.equal(report.codeCoverageFacts.windowRequests, 1);
  assert.equal(report.codeCoverageFacts.chunkRequests, 2);
  assert.equal(report.codeCoverageFacts.overBudgetRequests, 0);
});

test('M29 a malformed narrative response can be recovered for code by a same-file chunk', async () => {
  const path = 'src/recovered.js';
  let calls = 0;
  const report = await runCodeReview({ session: sessionTouching(path),
    pr: prOf([{ path, change: 'added', contentState: 'complete' }]),
    diff: block(path, 2, 'SYNTHETIC_RECOVERY'),
    judge: async (request) => {
      if (request.challenge) return { votes: [] };
      return ++calls === 1 ? null : { decisions: [], pivots: [], claims: [], requirements: [],
        codeFindings: [], sessionFindings: [], reviewedFiles: shownFiles(request.prompt) };
    } });
  assert.equal(calls, 2);
  assert.equal(report.codeCoverage, 'complete', 'the later answer reviewed the same frozen file');
  assert.deepEqual(report.codeCoverageFacts.placed, [path]);
  assert.notEqual(report.coverage, 'complete', 'the lost session narrative was not recovered');
  assert.equal(report.codeJudgment.attemptedCalls, 2, 'the malformed attempt remains counted');
});

test('M29 a failed first chunk can be recovered by its one bounded code retry', async () => {
  const path = 'src/retried.js';
  let chunks = 0;
  const report = await runCodeReview({ session: sessionTouching('src/other.js'),
    pr: prOf([{ path, change: 'added', contentState: 'complete' }]),
    diff: block(path, 2, 'SYNTHETIC_CHUNK_RETRY'),
    judge: async (request) => {
      if (request.challenge) return { votes: [] };
      if (request.label.startsWith('code+chunk:') && ++chunks === 1) throw new Error('synthetic transport failure');
      return { decisions: [], pivots: [], claims: [], requirements: [],
        codeFindings: [], sessionFindings: [], reviewedFiles: shownFiles(request.prompt) };
    } });
  assert.equal(chunks, 2);
  assert.equal(report.codeCoverage, 'complete');
  assert.deepEqual(report.codeCoverageFacts.placed, [path]);
  assert.equal(report.codeJudgment.attemptedCalls, 3);
});

test('M66/W3-1: the shortfall phrasebooks and the frozen shortfall lists are the same sets', () => {
  assert.deepEqual(Object.keys(SHORTFALL_SENTENCE).sort(),
    NARRATIVE_SHORTFALL.filter((token) => token !== 'ok').sort(),
    'a shortfall token with no sentence renders as nothing; a sentence with no token is dead text');
  for (const token of [...NARRATIVE_SHORTFALL, ...CHALLENGE_SHORTFALL, ...Object.keys(FILE_STATES)])
    assert.match(token, /^[a-z][a-z_]*$/, `${token} is not a bare token`);
});

test('W3-1: every shortfall and manifest state a run emits is a member of its frozen list', async () => {
  const touched = 'src/touched.js';
  const paths = [touched, 'src/other.js', 'assets/logo.png'];
  const diff = block(touched, 4, 'SYNTHETIC_VOCAB_0') + block('src/other.js', 4, 'SYNTHETIC_VOCAB_1')
    + 'diff --git a/assets/logo.png b/assets/logo.png\nBinary files a/assets/logo.png and b/assets/logo.png differ\n';
  const requests = [];
  const report = await runCodeReview({ session: sessionTouching(touched),
    pr: prOf([{ path: touched, change: 'added', contentState: 'complete' },
      { path: 'src/other.js', change: 'added', contentState: 'complete' },
      { path: 'assets/logo.png', change: 'binary', contentState: 'complete' }]),
    diff, judge: recordingJudge(requests) });
  for (const window of report.windowResults) {
    assert.ok(NARRATIVE_SHORTFALL.includes(window.shortfall.narrative));
    assert.ok(window.shortfall.challenge.reason === null
      || CHALLENGE_SHORTFALL.includes(window.shortfall.challenge.reason));
  }
  const states = new Set(Object.values(FILE_STATES));
  // W3f-2 / F225: a row states its size only in a request that shows its file; the state follows it.
  const stateOf = (line) => line.replace(/^- \S+ · [^·]+ · (?:\+\d+\/-\d+ · )?/, '');
  for (const request of requests.filter((r) => !r.challenge))
    for (const line of request.prompt.split('\n').filter((l) => paths.some((p) => l.startsWith(`- ${p} ·`))))
      assert.ok(states.has(stateOf(line)), `manifest state outside the closed set: ${line}`);
});

// ---- per-window shortfall instrumentation -------------------------------------------------

/** M35 (windowing): a compaction splits no window; a long statement (100,000 bytes) after the ask and before E7 makes
 *  the one segment over a combined review's window budget, cut before E7's statement: windows E1..E6 and E7..E9. */
function twoWindowSession() {
  const base = redisPivotSession();
  const fill = `SYNTHETIC_FILL: still working.\n${'f'.repeat(100_000)}`;
  const statement = (id, sequence) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null, sequence,
    text: [{ sourceKey: 'fill', fromByte: 0, untilByte: fill.length }] });
  const events = [];
  for (const event of structuredClone(base.events)) {
    if (event.id === 'E7') {
      events.push({ id: 'B-E7', kind: 'boundary', boundary: 'compaction', sequence: events.length });
      events.push(statement('F-E7', events.length));
    }
    events.push({ ...event, sequence: events.length });
    if (event.id === 'E1') events.push(statement('F-E1', events.length));
  }
  return new Session({ sessionKey: base.sessionKey, events, blobs: { ...base.blobs, fill } });
}

const emptyNarrative = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });

test('a window that returned no parseable JSON records shortfall.narrative = no_json and says so', async () => {
  const session = twoWindowSession();
  const report = await runReview({ session, pr: redisPivotPr(), judge: async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key,
      verdict: 'not-refuted', explanation: 'Synthetic support.', receipts: [] })) };
    return request.window.index === 1 ? 'this is not JSON at all' : emptyNarrative();
  } });
  assert.equal(report.windowResults.length, 2);
  assert.equal(report.windowResults[0].shortfall.narrative, 'ok');
  assert.equal(report.windowResults[1].shortfall.narrative, 'no_json');
  assert.match(renderReview(report), /window 2: the model returned no parseable JSON/);
});

test('a window whose JSON is outside the contract is schema, not no_json', async () => {
  const report = await runReview({ session: twoWindowSession(), pr: redisPivotPr(),
    judge: async (request) => request.window.index === 1
      ? { decisions: 'not an array', pivots: [], claims: [], requirements: [] } : emptyNarrative() });
  assert.equal(report.windowResults[1].shortfall.narrative, 'schema');
  assert.match(renderReview(report), /window 2: the model returned JSON outside the response contract/);
});

test('a declared transport failure keeps its own shortfall word', async () => {
  const report = await runReview({ session: twoWindowSession(), pr: redisPivotPr(),
    judge: async (request) => {
      if (request.window.index === 1) throw Object.assign(new Error('x'), { code: 'anthropic_key_missing' });
      return emptyNarrative();
    } });
  assert.equal(report.windowResults[1].shortfall.narrative, 'model_unavailable');
});

test('challenge shortfall counts the votes that were actually valid, and grounding counts receipts', async () => {
  const session = redisPivotSession();
  const decision = { dimension: 'cache backend', chosen: 'Redis', actions: ['E3'], value: null,
    valueReceipt: null, stated: { eventId: 'E2', role: 'commentary', quote: 'I am going to add a small Redis layer' },
    constrainedBy: null };
  const report = await runReview({ session, pr: redisPivotPr(), judge: async (request) => {
    if (!request.challenge) return { ...emptyNarrative(), decisions: [decision] };
    // One challenge pass answers with a key nobody asked about: no valid vote at all. Keyed on
    // the pass, not the call count, so its one re-ask (W3d-1) is answered the same way.
    if (request.challenge.pass === 2) return { votes: [{ key: 'not-a-real-key', verdict: 'not-refuted', explanation: 'x', receipts: [] }] };
    return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'The cited commentary states the choice.', receipts: [decision.stated] })) };
  } });
  const shortfall = report.windowResults[0].shortfall;
  assert.equal(shortfall.challenge.passes, 3);
  assert.equal(shortfall.challenge.validVotes, 2, 'one of three passes produced no valid vote');
  assert.equal(shortfall.grounding.receipts, 1);
  assert.equal(shortfall.grounding.verified, 1);
  assert.equal(shortfall.grounding.rejected, 0);
  assert.equal(shortfall.grounding.repaired, 0);
});

test('a window whose receipts did not verify is counted and rendered from the closed phrasebook', async () => {
  const session = redisPivotSession();
  const lying = { text: 'A claim with a quote no source contains.',
    stated: { eventId: 'E2', role: 'commentary', quote: 'SYNTHETIC_QUOTE_THAT_IS_NOT_IN_ANY_SOURCE' },
    contradictedBy: null };
  // The challenger's own receipt grounds; the candidate's does not. Grounding, not the
  // challenge, is what catches that — and the count below is what says so.
  const grounded = { eventId: 'E1', role: 'instruction', quote: 'Add response caching' };
  const report = await runReview({ session, pr: redisPivotPr(), judge: async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key,
      verdict: 'not-refuted', explanation: 'The instruction is on the record.', receipts: [grounded] })) };
    return { ...emptyNarrative(), claims: [lying] };
  } });
  const shortfall = report.windowResults[0].shortfall;
  assert.equal(shortfall.grounding.receipts, 1);
  assert.equal(shortfall.grounding.rejected, 1);
  assert.match(renderReview(report), /window 1: 1 of 1 receipts did not verify/);
});

// ---- F92: the fabrication check is per request ------------------------------------------

test('F92: a chunk answer naming a file only a LATER chunk placed is a partial review, not a clean one', async () => {
  // Two files, each alone more than half of one chunk's allowance: they cannot share a request,
  // so the chunk pass must make two. The whole-run union of placed files contains both, which is
  // exactly how the old end-of-run check let the first answer claim a file it was never shown.
  const [first, second] = ['src/big-first.js', 'src/big-second.js'];
  const lines = 5000;
  const diff = block(first, lines, 'SYNTHETIC_F92_FIRST') + block(second, lines, 'SYNTHETIC_F92_SECOND');
  const pr = prOf([first, second].map((path) => ({ path, change: 'added', contentState: 'complete' })));

  const run = async (answer) => {
    const requests = [];
    const report = await runCodeReview({ pr, diff, judge: async (request) => {
      requests.push(request);
      if (request.challenge) return { votes: [] };
      return { decisions: [], pivots: [], claims: [], requirements: [],
        codeFindings: [], sessionFindings: [], reviewedFiles: answer(request) };
    } });
    const chunks = requests.filter((r) => /^code\+chunk:/.test(r.label));
    assert.deepEqual(chunks.map((r) => shownFiles(r.prompt)), [[first], [second]],
      'the fixture must produce two chunk requests, one file each, or it proves nothing');
    return report;
  };

  const honest = await run((request) => shownFiles(request.prompt));
  assert.equal(honest.codeCoverage, 'complete', 'control: each answer names only what its request showed');

  const overclaiming = await run((request) => request.label === 'code+chunk:1' ? [first, second] : [second]);
  assert.deepEqual(overclaiming.codeCoverageFacts.placed, [first, second],
    'placement is unchanged: both files really were placed, in different requests');
  assert.equal(overclaiming.codeCoverage, 'partial',
    'the first request named a file it was not shown; a later request placing it does not make that true');
  assert.ok(overclaiming.codeJudgment.reasons.includes('unreviewed_scope'));
});

// D59 applies to SESSION windows: a window is judged against the record up to its own end. A
// code-only chunk judges the PR's final code, which is the state at the session's end, so it is
// shown every human instruction — including one given after the file's last recorded edit, which
// is exactly the instruction an agent may have left unacted on.
test('D59: a code-only chunk with context events is shown instructions recorded after them', async () => {
  const path = 'src/touched.js';
  const late = 'SYNTHETIC_LATE_ASK: remove the debug flag from the touched module.';
  // M35 (windowing): a result is trimmed in its window, so the window is made large by a long statement (thoughts are
  // shown in full): its hunk no longer fits beside it.
  const blobs = { ...TEXT, big: 'x'.repeat(180_000), late, long: `SYNTHETIC_LONG: working.\n${'w'.repeat(300_000)}` };
  const events = [
    { id: 'E1', kind: 'instruction', sequence: 0, authority: 'human', text: whole('ask'), supersedes: [] },
    { id: 'C1', kind: 'commentary', sequence: 0, phase: 'working', beforeInvocation: null,
      text: [{ sourceKey: 'long', fromByte: 0, untilByte: blobs.long.length }] },
    { id: 'E3', kind: 'invocation', sequence: 1, callKey: 'c1', tool: 'Write', operation: 'write',
      paths: [{ path }], command: [], input: [],
      changes: [{ path, before: [], after: whole('bodyA'), diff: [] }] },
    { id: 'E4', kind: 'observation', sequence: 2, invocation: 'E3', callKey: 'c1', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: [], sourceOfResult: 'native' },
    { id: 'E5', kind: 'invocation', sequence: 3, callKey: 'c2', tool: 'Bash', operation: 'command',
      paths: [], command: [], input: [] },
    { id: 'E6', kind: 'observation', sequence: 4, invocation: 'E5', callKey: 'c2', phase: 'terminal',
      result: 'succeeded', exitCode: 0, sourceOfResult: 'native',
      output: [{ sourceKey: 'big', fromByte: 0, untilByte: blobs.big.length }] },
    { id: 'E7', kind: 'instruction', sequence: 5, authority: 'human', supersedes: [],
      text: [{ sourceKey: 'late', fromByte: 0, untilByte: Buffer.byteLength(late, 'utf8') }] },
  ].map((event, sequence) => ({ ...event, sequence }));
  const session = new Session({ sessionKey: 'sess-chunk-late', adapter: 'claude', events, blobs });
  const diff = block(path, 8_000, 'SYNTHETIC');
  const requests = [];
  await runCodeReview({ session, pr: prOf([{ path, change: 'added', contentState: 'complete' }]),
    diff, judge: recordingJudge(requests) });
  const chunks = requests.filter((r) => /^code\+chunk:/.test(r.label));
  assert.equal(chunks.length, 1, 'the hunk did not fit beside the window, so a chunk reviews it');
  assert.match(chunks[0].prompt, /\[E3\]/, 'the chunk carries the edit that touched the file');
  assert.ok(chunks[0].prompt.includes(late), 'the chunk shows the instruction recorded after that edit');
});
