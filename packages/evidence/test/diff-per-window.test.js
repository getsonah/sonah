// W3-1 / F30 / W3-4. A review window carries only the diff it touched, plus a manifest of
// everything else. Every byte here is synthetic: invented paths, invented code, invented
// session text. No model, no provider, no recording is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCodeReview, snapshotDiff, validateAnchor } from '../src/code-review.js';
import { coverageCauses } from '../src/review.js';
import { Session } from '../src/session.js';
import { MAX_REVIEW_INPUT_BYTES } from '../src/challenge.js';
import { touchedPaths } from '../src/code-review-prompt.js';

const bytesOf = ({ system = '', prompt = '' }) => Buffer.byteLength(system, 'utf8') + Buffer.byteLength(prompt, 'utf8');

/** The `shown` rows of the supplied manifest — what the request actually put in front of a model. */
const shownFiles = (prompt) => [...prompt.matchAll(/^- (\S+) · [^\n]*· shown$/gm)].map((m) => m[1]);

const filePath = (index) => `src/module-${String(index).padStart(2, '0')}.js`;

/** A synthetic added-file block of `lines` lines, each carrying a unique marker. */
function block(path, lines, marker) {
  const body = Array.from({ length: lines },
    (_, n) => `+  const ${marker}_${n} = ${'x'.repeat(40)}${n};`);
  return [`diff --git a/${path} b/${path}`, 'new file mode 100644',
    'index 0000000..1111111 100644', '--- /dev/null', `+++ b/${path}`,
    `@@ -0,0 +1,${lines} @@`, ...body, ''].join('\n');
}

function syntheticPr({ count = 50, lines = 160 } = {}) {
  const files = [], blocks = [];
  for (let i = 0; i < count; i++) {
    files.push({ path: filePath(i), change: 'added', contentState: 'complete' });
    blocks.push(block(filePath(i), lines, `SYNTHETIC_W31_${i}`));
  }
  return { pr: { repo: { host: 'github.com', id: '9' }, number: 31, baseOid: 'b'.repeat(40),
    diffBaseOid: 'b'.repeat(40), headOid: 'a'.repeat(40), gitAlgorithm: 'sha1',
    enumeration: 'complete', files }, diff: blocks.join('') };
}

const TEXT = {
  ask: 'SYNTHETIC_W31_ASK: add the first two modules and leave every other file alone.',
  said: 'SYNTHETIC_W31_SAID: writing the first two modules now, nothing else.',
  bodyA: 'const SYNTHETIC_W31_WRITE_A = 1;\n',
  bodyB: 'const SYNTHETIC_W31_WRITE_B = 2;\n',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];

/** One window, two recorded writes, both naming files that are in the diff. */
function touchingSession(paths = [filePath(0), filePath(1)]) {
  const events = [
    { id: 'E1', kind: 'instruction', sequence: 0, authority: 'human', text: whole('ask'), supersedes: [] },
    { id: 'E2', kind: 'commentary', sequence: 1, phase: 'working', text: whole('said'), beforeInvocation: 'E3' },
    { id: 'E3', kind: 'invocation', sequence: 2, callKey: 'c1', tool: 'Write', operation: 'write',
      paths: [{ path: paths[0] }], command: [], input: [],
      changes: [{ path: paths[0], before: [], after: whole('bodyA'), diff: [] }] },
    { id: 'E4', kind: 'observation', sequence: 3, invocation: 'E3', callKey: 'c1', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: [], sourceOfResult: 'native' },
    { id: 'E5', kind: 'invocation', sequence: 4, callKey: 'c2', tool: 'Write', operation: 'write',
      paths: [{ path: paths[1] }], command: [], input: [],
      changes: [{ path: paths[1], before: [], after: whole('bodyB'), diff: [] }] },
    { id: 'E6', kind: 'observation', sequence: 5, invocation: 'E5', callKey: 'c2', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: [], sourceOfResult: 'native' },
  ];
  return new Session({ sessionKey: 'sess-w31', adapter: 'claude', events, blobs: { ...TEXT } });
}

/** A judge that answers honestly: it reports exactly the files the request showed it. */
function recordingJudge(requests) {
  return async (request) => {
    requests.push(request);
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key,
      verdict: 'not-refuted', explanation: 'Synthetic support.', receipts: [] })) };
    return { decisions: [], pivots: [], claims: [], requirements: [],
      codeFindings: [], sessionFindings: [], reviewedFiles: shownFiles(request.prompt) };
  };
}

test('F30: a 600 KB, 50-file diff is reviewed — the window carries what it touched, chunks carry the rest', async () => {
  const { pr, diff } = syntheticPr();
  assert.ok(Buffer.byteLength(diff, 'utf8') > MAX_REVIEW_INPUT_BYTES,
    'the fixture must be larger than one request, or it proves nothing');
  const requests = [];
  const report = await runCodeReview({ session: touchingSession(), pr, diff, judge: recordingJudge(requests) });

  assert.ok(requests.length > 0, 'the review must actually spend calls on a diff of ordinary size');
  for (const request of requests)
    assert.ok(bytesOf(request) <= MAX_REVIEW_INPUT_BYTES,
      `a request of ${bytesOf(request)} bytes exceeded the cap`);

  const first = requests[0];
  assert.match(first.label, /^code\+narrative:w1$/);
  assert.ok(first.prompt.includes('SYNTHETIC_W31_0_0'), "window 1 must carry the first touched file's hunks");
  assert.ok(first.prompt.includes('SYNTHETIC_W31_1_0'), "window 1 must carry the second touched file's hunks");
  assert.ok(!first.prompt.includes('SYNTHETIC_W31_2_0'), 'window 1 must not carry an untouched file');
  for (let i = 0; i < 50; i++)
    assert.ok(first.prompt.includes(filePath(i)), `the manifest must name ${filePath(i)}`);
  assert.deepEqual(shownFiles(first.prompt), [filePath(0), filePath(1)]);

  const chunks = requests.filter((r) => /^code\+chunk:/.test(r.label));
  assert.ok(chunks.length >= 2, `48 remaining files must arrive in several chunks, not ${chunks.length}`);
  const chunked = new Set(chunks.flatMap((r) => shownFiles(r.prompt)));
  for (let i = 2; i < 50; i++) assert.ok(chunked.has(filePath(i)), `${filePath(i)} was never sent`);

  assert.equal(report.codeCoverageFacts.placed.length, 50);
  assert.equal(report.codeCoverage, 'complete');
  assert.equal(report.codeCoverageFacts.windowRequests, 1);
  assert.equal(report.codeCoverageFacts.chunkRequests, chunks.length);
});

test('W3-1: one file whose hunks alone exceed the cap is declared, never sent, never quietly clipped', async () => {
  const path = 'src/generated-bundle.js';
  const diff = block(path, 9000, 'SYNTHETIC_W31_HUGE');
  assert.ok(Buffer.byteLength(diff, 'utf8') > MAX_REVIEW_INPUT_BYTES);
  const pr = { repo: { host: 'github.com', id: '9' }, number: 32, baseOid: 'b'.repeat(40),
    diffBaseOid: 'b'.repeat(40), headOid: 'a'.repeat(40), gitAlgorithm: 'sha1',
    enumeration: 'complete', files: [{ path, change: 'added', contentState: 'complete' }] };
  const requests = [];
  const report = await runCodeReview({ session: touchingSession([path, path]), pr, diff,
    judge: recordingJudge(requests) });

  for (const request of requests) {
    assert.ok(bytesOf(request) <= MAX_REVIEW_INPUT_BYTES);
    assert.ok(!request.prompt.includes('SYNTHETIC_W31_HUGE_0'), 'an over-cap file must never be sent');
  }
  assert.equal(report.codeCoverage, 'partial');
  assert.ok(report.codeJudgment.reasons.includes('unreviewed_scope'));
  const declared = report.codeCoverageFacts.unreviewable;
  assert.deepEqual(declared.map((f) => [f.path, f.reason]), [[path, 'oversize']]);
  assert.ok(declared[0].bytes > MAX_REVIEW_INPUT_BYTES, 'the declaration carries the size that did not fit');
  const gap = report.gaps.find((g) => g.code === 'code_unreviewable' && g.channel === 'code' && g.scope === 'pr');
  assert.ok(gap, 'an unreviewable file must be declared as a gap');
  assert.match(gap.note, /^1 changed file\(s\) could not be reviewed: 1 over the request budget$/);
  assert.ok(coverageCauses(report).some(([cause]) => cause === 'code_unreviewable'), 'the reader is told what was not reviewed');
});

test('W3-4: a binary file is declared, its bytes never reach a prompt, and it cannot host an anchor', async () => {
  const code = 'src/a.js';
  const binary = 'assets/logo.png';
  const diff = block(code, 4, 'SYNTHETIC_W31_BIN')
    + `diff --git a/${binary} b/${binary}\nindex 2222222..3333333 100644\nBinary files a/${binary} and b/${binary} differ\n`;
  const pr = { repo: { host: 'github.com', id: '9' }, number: 33, baseOid: 'b'.repeat(40),
    diffBaseOid: 'b'.repeat(40), headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
    files: [{ path: code, change: 'added', contentState: 'complete' },
      { path: binary, change: 'binary', contentState: 'complete' }] };
  const requests = [];
  const report = await runCodeReview({ session: touchingSession([code, binary]), pr, diff,
    judge: recordingJudge(requests) });

  assert.ok(requests.length > 0);
  for (const request of requests) {
    assert.ok(!request.prompt.includes('Binary files'), 'binary block text must never reach a prompt');
    // W3f-2 / F225: a row states its size only in a request that shows the file; a binary never is.
    assert.match(request.prompt, new RegExp(`^- ${binary} · binary · binary · not reviewable$`, 'm'));
  }
  assert.equal(validateAnchor(snapshotDiff({ pr, diff }),
    { path: binary, side: 'RIGHT', startLine: 1, endLine: 1 }), false);
  const gap = report.gaps.find((g) => g.code === 'code_unreviewable' && g.channel === 'code' && g.scope === 'pr');
  assert.ok(gap);
  assert.match(gap.note, /1 binary/);
  assert.equal(report.codeCoverage, 'partial');
});

test('a recorded path the recorder never made repo-relative still finds its changed file', async () => {
  const { pr, diff } = syntheticPr({ count: 3, lines: 4 });
  // What `sonah review` actually hands the slicer on macOS: the recording stores /var/…, the
  // command canonicalises to /private/var/…, and the cwd prefix never matches, so the event
  // keeps a path the diff does not use. The window still touched that file.
  const absolute = [`/private/var/checkout/${filePath(0)}`, `home/dev/checkout/${filePath(1)}`];
  const requests = [];
  const report = await runCodeReview({ session: touchingSession(absolute), pr, diff,
    judge: recordingJudge(requests) });
  assert.deepEqual(shownFiles(requests[0].prompt), [filePath(0), filePath(1)]);
  assert.equal(report.codeCoverage, 'complete');
});

test('an event that is not this session\'s own touches nothing, whatever a window carries', () => {
  const { pr, diff } = syntheticPr({ count: 3, lines: 4 });
  const snapshot = snapshotDiff({ pr, diff });
  const session = touchingSession();
  const foreign = { id: 'E3', kind: 'invocation', sequence: 99, operation: 'write',
    paths: [{ path: filePath(2) }], command: [], input: [], changes: [] };
  const window = { index: 0, events: [session.event('E3'), foreign] };
  assert.deepEqual([...touchedPaths(window, snapshot, session)], [filePath(0)]);
  assert.deepEqual([...touchedPaths(window, snapshot)].sort(), [filePath(0), filePath(2)]);
});

test('W3-4: a file the recorder could not supply completely cannot host an anchor either', () => {
  const complete = 'src/a.js', partial = 'src/b.js';
  const diff = block(complete, 3, 'SYNTHETIC_W31_OK') + block(partial, 3, 'SYNTHETIC_W31_PARTIAL');
  const pr = { repo: { host: 'github.com', id: '9' }, number: 34, baseOid: 'b'.repeat(40),
    diffBaseOid: 'b'.repeat(40), headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
    files: [{ path: complete, change: 'added', contentState: 'complete' },
      { path: partial, change: 'added', contentState: 'partial' }] };
  const snapshot = snapshotDiff({ pr, diff });
  assert.ok(!snapshot.sources.some((s) => s.path === partial),
    'a partial file without verified retained-hunk inventory supplies no quotable source');
  assert.equal(validateAnchor(snapshot, { path: partial, side: 'RIGHT', startLine: 1, endLine: 1 }), false,
    'an incompletely supplied file is not reviewable, so no finding may be anchored in it');
  assert.equal(validateAnchor(snapshot, { path: complete, side: 'RIGHT', startLine: 1, endLine: 1 }), true);
  assert.deepEqual(snapshot.unreviewable, [{ path: partial, reason: 'withheld' }]);
});

// ---- F87: one bad hunk declares one file ---------------------------------------------------

const F87 = { first: 'src/f87-first.js', bad: 'src/f87-bad.js', last: 'src/f87-last.js' };

/** A modified file whose first hunk is valid and whose second hunk promises five lines and
 *  delivers two — the shape of a patch cut off mid-hunk. */
const malformedBlock = (path) => [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644',
  `--- a/${path}`, `+++ b/${path}`,
  '@@ -1,2 +1,2 @@', ' const keep = 1;', '-const SYNTHETIC_F87_BAD_OLD = 1;', '+const SYNTHETIC_F87_BAD_NEW = 1;',
  '@@ -10,5 +10,5 @@', ' const truncated = 1;', '-const SYNTHETIC_F87_BAD_TAIL = 1;', ''].join('\n');

function f87Input({ malformed = true } = {}) {
  const middle = malformed ? malformedBlock(F87.bad)
    : [`diff --git a/${F87.bad} b/${F87.bad}`, 'index 1111111..2222222 100644', `--- a/${F87.bad}`, `+++ b/${F87.bad}`,
      '@@ -1,2 +1,2 @@', ' const keep = 1;', '-const SYNTHETIC_F87_BAD_OLD = 1;', '+const SYNTHETIC_F87_BAD_NEW = 1;', ''].join('\n');
  const diff = block(F87.first, 3, 'SYNTHETIC_F87_FIRST') + middle + block(F87.last, 3, 'SYNTHETIC_F87_LAST');
  const pr = { repo: { host: 'github.com', id: '9' }, number: 87, baseOid: 'b'.repeat(40),
    diffBaseOid: 'b'.repeat(40), headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
    files: [{ path: F87.first, change: 'added', contentState: 'complete' },
      { path: F87.bad, change: 'modified', contentState: 'complete' },
      { path: F87.last, change: 'added', contentState: 'complete' }] };
  return { pr, diff };
}

test('F87: a malformed middle file is declared diff_unparsed and the files after it still parse', () => {
  const control = snapshotDiff(f87Input({ malformed: false }));
  assert.equal(control.parsed, true, 'control: the same three files, well formed, parse cleanly');
  assert.deepEqual(control.unreviewable, []);

  const snapshot = snapshotDiff(f87Input());
  const pathsWithSources = [...new Set(snapshot.sources.map((s) => s.path))];
  assert.deepEqual(pathsWithSources, [F87.first, F87.last],
    'the file after the bad hunk has its sources; the bad file keeps none, not even its valid first hunk');
  assert.deepEqual(snapshot.unreviewable, [{ path: F87.bad, reason: 'diff_unparsed' }]);
  assert.equal(snapshot.parsed, false, 'a malformed patch can never certify complete');
  assert.equal(snapshot.complete, false);
  assert.equal(validateAnchor(snapshot, { path: F87.last, side: 'RIGHT', startLine: 1, endLine: 1 }), true);
  assert.equal(validateAnchor(snapshot, { path: F87.bad, side: 'RIGHT', startLine: 1, endLine: 1 }), false,
    'bytes that did not parse cannot host a finding');
  assert.equal(new Set(snapshot.sources.map((s) => s.eventId)).size, snapshot.sources.length);
});

test('F87: the review reads files 1 and 3, declares file 2 in the manifest and the gap note, and is partial', async () => {
  const { pr, diff } = f87Input();
  const requests = [];
  const report = await runCodeReview({ pr, diff, judge: recordingJudge(requests) });

  assert.deepEqual(report.codeCoverageFacts.placed, [F87.first, F87.last].sort());
  assert.deepEqual(report.codeCoverageFacts.unreviewable.map((f) => [f.path, f.reason]), [[F87.bad, 'diff_unparsed']]);
  assert.equal(report.codeCoverage, 'partial');
  assert.ok(report.codeJudgment.reasons.includes('unreviewed_scope'));

  const prompts = requests.filter((r) => !r.challenge);
  assert.ok(prompts.length > 0);
  for (const request of prompts) {
    assert.ok(!request.prompt.includes('SYNTHETIC_F87_BAD'), 'bytes that did not parse never reach a prompt');
    const line = request.prompt.split('\n').find((l) => l.startsWith(`- ${F87.bad} ·`));
    assert.match(line, /· not reviewable$/, `the manifest declares the file:\n${line}`);
    assert.doesNotMatch(line, /undefined/);
    // F105: as what it is. Redaction withheld nothing from this file; its diff did not parse.
    assert.match(line, /· diff did not parse · not reviewable$/, `the manifest names the real reason:\n${line}`);
  }
  const gap = report.gaps.find((g) => g.code === 'code_unreviewable' && g.channel === 'code' && g.scope === 'pr');
  assert.ok(gap, 'an unparsed file is declared as a gap');
  assert.equal(gap.count, 1);
  assert.match(gap.note, /^1 changed file\(s\) could not be reviewed: 1 whose diff did not parse$/);
  assert.ok(coverageCauses(report).some(([cause]) => cause === 'code_unreviewable'), 'the reader is told what was not reviewed');
});
