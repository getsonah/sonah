// W3f-2 / F225. A request changes only when what it shows changes. Every frozen code source used to
// be cited as `diff:<sha256(base, head, whole diff)>:<running hunk index>:<side>`, and its SOURCE
// block named the head (or base) commit, so one new push made every code-carrying request a new
// question — even for a file the push did not touch. A source's id is now derived from what it
// shows (path, side, lines, text); the revision stays on the snapshot's source object, where
// grounding reads it, and never reaches a request. Every byte here is synthetic: invented paths,
// code and session text. No model, no provider, no recording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { planWindows } from '../src/windows.js';
import { buildNarrativePrompt } from '../src/prompt.js';
import { snapshotDiff, runCodeReview, sourceId, identifySources } from '../src/code-review.js';
import { buildCodeReviewPrompt, fileReview, renderManifest, widestManifest } from '../src/code-review-prompt.js';

const BASE = 'a'.repeat(40), MERGE_BASE = 'd'.repeat(40), HEAD_1 = 'b'.repeat(40), HEAD_2 = 'c'.repeat(40);
const OIDS = [BASE, MERGE_BASE, HEAD_1, HEAD_2];

/** One modified file: a context line, one removed line, one added line — a LEFT and a RIGHT source. */
const patch = (path, before, after) => [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644',
  `--- a/${path}`, `+++ b/${path}`, '@@ -1,2 +1,2 @@', ` SYNTHETIC_HEADER_${path}`, `-${before}`, `+${after}`, ''].join('\n');

/** Revision `n` of one PR: a.js is the same in every revision; b.js's added line and the head differ. */
function revision(n, { bLines = 1 } = {}) {
  const added = Array.from({ length: bLines }, (_, i) => `SYNTHETIC_NEW_B_${n}_${i}();`).join('\n+');
  const diff = patch('a.js', 'SYNTHETIC_OLD_A();', 'SYNTHETIC_NEW_A();')
    + patch('b.js', 'SYNTHETIC_OLD_B();', added).replace('@@ -1,2 +1,2 @@', `@@ -1,2 +1,${bLines + 1} @@`);
  return { pr: { repo: { host: 'github.com', id: '225' }, number: 225, baseOid: BASE, diffBaseOid: MERGE_BASE,
    headOid: n === 1 ? HEAD_1 : HEAD_2, gitAlgorithm: 'sha1', enumeration: 'complete',
    files: ['a.js', 'b.js'].map((path) => ({ path, change: 'modified', contentState: 'complete' })) }, diff };
}

const TEXT = { ask: 'SYNTHETIC_F225_ASK: update both modules.', ok: 'SYNTHETIC_F225_OK: written',
  fill1: `SYNTHETIC_F225_FILL_1: ${'f'.repeat(150_000)}`, fill2: `SYNTHETIC_F225_FILL_2: ${'f'.repeat(150_000)}` };
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
/** Two windows: window 1 writes a.js, window 2 writes b.js. M35 (windowing): one segment over a combined review's window
 *  budget (each half opens with a long statement), cut before its second statement; a compaction splits nothing. */
function session() {
  return new Session({ sessionKey: 'sess-f225', adapter: 'claude', blobs: TEXT, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', sequence: 0, text: whole('ask'), supersedes: [] },
    { id: 'C1', kind: 'commentary', phase: 'working', sequence: 1, text: whole('fill1') },
    { id: 'A1', kind: 'invocation', operation: 'write', tool: 'Write', sequence: 2, paths: [{ path: 'a.js' }] },
    { id: 'O1', kind: 'observation', phase: 'terminal', invocation: 'A1', result: 'succeeded', sequence: 3, output: whole('ok') },
    { id: 'B1', kind: 'boundary', boundary: 'compaction', sequence: 4 },
    { id: 'C2', kind: 'commentary', phase: 'working', sequence: 5, text: whole('fill2') },
    { id: 'A2', kind: 'invocation', operation: 'write', tool: 'Write', sequence: 6, paths: [{ path: 'b.js' }] },
    { id: 'O2', kind: 'observation', phase: 'terminal', invocation: 'A2', result: 'succeeded', sequence: 7, output: whole('ok') },
  ] });
}

const sourceOf = (snapshot, path, side) => snapshot.sources.find((s) => s.path === path && s.side === side);
const shownFiles = (prompt) => [...String(prompt ?? '').matchAll(/^- (\S+) · [^\n]*· shown$/gm)].map((m) => m[1]);
const empty = (request) => ({ decisions: [], pivots: [], claims: [], requirements: [],
  codeFindings: [], sessionFindings: [], reviewedFiles: shownFiles(request?.prompt) });
/** Records every request; answers empty; votes support every item with its own receipts. */
function recording(requests, codeFindings = () => []) {
  return async (request) => {
    requests.push(request);
    if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) => ({ key,
      verdict: 'not-refuted', explanation: 'Synthetic support is present in the named source.',
      receipts: structuredClone(candidate.receipts ?? []) })) };
    return { ...empty(request), codeFindings: codeFindings(request) };
  };
}

test('F225 a frozen code source is cited by an id derived from what it shows — path, side, lines and text', () => {
  const one = snapshotDiff(revision(1)), two = snapshotDiff(revision(2));
  assert.equal(one.sources.length, 4, 'premise: a LEFT and a RIGHT source per file');
  for (const source of [...one.sources, ...two.sources]) {
    assert.match(source.eventId, /^diff:[a-f0-9]{16}$/);
    assert.equal(source.eventId, sourceId(source));
  }
  // a.js is the same block in both revisions: the same id, although the head and b.js changed.
  for (const side of ['LEFT', 'RIGHT'])
    assert.equal(sourceOf(two, 'a.js', side).eventId, sourceOf(one, 'a.js', side).eventId, `a.js ${side}`);
  // b.js's added line changed: a new block, a new id. Its removed line did not: the same id.
  assert.notEqual(sourceOf(two, 'b.js', 'RIGHT').eventId, sourceOf(one, 'b.js', 'RIGHT').eventId);
  assert.equal(sourceOf(two, 'b.js', 'LEFT').eventId, sourceOf(one, 'b.js', 'LEFT').eventId);
  // The revision stays on the snapshot's source object: anchoring and publication need it.
  assert.equal(sourceOf(one, 'a.js', 'RIGHT').revisionOid, HEAD_1);
  assert.equal(sourceOf(two, 'a.js', 'RIGHT').revisionOid, HEAD_2);
  assert.equal(sourceOf(one, 'a.js', 'LEFT').revisionOid, MERGE_BASE);
  assert.equal(one.headOid, HEAD_1);
  assert.equal(one.baseOid, MERGE_BASE);
});

test('F225 two different blocks never share an id: another side, another path, another line', () => {
  const context = (path, at) => [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`,
    `@@ -${at},1 +${at},1 @@`, ' SYNTHETIC_SAME_LINE();', ''].join('\n');
  const twice = ['diff --git a/e.js b/e.js', '--- a/e.js', '+++ b/e.js',
    '@@ -1,1 +1,1 @@', ' SYNTHETIC_SAME_LINE();', '@@ -9,1 +9,1 @@', ' SYNTHETIC_SAME_LINE();', ''].join('\n');
  const pr = { repo: { host: 'github.com', id: '225' }, number: 1, baseOid: BASE, headOid: HEAD_1, enumeration: 'complete',
    files: ['c.js', 'd.js', 'e.js'].map((path) => ({ path, change: 'modified', contentState: 'complete' })) };
  const snapshot = snapshotDiff({ pr, diff: context('c.js', 1) + context('d.js', 1) + twice });
  // c.js LEFT and RIGHT, d.js LEFT and RIGHT, e.js two hunks on each side: one text, eight blocks.
  assert.equal(snapshot.sources.length, 8, 'premise: eight blocks with the same text');
  assert.ok(snapshot.sources.every((s) => s.text === 'SYNTHETIC_SAME_LINE();'));
  assert.equal(new Set(snapshot.sources.map((s) => s.eventId)).size, 8, 'eight blocks, eight ids');
  assert.equal(snapshot.parsed, true);
});

test('F225 identical blocks are one block; two different blocks under one id are both refused, never merged', () => {
  const source = { path: 'x.js', side: 'RIGHT', startLine: 1, endLine: 1, revisionOid: HEAD_1, text: 'SYNTHETIC_X();' };
  const one = identifySources([source, { ...source }]);
  assert.deepEqual(one.sources, [{ ...source, eventId: sourceId(source) }]);
  assert.deepEqual([...one.collided], []);
  // A collision is astronomically unlikely at 64 bits, and it is never resolved by guessing: both
  // blocks lose their id, and the caller declares their files unparsed (fail closed).
  const clash = identifySources([source, { ...source, path: 'y.js' }, { ...source, path: 'z.js', text: 'SYNTHETIC_Z();' }],
    (s) => (s.path === 'z.js' ? 'diff:ffffffffffffffff' : 'diff:0000000000000000'));
  assert.deepEqual([...clash.collided].sort(), ['x.js', 'y.js']);
  assert.deepEqual(clash.sources.map((s) => s.path), ['z.js']);
});

test('F225 no request carries a commit id — not the head, the base or the merge base — and none asks for one', async () => {
  const requests = [];
  const report = await runCodeReview({ session: session(), ...revision(1), judge: recording(requests) });
  assert.equal(report.codeCoverage, 'complete', 'premise: both files were placed and answered');
  assert.ok(requests.length >= 2);
  for (const request of requests) {
    const text = request.system + request.prompt;
    for (const oid of OIDS) assert.ok(!text.includes(oid), `${request.label} carries a commit id`);
    assert.ok(!/"revisionOid"/.test(request.prompt), `${request.label} renders a revision field`);
    assert.ok(!/copy revisionOid/.test(text), `${request.label} asks the model to copy a revision it is not shown`);
  }
  assert.ok(requests.some((r) => /^SOURCE \{"eventId":"diff:[a-f0-9]{16}","path":"a\.js"/m.test(r.prompt)),
    'premise: SOURCE blocks were rendered');
  // The JSON manifest a caller without a rendered manifest gets names files, never revisions.
  const snapshot = snapshotDiff(revision(1));
  const narrative = buildNarrativePrompt({ session: session(), window: planWindows(session())[0] });
  for (const request of [buildCodeReviewPrompt({ narrativePrompt: narrative, snapshot }),
    buildCodeReviewPrompt({ narrativePrompt: narrative, snapshot, placed: ['a.js'] })]) {
    assert.ok(request.prompt.includes('## Frozen PR manifest'), 'premise: the JSON manifest');
    for (const oid of OIDS) assert.ok(!request.prompt.includes(oid), 'the JSON manifest carries a commit id');
  }
});

test('F225 two revisions that differ only in file B: every request that carried only file A is byte-identical', async () => {
  const one = [], two = [];
  await runCodeReview({ session: session(), ...revision(1), judge: recording(one) });
  await runCodeReview({ session: session(), ...revision(2), judge: recording(two) });
  const onlyA = (requests) => requests.filter((r) => /:w1(?::|$)/.test(r.label)).map((r) => JSON.stringify([r.system, r.prompt])).sort();
  const first = onlyA(one), second = onlyA(two);
  assert.ok(first.length >= 1, 'premise: window 1 was asked');
  for (const bytes of first) {
    assert.ok(bytes.includes('SYNTHETIC_NEW_A();'), 'premise: window 1\'s requests carry a.js');
    assert.ok(!/SYNTHETIC_(?:OLD|NEW)_B/.test(bytes), 'premise: and nothing of b.js');
  }
  assert.deepEqual(second, first, 'a request that showed only a.js changed when only b.js and the head did');
  // Window 2 carried b.js, and is a new question: the premise that the revisions differ at all.
  const w2 = (requests) => requests.filter((r) => /code\+narrative:w2$/.test(r.label)).map((r) => r.prompt);
  assert.notDeepEqual(w2(two), w2(one));
});

test('F225 a code finding citing a content id anchors to its path, side and lines, at the revision its side names', async () => {
  const finding = (snapshot, side, quote, line) => ({ origin: 'code-review', kind: 'code_issue',
    title: `SYNTHETIC_F225 ${side} finding`, explanation: `The ${side} line establishes a synthetic defect in the head revision.`,
    receipts: [{ role: 'code', eventId: sourceOf(snapshot, 'a.js', side).eventId, quote }],
    scope: 'current-code', anchor: { path: 'a.js', side, startLine: line, endLine: line } });
  // One answer, given to both revisions: it cites a.js by id and names no revision at all.
  const answer = (snapshot) => (request) => (/code\+narrative:w1$/.test(request.label)
    ? [finding(snapshot, 'RIGHT', 'SYNTHETIC_NEW_A();', 2), finding(snapshot, 'LEFT', 'SYNTHETIC_OLD_A();', 2)] : []);
  const first = snapshotDiff(revision(1));
  for (const [n, head] of [[1, HEAD_1], [2, HEAD_2]]) {
    const report = await runCodeReview({ session: session(), ...revision(n), judge: recording([], answer(first)) });
    const published = report.findings.filter((f) => f.origin === 'code-review');
    assert.equal(published.length, 2, `revision ${n}: both findings are grounded`);
    const snapshot = snapshotDiff(revision(n));
    for (const [side, revisionOid] of [['RIGHT', head], ['LEFT', MERGE_BASE]]) {
      const f = published.find((x) => x.anchor.side === side);
      assert.deepEqual(f.anchor, { path: 'a.js', side, startLine: 2, endLine: 2 });
      assert.equal(f.receipts[0].eventId, sourceOf(snapshot, 'a.js', side).eventId);
      assert.equal(f.receipts[0].revisionOid, revisionOid, `revision ${n}: ${side} is read at its own revision`);
    }
  }
});

test('F225 a fabricated, foreign or misplaced source id, or a revision the source does not have, is still rejected', async () => {
  const one = snapshotDiff(revision(1)), two = snapshotDiff(revision(2));
  const right = sourceOf(one, 'a.js', 'RIGHT');
  const base = { origin: 'code-review', kind: 'code_issue', title: 'SYNTHETIC_F225 rejected finding',
    explanation: 'A synthetic claim about the head revision.', scope: 'current-code',
    anchor: { path: 'a.js', side: 'RIGHT', startLine: 2, endLine: 2 } };
  const cases = [
    ['a fabricated id', { eventId: 'diff:0123456789abcdef', quote: 'SYNTHETIC_NEW_A();' }],
    ['an id of another revision\'s block', { eventId: sourceOf(two, 'b.js', 'RIGHT').eventId, quote: 'SYNTHETIC_NEW_B_2_0();' }],
    ['another file\'s id for this anchor', { eventId: sourceOf(one, 'b.js', 'RIGHT').eventId, quote: 'SYNTHETIC_NEW_B_1_0();' }],
    ['the other side\'s id for this anchor', { eventId: sourceOf(one, 'a.js', 'LEFT').eventId, quote: 'SYNTHETIC_OLD_A();' }],
    ['a revision the source does not have', { eventId: right.eventId, quote: 'SYNTHETIC_NEW_A();', revisionOid: HEAD_2 }],
  ];
  for (const [name, receipt] of cases) {
    const report = await runCodeReview({ session: session(), ...revision(1), judge: recording([],
      (request) => (/code\+narrative:w1$/.test(request.label) ? [{ ...base, receipts: [{ role: 'code', ...receipt }] }] : [])) });
    assert.equal(report.findings.filter((f) => f.origin === 'code-review').length, 0, `${name} was published`);
    assert.equal(report.rejectedCodeFindings.length, 1, `${name} was not rejected`);
  }
});

test('F225 a manifest row carries its size only in a request that shows the file; the probe still bounds every manifest', () => {
  const rows = fileReview(snapshotDiff(revision(1, { bLines: 3 })));
  const manifest = renderManifest(rows, new Set(['a.js']));
  const line = (path) => manifest.split('\n').find((l) => l.startsWith(`- ${path} ·`));
  assert.equal(line('a.js'), '- a.js · modified · +1/-1 · shown');
  assert.equal(line('b.js'), '- b.js · modified · not shown', 'another file\'s size is not what this request shows');
  // b.js grown by two lines: a request that does not show it is the same bytes.
  const grown = fileReview(snapshotDiff(revision(2, { bLines: 5 })));
  assert.equal(renderManifest(grown, new Set(['a.js'])), manifest);
  // The byte-budget probe is never smaller than a manifest any request could carry.
  const widest = rows.map((row) => ({ ...row, reason: row.reason ?? 'oversize' }));
  const bytes = (text) => Buffer.byteLength(text, 'utf8');
  for (const shown of [[], ['a.js'], ['b.js'], ['a.js', 'b.js']])
    assert.ok(bytes(widestManifest(widest)) >= bytes(renderManifest(rows, new Set(shown))), `shown ${shown}`);
});
