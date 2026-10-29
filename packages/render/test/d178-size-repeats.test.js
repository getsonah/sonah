// D178 (0.3.0-beta.10): the header's size line says how many files the change holds with each repeat of another
// place's change counted once (evidence code-pass.js `changeRepeatsOf`), in one closed phrase of REPORT_HEADER_WORDS.change,
// only when some file repeats. The count, the lines, the coverage line and the Files section stay those of every file
// (D118 c: the size line's count is the Files section's). Pure renders of synthetic reports: two worktrees of one commit
// that hold 55 and 49 files, 46 of them the same.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage, escapeHtml } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { reportModel } from '../report-model.js';
import { REPORT_HEADER_WORDS } from '../report-words.js';
import { codeChangeTally, changeRepeatsOf } from '../../evidence/src/code-pass.js';
import { codeCoverageLines } from '../../evidence/src/code-report.js';
import { codeSession } from '../../cli/test/code-pass-fixture.js';

const COMMIT = '0'.repeat(40);
const A = '/work/wt-attest', B = '/work/wt-trail';
const digest = (k, tag) => `${tag}${String(k).padStart(4, '0')}`.padEnd(64, '0');
const place = (at, written, commit = COMMIT) => ({ kind: 'git', at, written, commit, how: 'reflog', changedOutside: [] });
/** 55 files in A, 49 in B; B's first `same` hold A's bytes, the rest share a path and not the bytes. Each +2 −1. */
function report({ same = 46, commitB = COMMIT } = {}) {
  const files = [], units = [];
  const add = (at, k, sha) => {
    const path = `${at}/src/f${k}.js`;
    files.push({ path, place: at, type: 'modified', state: 'shown', sha256: sha, hunks: 1, added: 2, removed: 1 });
    units.push({ path, place: at, state: 'whole', side: 'new', shown: [[1, 3]], beforeUnshown: 0, lines: 3,
      recorded: true });
  };
  for (let k = 0; k < 55; k++) add(A, k, digest(k, 'a'));
  for (let k = 0; k < 49; k++) add(B, k, k < same ? digest(k, 'a') : digest(k, 'b'));
  return { coverage: 'complete', sessionReview: 'complete', findings: [], requirements: [],
    codePass: { version: 'SYNTHETIC', ran: true, coverage: 'complete', gaps: [], files,
      base: { kind: 'git', commit: COMMIT, how: 'reflog', written: 104, changedOutside: [],
        places: [place(A, 55), place(B, 49, commitB)] },
      agent: { turns: 1, tools: { Read: 0, Grep: 0, Glob: 0 }, reads: 0, terminal: 'answered' },
      calls: { review: 1, repair: 0, verify: 0, verifyRepeat: 0, batch: 0, batchRepeat: 0 }, findings: [], questions: [],
      withheld: [], footer: [], triage: [], triageDropped: [], filesDropped: [],
      manifest: { review: { sent: true, bound: 1_620_000, files: units, rules: [], commands: { count: 0, from: 1,
        inPart: [] }, texts: [] } },
      agents: [{ label: 'code-review:agent', run: { turns: 1, tools: { Read: 0, Grep: 0, Glob: 0 }, unranged: 0,
        unrangedPaths: [], failed: [], reads: [] } }] } };
}

test('D178: 104 files, 46 of them repeats, say 58 with each repeat counted once; every other count stays 104', () => {
  const r = report();
  const tally = codeChangeTally(r.codePass);
  assert.equal(tally.total, 104);
  assert.deepEqual(changeRepeatsOf(r.codePass, tally), { repeats: 46, unproved: 0, distinct: 58 });
  const session = codeSession();
  const model = reportModel(session, r, {});
  const size = REPORT_HEADER_WORDS.change(104, '+208 −104', 2, 58);
  assert.equal(size, 'a change of 104 files (58 with each repeat counted once) in 2 repositories or folders, +208 −104');
  assert.ok(model.header.size.includes(size), JSON.stringify(model.header.size));
  // The Files section and the coverage line count every file, as the size line's first count does (D118 c).
  assert.equal(model.did.files.total, 104);
  assert.ok(codeCoverageLines(r.codePass).some((line) => line.startsWith('The change covers 104 files.')),
    JSON.stringify(codeCoverageLines(r.codePass)));
  // The page and the .md say it as the model does.
  assert.ok(renderSessionPage(session, r, {}).includes(escapeHtml(size)));
  assert.ok(renderReportMarkdown(session, r, {}).includes(size));
});

test('D178: with no repeat the size line is the words before D178, byte for byte', () => {
  for (const r of [report({ same: 0 }), report({ commitB: '1'.repeat(40) })]) {
    assert.equal(changeRepeatsOf(r.codePass).repeats, 0);
    const model = reportModel(codeSession(), r, {});
    assert.ok(model.header.size.includes('a change of 104 files in 2 repositories or folders, +208 −104'),
      JSON.stringify(model.header.size));
    assert.equal(JSON.stringify(model.header).includes('repeat'), false);
  }
  // D178's review: a pair the rule cannot compare (no head digest) beside the 46 repeats: no count is said, since "each
  // repeat counted once" would claim more than the rule proved; the line is the words before D178.
  const binary = report();
  for (const at of [A, B]) {
    const path = `${at}/assets/logo.png`;
    binary.codePass.files.push({ path, place: at, type: 'modified', state: 'shown', hunks: 0 });
    binary.codePass.manifest.review.files.push({ path, place: at, state: 'whole', side: 'new', shown: [], beforeUnshown: 0,
      lines: 0, recorded: true });
  }
  assert.deepEqual(changeRepeatsOf(binary.codePass), { repeats: 46, unproved: 2, distinct: null });
  const held = reportModel(codeSession(), binary, {}).header.size.find((part) => part.startsWith('a change of'));
  assert.ok(held.startsWith('a change of 106 files in 2 repositories or folders'), held);
  assert.equal(held.includes('repeat'), false);
  // The phrase is said only for a count below the whole.
  assert.equal(REPORT_HEADER_WORDS.change(4, '+30 −12', 2, 4), REPORT_HEADER_WORDS.change(4, '+30 −12', 2));
  assert.equal(REPORT_HEADER_WORDS.change(4, null, 2, 5), 'a change of 4 files in 2 repositories or folders');
});
