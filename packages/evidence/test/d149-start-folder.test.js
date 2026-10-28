// D149: the start-commit folder, as the code step asks for it and reads it. In a review of several units with a start
// commit, the code step asks the CLI once (`startFolder`) for the files of the change that have an earlier side; every
// request of the review then names the folder in its where block and gives it to its agent (`addDirs`); the record keeps
// each file's copy and the lines its hunks hold on the earlier side (`before`, as the snapshot widened them). A review
// agent's Reads of a copy that cover those lines are the earlier side read (`codeSeenOf`). Today's one request asks for
// none.
//
// Synthetic files and sessions, a fake folder maker and fake agents: no recording, no model, no network, nothing written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, isCodeReviewLabel, codeSeenOf } from '../src/code-pass.js';
import * as fixture from '../../cli/test/code-pass-fixture.js';
import { scenario, linesOf, GIT, ROOT } from './d149-hunk-ledger-fixture.js';

const mods = { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, fixture };
const B_BEFORE = linesOf('bb', 300);
const B_NOW = B_BEFORE.replace('bb 00010', 'BB 00010');
const patchB = () => {
  const a = B_BEFORE.split('\n').slice(0, -1), b = B_NOW.split('\n').slice(0, -1);
  const rows = [];
  for (let l = 7; l <= 13; l++) rows.push(...(l === 10 ? [`-${a[l - 1]}`, `+${b[l - 1]}`] : [` ${a[l - 1]}`]));
  return ['diff --git a/src/one/b.js b/src/one/b.js', 'index 1111111..2222222 100644', '--- a/src/one/b.js',
    '+++ b/src/one/b.js', '@@ -7,7 +7,7 @@', ...rows, ''].join('\n');
};
/** Two units: U1 a.js (added) and b.js (modified in line 10); U2 c.js (added). */
const FILES = Object.freeze({ 'src/one/a.js': linesOf('aa', 4_000), 'src/one/b.js': B_NOW, 'src/two/c.js': linesOf('cc', 3_500) });
const MODIFIED = Object.freeze({ 'src/one/b.js': { before: B_BEFORE, patch: patchB() } });
const AT = '/synthetic/state/code-pass/start-commit';
const LINE = `The changed files as they were at the start commit ${GIT.commit}, each by its path from the repository's top `
  + `folder: ${AT}`;
const onB = () => fixture.reviewFinding({ title: 'SYNTHETIC b.js line 10', trace: [{ step: 'SYNTHETIC line 10.',
  path: 'src/one/b.js', side: 'new', startLine: 10, endLine: 10, quote: 'BB 00010' }],
anchor: { path: 'src/one/b.js', side: 'new', startLine: 10, endLine: 10 } });

async function run({ files = FILES, modified = MODIFIED, maker } = {}) {
  const f = scenario(mods, { files, modified });
  const seen = [];
  const judge = async (request) => {
    seen.push(request);
    if (/^code-account:\d+(:reask)?$/.test(request.label)) return fixture.accountsHold(request.prompt);
    if (request.label === 'code-review:review:U1:R1') return { findings: [onB()], questions: [] };
    if (isCodeReviewLabel(request.label)) return { findings: [], questions: [] };
    if (/^code-verify:F\d+/.test(request.label)) return fixture.holds(fixture.verifiedFinding(request.prompt));
    throw new Error(`unexpected request ${request.label}`);
  };
  const { codePass } = await runCodePass({ report: f.report, session: f.session, snapshot: f.snapshot, repo: f.repo,
    judge, base: GIT, root: ROOT, top: ROOT, wholeFiles: false, startFolder: maker });
  return { codePass, seen };
}

test('D149: a review of several units asks once for the folder of the files with an earlier side; every request names it and reads it; the record keeps each copy', async () => {
  const asked = [];
  const maker = async (ask) => { asked.push(ask); return { at: AT, files: ask.paths.map((path) => ({ path,
    copy: `${AT}/${path}` })), chunks: 1, failedChunks: 0 }; };
  const { codePass, seen } = await run({ maker });
  assert.deepEqual(asked, [{ commit: GIT.commit, paths: ['src/one/b.js'] }]);
  const units = seen.filter((r) => isCodeReviewLabel(r.label));
  const checks = seen.filter((r) => /^code-verify:F\d+$/.test(r.label));
  assert.deepEqual([units.length, checks.length], [2, 1]);
  for (const r of [...units, ...checks]) {
    assert.ok(r.prompt.includes(LINE), r.label);
    assert.ok(r.agent.addDirs.includes(AT), r.label);
  }
  assert.deepEqual(codePass.startFolder, { at: AT, commit: GIT.commit, files: [{ path: 'src/one/b.js',
    copy: `${AT}/src/one/b.js`, before: [[2, 14]] }], chunks: 1, failedChunks: 0 });
  // No folder made (the CLI's answer null), or its making failed: no line, no record, and the review goes on.
  for (const maker of [async () => null, async () => { throw new Error('synthetic'); }]) {
    const { codePass: none, seen: noneSeen } = await run({ maker });
    assert.ok(noneSeen.every((r) => !r.prompt.includes('as they were at the start commit')));
    assert.deepEqual([none.startFolder, none.ran, noneSeen.filter((r) => isCodeReviewLabel(r.label)).length],
      [undefined, true, 2]);
  }
});

test('D149: today\'s one request asks for no folder', async () => {
  const asked = [];
  const { codePass } = await run({ files: { 'src/one/b.js': B_NOW }, maker: async (ask) => { asked.push(ask);
    return { at: AT, files: [], chunks: 0, failedChunks: 0 }; } });
  assert.deepEqual([asked, codePass.startFolder], [[], undefined]);
});

test('D149: the review\'s Reads of a file\'s copy that cover the lines its hunks hold on the earlier side are that side seen', () => {
  const record = (copyRanges) => ({ agent: { terminal: 'answered' },
    manifest: { review: { sent: true, rules: [], files: [{ path: 'src/b.js', state: 'left_out', reason: 'request_bound',
      side: 'new', shown: [], change: [[10, 10]], beforeUnshown: 7, lines: 300, recorded: true }] } },
    agents: [{ label: 'code-review:review:U1:R1', run: { turns: 3, tools: { Read: 2, Grep: 0, Glob: 0 },
      reads: [{ path: 'src/b.js', ranges: [[1, 300]], lines: 300 },
        ...(copyRanges ? [{ path: `${AT}/src/b.js`, ranges: copyRanges, lines: 300 }] : [])],
      unranged: 0, unrangedPaths: [], failed: [] } }],
    startFolder: { at: AT, commit: GIT.commit, files: [{ path: 'src/b.js', copy: `${AT}/src/b.js`, before: [[7, 13]] }] } });
  const seen = (copyRanges) => codeSeenOf(record(copyRanges)).files.map((x) => [x.state, x.changeSeen]);
  assert.deepEqual(seen([[1, 300]]), [['whole', true]]);
  assert.deepEqual(seen([[7, 13]]), [['whole', true]]);
  assert.deepEqual(seen([[7, 10]]), [['whole', false]]);
  assert.deepEqual(seen(null), [['whole', false]]);
});
