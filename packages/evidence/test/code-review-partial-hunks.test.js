// M28: synthetic-only partial diff evidence. No recording, provider or model is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCodeReview, snapshotDiff, validateAnchor } from '../src/code-review.js';

const path = 'docs/guide.md';
const diff = [
  `diff --git a/${path} b/${path}`,
  `--- a/${path}`,
  `+++ b/${path}`,
  '@@ -1 +1 @@',
  '-before-one',
  '+kept-one',
  '@@ -16 +16 @@',
  '-before-sixteen',
  '+kept-sixteen',
  '',
].join('\n');
const omitted = { oldStart: 8, oldLines: 1, newStart: 8, newLines: 1, reason: 'redacted_content' };
const pr = (withheldHunks = [omitted]) => ({ repo: { host: 'github.com', id: '9' }, number: 28,
  baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40), headOid: 'a'.repeat(40),
  gitAlgorithm: 'sha1', enumeration: 'complete',
  files: [{ path, change: 'modified', contentState: 'partial', withheldHunks }] });
const empty = () => ({ decisions: [], pivots: [], claims: [], requirements: [],
  codeFindings: [], sessionFindings: [], reviewedFiles: [path] });

test('M28: retained hunks keep original line anchors and omitted ranges cannot anchor', () => {
  const snapshot = snapshotDiff({ pr: pr(), diff });
  assert.equal(snapshot.complete, false);
  assert.deepEqual(snapshot.unreviewable, []);
  assert.ok(snapshot.sources.some((source) => source.side === 'RIGHT'
    && source.startLine === 16 && source.text === 'kept-sixteen'));
  assert.equal(validateAnchor(snapshot, { path, side: 'RIGHT', startLine: 16, endLine: 16 }), true);
  assert.equal(validateAnchor(snapshot, { path, side: 'RIGHT', startLine: 8, endLine: 8 }), false);
  assert.equal(validateAnchor(snapshot, { path, side: 'LEFT', startLine: 8, endLine: 8 }), false);
});

test('M28: reviewing clean hunks in a partial file never establishes complete code coverage', async () => {
  const requests = [];
  const report = await runCodeReview({ pr: pr(), diff, judge: async (request) => {
    requests.push(request);
    return empty();
  } });
  assert.ok(requests.some((request) => request.prompt.includes('+kept-one')
    && request.prompt.includes('+kept-sixteen')));
  assert.deepEqual(report.codeCoverageFacts.placed, [path]);
  assert.equal(report.codeCoverage, 'partial');
  assert.equal(report.codeStatus, 'UNCHECKED');
  assert.ok(report.gaps.some((gap) => gap.code === 'redacted_content'
    && gap.channel === 'code' && gap.scope === 'pr' && gap.count === 1));
});

test('M28: a grounded finding in a retained hunk survives with explicit partial coverage', async () => {
  const source = snapshotDiff({ pr: pr(), diff }).sources.find((entry) =>
    entry.path === path && entry.side === 'RIGHT' && entry.startLine === 16);
  assert.ok(source);
  const finding = { origin: 'code-review', kind: 'code_issue',
    title: 'Synthetic retained hunk issue',
    explanation: 'This synthetic line is deliberately identified as the source of a code issue.',
    receipts: [{ role: 'code', eventId: source.eventId,
      revisionOid: source.revisionOid, quote: 'kept-sixteen' }],
    scope: 'current-code', anchor: { path, side: 'RIGHT', startLine: 16, endLine: 16 } };
  const report = await runCodeReview({ pr: pr(), diff,
    judge: async () => ({ ...empty(), codeFindings: [finding] }),
    challengeJudge: async ({ challenge }) => ({ votes: challenge.items.map(({ key }) => ({ key,
      verdict: 'not-refuted', explanation: 'Synthetic source supports the exact claim.',
      receipts: finding.receipts })) }) });
  assert.ok(report.findings.some((item) => item.origin === 'code-review'));
  assert.equal(report.codeCoverage, 'partial');
  assert.equal(report.codeStatus, 'DECIDE');
});

test('M28: contradictory or unlocated omission inventory cannot license clean anchors', () => {
  for (const withheldHunks of [null,
    [{ ...omitted, oldStart: 1, newStart: 1 }],
    [{ ...omitted, oldStart: -1 }]]) {
    const snapshot = snapshotDiff({ pr: pr(withheldHunks), diff });
    assert.ok(snapshot.unreviewable.some((row) => row.path === path));
    assert.equal(validateAnchor(snapshot, { path, side: 'RIGHT', startLine: 16, endLine: 16 }), false);
  }
  const contradictory = pr([]);
  contradictory.files[0].contentState = 'complete';
  contradictory.files[0].withheldHunks = null;
  assert.ok(snapshotDiff({ pr: contradictory, diff }).unreviewable.some((row) => row.path === path));
});

test('M28: redacted file identity leaves unknown omission extent and partial code coverage', async () => {
  const context = pr([]);
  context.files[0].contentState = 'complete';
  context.files.push({ path: 'withheld-path-1', oldPath: null, change: 'modified',
    contentState: 'unavailable', withheldHunks: null });
  const report = await runCodeReview({ pr: context, diff, judge: async () => empty() });
  assert.equal(report.codeCoverage, 'partial');
  assert.equal(report.codeStatus, 'UNCHECKED');
  assert.ok(report.gaps.some((gap) => gap.code === 'redacted_content'
    && gap.scope === 'pr' && gap.count === null));
  assert.ok(report.gaps.some((gap) => gap.code === 'code_unreviewable'));
});
