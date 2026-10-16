// W3d-2. What W3d-1 records reaches the reader, and four queued review findings.
//
//   - a failed judge call keeps its code and its transport class through the code review's
//      judge wrappers (they rethrew `unreviewed_scope`/`budget_exhausted` and nothing else);
//   - the report says a window's session evidence did not ground, how many of its decisions
//      concern a partly supplied file, how its model call failed, and what the challenge re-asked
//      and snapped;
//   - `report.challenge` totals those re-asks and snapped votes across windows;
//   - a decision about a renamed file's old name survives when the renamed file is complete;
//   - F148 pivots merge on their receipts, not on the model's words for them;
//   - F152 a manifest lists shown files first; F153 "a manifest was rendered" is a flag;
//   - F151 an asked-settled value never publishes a quote the instruction does not contain.
//
// Every byte is synthetic: invented instructions, paths, outputs and model replies. No model is
// called; every judge is a table keyed by label, item key and pass — never by call order.
import test from 'node:test';
import assert from 'node:assert/strict';
// Namespace imports, so each test fails on its own against code that predates it rather than
// the whole file failing to link.
import * as reviewRun from '../src/run-review.js';
import * as prompts from '../src/code-review-prompt.js';
import { runCodeReview } from '../src/code-review.js';
import { groundDecision, deriveColumn } from '../src/ledger.js';
import { Session, repairReceipt } from '../src/session.js';
import { planWindows } from '../src/windows.js';
import { buildNarrativePrompt } from '../src/prompt.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnswerCache, memoizeJudge } from '../../cli/src/answer-cache.js';

const { runReview, mergeWindowOutputs } = reviewRun;
const { buildCodeReviewPrompt, renderManifest, fileReview, MANIFEST_MAX_FILES } = prompts;

const REPO = { host: 'github.com', id: '42' };
const modulePath = (i) => `src/step-${i}.js`;
const scratchPath = (i) => `scratch/note-${i}.txt`;
const MARKER = '## Changed files (manifest)';

/**
 * `count` windows, one per recorded compaction. Each holds a human instruction (with straight
 * quotes, for the curly-quote repair), the agent's words, a write to a module and a write to a
 * scratch note, and both results. `extraAsk` is appended to window 1's instruction verbatim.
 */
function windowedSession(count, { extraAsk = '' } = {}) {
  const blobs = {};
  const events = [];
  let sequence = 0;
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  for (let i = 1; i <= count; i++) {
    blobs[`ask${i}`] = `SYNTHETIC_W3D2_ASK_${i}: write the "step ${i}" module and keep a scratch note beside it.`
      + (i === 1 ? extraAsk : '');
    // M35 (windowing): a compaction no longer splits a window; a long statement (150,000 bytes) puts each segment in a
    // combined review's window (54,613 tokens) of its own.
    blobs[`said${i}`] = `SYNTHETIC_W3D2_SAID_${i}: writing the step ${i} module and its scratch note now.\n${'f'.repeat(150_000)}`;
    blobs[`module${i}`] = `export const SYNTHETIC_W3D2_STEP_${i} = ${i};\n`;
    blobs[`note${i}`] = `SYNTHETIC_W3D2_NOTE_${i}\n`;
    blobs[`ok${i}`] = `SYNTHETIC_W3D2_OK_${i}: wrote 1 file.\n`;
    events.push({ id: `I${i}`, kind: 'instruction', sequence: sequence++, authority: 'human',
      text: whole(`ask${i}`), supersedes: [] });
    events.push({ id: `C${i}`, kind: 'commentary', sequence: sequence++, phase: 'working',
      text: whole(`said${i}`), beforeInvocation: `A${i}` });
    for (const [id, path, body] of [[`A${i}`, modulePath(i), `module${i}`], [`S${i}`, scratchPath(i), `note${i}`]]) {
      events.push({ id, kind: 'invocation', sequence: sequence++, callKey: id.toLowerCase(),
        tool: 'Write', operation: 'write', paths: [{ path }], command: [], input: [],
        changes: [{ path, before: [], after: whole(body), diff: [] }] });
      events.push({ id: `${id}-r`, kind: 'observation', sequence: sequence++, invocation: id,
        callKey: id.toLowerCase(), phase: 'terminal', result: 'succeeded', exitCode: 0,
        output: whole(`ok${i}`), sourceOfResult: 'native', terminalStatusProven: true });
    }
    if (i < count) events.push({ id: `B${i}`, kind: 'boundary', sequence: sequence++, boundary: 'compaction' });
  }
  return new Session({ sessionKey: 'sess-w3d2', adapter: 'claude', events, blobs });
}

const decisionAbout = (i, action, path) => ({
  dimension: `SYNTHETIC_W3D2_DIMENSION_${action}`,
  chosen: `SYNTHETIC_W3D2_CHOSEN_${action}`,
  value: path,
  valueReceipt: { eventId: action, field: 'path', role: 'action', quote: path },
  actions: [action],
  stated: { eventId: `C${i}`, role: 'commentary', quote: `SYNTHETIC_W3D2_SAID_${i}` },
  constrainedBy: { instruction: { eventId: `I${i}`, role: 'instruction', quote: `SYNTHETIC_W3D2_ASK_${i}` },
    settles: false, settledValueQuote: null },
});

/** Three challenge items per window: a decision about the module, one about the note, a requirement. */
const narrativeFor = (i) => ({
  decisions: [decisionAbout(i, `A${i}`, modulePath(i)), decisionAbout(i, `S${i}`, scratchPath(i))],
  pivots: [], claims: [],
  requirements: [{ text: `SYNTHETIC_W3D2_REQUIREMENT_${i}`, status: 'open',
    instruction: { eventId: `I${i}`, role: 'instruction', quote: `SYNTHETIC_W3D2_ASK_${i}` } }],
});

const windowOf = (label) => Number(/:w(\d+)/.exec(label ?? '')?.[1] ?? 0);

/** A narrative reviewer. `omit` and `quoteFor` are pure functions of the slot. */
function reviewer({ omit = () => false, quoteFor = () => null, narrative = narrativeFor } = {}) {
  return async (request) => {
    const window = windowOf(request.label);
    if (!request.challenge) return narrative(window);
    const { pass, reask = false } = request.challenge;
    return { votes: request.challenge.items.filter(({ key }) => !omit({ window, key, pass, reask }))
      .map(({ key }) => ({ key, verdict: 'not-refuted', explanation: 'The cited instruction asks for this.',
        receipts: [{ eventId: `I${window}`, role: 'instruction',
          quote: quoteFor({ window, key, pass }) ?? `SYNTHETIC_W3D2_ASK_${window}` }] })) };
  };
}

const prOf = (files) => ({ repo: REPO, number: 32, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
  headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete', files });

function block(path, lines, marker) {
  const body = Array.from({ length: lines }, (_, n) => `+const ${marker}_${n} = ${n};`);
  return [`diff --git a/${path} b/${path}`, 'new file mode 100644',
    'index 0000000..1111111 100644', '--- /dev/null', `+++ b/${path}`,
    `@@ -0,0 +1,${lines} @@`, ...body, ''].join('\n');
}

const shownFiles = (prompt) => [...prompt.matchAll(/^- (\S+) · [^\n]*· shown$/gm)].map((m) => m[1]);
const emptyCode = (request) => ({ decisions: [], pivots: [], claims: [], requirements: [],
  codeFindings: [], sessionFindings: [], reviewedFiles: shownFiles(request.prompt) });

// ---- the failure's identity survives the code review's judge wrappers ---------------------

/** A window-1 joint call that fails with `error`; every other call answers. */
const failingWindow = (error, labels) => async (request) => {
  labels?.push(request.label);
  if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
    explanation: 'Synthetic support.', receipts: [] })) };
  if (windowOf(request.label) === 1 && /narrative:w1$/.test(request.label)) throw error;
  return emptyCode(request);
};

const transportError = (over) => Object.assign(
  new Error('SYNTHETIC_STDERR ANTHROPIC_API_KEY=sk-ant-SYNTHETIC-NOT-A-KEY'), over);

test('W3d-2 through runCodeReview, a window keeps the transport class and the declared code', async () => {
  const s = windowedSession(1);
  const pr = prOf([{ path: modulePath(1), change: 'added', contentState: 'complete' }]);
  const diff = block(modulePath(1), 2, 'SYNTHETIC_W3D2_CODE');
  const cases = [
    [{ code: 'model_timeout', transportClass: 'timeout' }, 'model_timeout', 'timeout'],
    [{ code: 'anthropic_key_missing' }, 'anthropic_key_missing', null],
    [{ code: 'model_unavailable', transportClass: 'exit_nonzero' }, 'model_unavailable', 'exit_nonzero'],
    // The closed-token rule holds: a code outside JUDGE_FAILURE_CODES is `model_unavailable`,
    // and a class outside the transport list is `unknown`.
    [{ code: 'SYNTHETIC_UNLISTED_CODE', transportClass: 'SYNTHETIC_UNLISTED_CLASS' }, 'model_unavailable', 'unknown'],
    [{ code: 'budget_exhausted' }, 'budget_exhausted', null],
  ];
  for (const [error, failure, transport] of cases) {
    const labels = [];
    const report = await runCodeReview({ session: s, pr, diff, judge: failingWindow(transportError(error), labels) });
    assert.ok(labels.includes('code+narrative:w1'), 'premise: the joint window wrapper was the one called');
    const [window] = report.windowResults;
    assert.equal(window.failure, failure, JSON.stringify(error));
    assert.equal(window.shortfall.transport, transport, JSON.stringify(error));
    const text = JSON.stringify(report);
    assert.ok(!text.includes('SYNTHETIC_STDERR') && !text.includes('sk-ant-'), 'a transport\'s words are never recorded');
    assert.ok(!text.includes('SYNTHETIC_UNLISTED'), 'an unlisted token is never recorded as itself');
  }
});

test('W3d-2 the session-only wrapper (no reviewable code) forwards the same identity', async () => {
  const s = windowedSession(1);
  // The only changed file is partial, so the joint wrapper is not used: the plain one is.
  const pr = prOf([{ path: modulePath(1), change: 'added', contentState: 'partial' }]);
  const labels = [];
  const report = await runCodeReview({ session: s, pr, diff: '',
    judge: failingWindow(transportError({ code: 'anthropic_key_missing', transportClass: 'spawn_failed' }), labels) });
  assert.deepEqual(labels, ['narrative:w1'], 'premise: the session-only wrapper was the one called');
  assert.equal(report.windowResults[0].failure, 'anthropic_key_missing');
  assert.equal(report.windowResults[0].shortfall.transport, 'spawn_failed');
  assert.ok(!JSON.stringify(report).includes('SYNTHETIC_STDERR'));
});

// ---- report totals, end to end -------------------------------------------------------------

test('W3d-2 report.challenge totals re-asks and snapped votes across windows, and the report says them', async () => {
  const s = windowedSession(2);
  const pr = prOf([{ path: modulePath(1), change: 'added', contentState: 'complete' },
    { path: modulePath(2), change: 'added', contentState: 'complete' }]);
  // Window 1: the challenger leaves the requirement out of its first pass-1 reply (one re-ask).
  // Window 2: every vote quotes the instruction with curly quotes (nine snapped votes).
  const report = await runReview({ session: s, pr, judge: reviewer({
    omit: ({ window, key, pass, reask }) => window === 1 && key === 'requirements:0' && pass === 1 && !reask,
    quoteFor: ({ window }) => window === 2 ? 'write the “step 2” module' : null }) });
  const [w1, w2] = report.windowResults;
  assert.equal(w1.challenge.reaskCalls, 1, 'premise');
  assert.equal(w2.challenge.repairedVotes, 9, 'premise');
  assert.equal(report.challenge.reaskCalls, 1);
  assert.equal(report.challenge.reaskedSlots, 1);
  assert.equal(report.challenge.repairedVotes, 9);
});

// D60 (W3f-1): a review answered from stored answers runs the same challenge — the same re-ask,
// the same snapped quotes — with no call, so it counts what its challenge did exactly as the first
// review did. (The window capsule this used to pin reported zeros.)
test('W3d-2 a review answered from stored answers counts what its challenge did, exactly as the first', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-w3d2-answers-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createAnswerCache(directory, { backend: 'synthetic', model: 'synthetic' });
  const s = windowedSession(1);
  const pr = prOf([{ path: modulePath(1), change: 'added', contentState: 'complete' }]);
  const judge = reviewer({ omit: ({ key, pass, reask }) => key === 'requirements:0' && pass === 1 && !reask,
    quoteFor: () => 'write the “step 1” module' });
  const first = await runReview({ session: s, pr, judge: memoizeJudge(judge, cache) });
  assert.equal(first.challenge.reaskCalls, 1);
  assert.equal(first.challenge.reaskedSlots, 1);
  assert.equal(first.challenge.repairedVotes, 9);
  const replay = memoizeJudge(async () => { throw new Error('no call'); }, cache);
  const again = await runReview({ session: s, pr, judge: replay });
  assert.equal(replay.answers.calls, 0, 'premise: every answer came from the cache');
  assert.deepEqual([again.challenge.reaskCalls, again.challenge.reaskedSlots, again.challenge.repairedVotes], [1, 1, 9]);
  assert.deepEqual(again.windowResults.map((w) => w.shortfall), first.windowResults.map((w) => w.shortfall));
});

test('W3d-2 end to end: a window whose relevance is unknown and one whose model call timed out record so', async () => {
  const s = windowedSession(2);
  const partial = { repo: REPO, enumeration: 'partial', files: [{ path: modulePath(1), change: 'added', contentState: 'complete' },
    { path: modulePath(2), change: 'added', contentState: 'complete' }] };
  const report = await runReview({ session: s, pr: partial, judge: async (request) => {
    if (!request.challenge && windowOf(request.label) === 2)
      throw transportError({ code: 'model_timeout', transportClass: 'timeout' });
    return reviewer()(request);
  } });
  const [one, two] = report.windowResults;
  assert.equal(one.shortfall.grounding.relevanceUnchecked, 1, JSON.stringify(one.shortfall));
  assert.equal(two.shortfall.transport, 'timeout', JSON.stringify(two.shortfall));
  assert.ok(!JSON.stringify(report).includes('SYNTHETIC_STDERR'));
});

// ---- renames keep relevance ------------------------------------------------------------------

test('W3d-2 a decision about a renamed file\'s old name survives when the renamed file is complete', () => {
  const s = windowedSession(1);
  const rel = (pr) => groundDecision({ repo: REPO, session: s, pr, instructionHistoryComplete: true,
    candidate: { ...decisionAbout(1, 'S1', null), value: null, valueReceipt: null, actorSession: s.sessionKey } })
    .decision.relevance;
  const renamed = (contentState) => ({ repo: REPO, enumeration: 'complete', files: [
    { path: modulePath(1), change: 'added', contentState: 'complete' },
    { path: 'scratch/moved.txt', oldPath: scratchPath(1), change: 'renamed', contentState }] });
  assert.equal(rel(renamed('complete')), 'survives', 'the file the decision wrote is in the PR under its new name');
  assert.equal(rel(renamed('partial')), 'unchecked', 'W3d-1 stands: a partial rename of its own file is unknown');
  // A null oldPath (the GitHub reader's non-rename shape) names no file.
  const plain = { repo: REPO, enumeration: 'complete', files: [
    { path: modulePath(1), oldPath: null, change: 'modified', contentState: 'complete' }] };
  assert.equal(rel(plain), 'reverted');
});

// ---- F148: pivots merge on their receipts --------------------------------------------------

test('W3d-2 F148 two windows phrasing one pivot differently, citing the same receipts, publish one pivot', () => {
  const receipts = [{ eventId: 'C1', role: 'commentary', quote: 'SYNTHETIC_F148_SAID_1' },
    { eventId: 'O1', role: 'observation', quote: 'SYNTHETIC_F148_OUT_1' }];
  const first = { abandoned: 'an in-process map', adopted: 'Redis', receipts };
  const reworded = { abandoned: 'the in-memory cache', adopted: 'a Redis instance', receipts: [...receipts].reverse() };
  const otherQuote = { abandoned: 'an in-process map', adopted: 'Redis',
    receipts: [receipts[0], { ...receipts[1], quote: 'SYNTHETIC_F148_OUT_2' }] };
  const merged = mergeWindowOutputs({ repo: REPO, perWindow: [
    { decisions: [], findings: [], requirements: [], promises: [], pivots: [first] },
    { decisions: [], findings: [], requirements: [], promises: [], pivots: [reworded, otherQuote] },
  ] });
  assert.equal(merged.pivots.length, 2, 'the same receipts are one pivot however it is phrased');
  assert.equal(merged.pivotsMerged, 1);
  assert.equal(merged.pivots[0], reworded, 'the later window\'s row is kept, as before');
  assert.equal(merged.pivots[1], otherQuote, 'a different quote from the same event is different evidence');
});

test('W3d-2 F148 end to end: two windows, one pivot in two phrasings, one row', async () => {
  const s = windowedSession(2);
  const report = await runReview({ session: s, pr: null, judge: async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'The recorded instruction supports this reading.',
      receipts: [{ eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_W3D2_ASK_1' }] })) };
    const window = windowOf(request.label);
    return { decisions: [], claims: [], requirements: [], pivots: [{
      abandoned: window === 1 ? 'a scratch-only note' : 'keeping notes out of the module',
      adopted: window === 1 ? 'a note beside the module' : 'the note sits next to the module file',
      receipts: [{ eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_W3D2_ASK_1' }] }] };
  } });
  assert.equal(report.pivotsRejected, 0, 'premise: both windows grounded the pivot');
  assert.equal(report.pivots.length, 1);
  assert.equal(report.counts.pivotsMerged, 1);
});

// ---- F152: shown files first; F153: a flag, not a text search -----------------------------

const row = (i, over = {}) => ({ path: `src/module-${String(i).padStart(4, '0')}.js`, oldPath: null,
  change: 'modified', additions: 1, deletions: 0, reason: null, ...over });
const listed = (manifest) => manifest.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2, l.indexOf(' ·')));

test('W3d-2 F152 a shown file past the cap is still in its own manifest, listed first', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => row(i));
  const manifest = renderManifest(rows, new Set([row(700).path, row(3).path]));
  const names = listed(manifest);
  assert.equal(names.length, MANIFEST_MAX_FILES);
  assert.deepEqual(names.slice(0, 2), [row(3).path, row(700).path], 'shown files first, in PR order');
  assert.deepEqual(names.slice(2, 5), [row(0).path, row(1).path, row(2).path], 'then the rest, in PR order');
  assert.match(manifest, /· shown$/m);
  assert.equal(manifest.split('\n').filter((l) => / · shown$/.test(l)).length, 2);
  assert.match(manifest, /… and 600 more changed files not listed\.$/m, 'the overflow is still counted');
  // Under the cap nothing is dropped, only ordered.
  const few = listed(renderManifest(rows.slice(0, 5), new Set([row(4).path])));
  assert.deepEqual(few, [4, 0, 1, 2, 3].map((i) => row(i).path));
});

test('W3d-2 F152 the budget probe is never smaller than a manifest that reorders shown files', () => {
  // The byte-budget probe renders every file in its widest state. With shown files first, a long
  // path past the cap can displace a short one, so the probe must hold the widest rows.
  const rows = Array.from({ length: 1000 }, (_, i) => row(i));
  rows[900] = row(900, { path: `src/${'deeply/nested/'.repeat(20)}module-0900.js`, oldPath: `old/${'x'.repeat(200)}.js`,
    change: 'renamed' });
  const widest = rows.map((r) => ({ ...r, reason: r.reason ?? 'oversize' }));
  const probe = prompts.widestManifest(widest);
  const actual = renderManifest(rows, new Set([rows[900].path]));
  assert.ok(Buffer.byteLength(actual, 'utf8') <= Buffer.byteLength(probe, 'utf8'),
    `probe ${Buffer.byteLength(probe, 'utf8')} bytes < manifest ${Buffer.byteLength(actual, 'utf8')} bytes`);
});

function markerSnapshot() {
  return { diff: 'diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\n',
    files: [{ path: 'x.js', oldPath: null, change: 'modified', contentState: 'complete' }],
    sources: [], baseOid: 'a'.repeat(40), headOid: 'b'.repeat(40), complete: true };
}

test('W3d-2 F153 session text that quotes the manifest heading does not pass for a rendered manifest', () => {
  // A session about this very codebase can contain the heading verbatim.
  const s = windowedSession(1, { extraAsk: ` Keep the "${MARKER}" section.` });
  const [window] = planWindows(s);
  const narrative = buildNarrativePrompt({ session: s, window, diff: null, hunks: '', manifest: null });
  assert.ok(narrative.prompt.includes(MARKER), 'premise: the session text carries the heading');
  const sessionOnly = buildCodeReviewPrompt({ narrativePrompt: narrative, snapshot: markerSnapshot(), placed: [] });
  assert.match(sessionOnly.prompt, /## Pull-request code — none in this request/);
  // A caller that places files without rendering a manifest still gets the only declaration.
  const placed = buildCodeReviewPrompt({ narrativePrompt: narrative, snapshot: markerSnapshot(), placed: ['x.js'] });
  assert.ok(placed.evidencePrompt.includes('## Frozen PR manifest'));
  // The flag, not the text, says a manifest was rendered.
  const rendered = buildNarrativePrompt({ session: s, window, diff: null, hunks: '',
    manifest: renderManifest(fileReview(markerSnapshot()), new Set(['x.js'])) });
  const flagged = buildCodeReviewPrompt({ narrativePrompt: rendered, snapshot: markerSnapshot(), placed: ['x.js'],
    manifestRendered: true });
  assert.ok(!flagged.evidencePrompt.includes('## Frozen PR manifest'), 'a rendered manifest is not repeated as JSON');
});

test('W3d-2 F153 through runCodeReview, a window that places nothing is session-only whatever its text says', async () => {
  const s = windowedSession(1, { extraAsk: ` Keep the "${MARKER}" section.` });
  // The PR changes a file the session never touched: window 1 places nothing.
  const pr = prOf([{ path: 'src/elsewhere.js', change: 'added', contentState: 'complete' }]);
  const requests = [];
  await runCodeReview({ session: s, pr, diff: block('src/elsewhere.js', 2, 'SYNTHETIC_W3D2_ELSEWHERE'),
    judge: async (request) => {
      requests.push(request);
      if (request.challenge) return { votes: [] };
      return emptyCode(request);
    } });
  const window = requests.find((r) => r.label === 'code+narrative:w1');
  assert.ok(window, 'premise: the window was asked');
  assert.match(window.prompt, /## Pull-request code — none in this request/);
  assert.ok(!window.prompt.includes('SYNTHETIC_W3D2_ELSEWHERE'), 'no code of the PR rides on a session-only request');
  const chunk = requests.find((r) => r.label === 'code+chunk:1');
  assert.ok(chunk && chunk.prompt.includes(`${MARKER} — untrusted evidence`), 'the chunk renders its manifest');
  assert.ok(!chunk.prompt.includes('## Frozen PR manifest'), 'and the flag keeps it from being repeated as JSON');
});

// ---- F151: an asked-settled value publishes only what the instruction says ---------------------

function settledSession(text) {
  const blobs = { ask: text, body: 'SYNTHETIC_F151_BODY\n', ok: 'SYNTHETIC_F151_OK\n' };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  return new Session({ sessionKey: 'sess-f151', adapter: 'claude', blobs, events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', text: whole('ask'), supersedes: [] },
    { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'a1', tool: 'Write', operation: 'write',
      paths: [{ path: 'src/cache.js' }], command: [], input: [],
      changes: [{ path: 'src/cache.js', before: [], after: whole('body'), diff: [] }] },
    { id: 'A1-r', kind: 'observation', sequence: 2, invocation: 'A1', callKey: 'a1', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: whole('ok'), sourceOfResult: 'native', terminalStatusProven: true },
  ] });
}

test('W3d-2 F151 asked-settled grounds only on an exact substring, and publishes that substring', () => {
  // Curly quotes once and straight quotes once: `„Redis“` folds to both, so it is ambiguous.
  const ask = 'SYNTHETIC_F151: use the exact backend value “Redis” for the cache layer; the docs write "Redis" too.';
  const s = settledSession(ask);
  const relation = (value) => ({ instruction: { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_F151' },
    settles: true, settledValueQuote: value });
  const decide = (value) => groundDecision({ repo: REPO, session: s, pr: null, instructionHistoryComplete: true,
    candidate: { actorSession: s.sessionKey, dimension: 'cache backend', chosen: 'Redis', value: null,
      valueReceipt: null, actions: ['A1'], stated: null, constrainedBy: relation(value) } }).decision;

  // A near-miss snaps to one exact span. The column grounds, and what it grounded on is exact.
  const nearMiss = 'backend value "Redis" for';
  const snapped = repairReceipt(s, { eventId: 'I1', role: 'instruction', quote: nearMiss });
  assert.equal(snapped.ok, true, 'premise: the value is repairable');
  assert.ok(ask.includes(snapped.receipt.quote), 'the repaired quote is an exact substring of the instruction');
  assert.equal(deriveColumn(s, relation(nearMiss), true).column, 'asked-settled');
  const row = decide(nearMiss);
  assert.equal(row.column, 'asked-settled');
  assert.ok(ask.includes(row.constrainedBy.settledValueQuote),
    `the published settled value must be in the instruction: ${JSON.stringify(row.constrainedBy.settledValueQuote)}`);
  assert.equal(row.constrainedBy.settledValueQuote, snapped.receipt.quote);
  // An exact value is published untouched.
  assert.equal(decide('backend value “Redis” for').constrainedBy.settledValueQuote, 'backend value “Redis” for');

  // A value repair cannot place in exactly one span is never settled, and never published.
  for (const value of ['„Redis“', '"Postgres"', 'use the exact backend value "Memcached"']) {
    const column = deriveColumn(s, relation(value), true);
    assert.notEqual(column.column, 'asked-settled', value);
    assert.equal(decide(value).constrainedBy, null, value);
  }
});
