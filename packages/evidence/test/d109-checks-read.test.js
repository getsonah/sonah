// D109 amended (2026-10-18; the owner: "go for fix first"): the truth check of a real report found "It did not see 56"
// while the code review's checks had read 8 of those files (one of them the line a confirmed finding rests on). What the
// code review saw stays what Sonah sent it and what the review agent and its repair read; the one tally now says, of each
// file, whether its checks read it (code-pass.js `codeChangeTally`'s `checksRead`), and every reader that says the
// review did not see files says how many of them its checks read, and whose reading Sonah counts. Synthetic manifests and
// reading records only: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeChangeTally } from '../src/code-pass.js';
import { CODE_REPORT_WORDS as W, codeCoverageLines, codeUnseenFiles, codeUnseenReadByChecks } from '../src/code-report.js';
import { REPORT_NOT_CHECKED_PARTS } from '../../render/report-words.js';

const run = (reads = [], { unrangedPaths = [], failed = [] } = {}) => ({ turns: 3, tools: { Read: reads.length, Grep: 0,
  Glob: 0 }, reads, unranged: unrangedPaths.length, unrangedPaths, failed });
const read = (path, ranges, lines) => ({ path, ranges, lines });
/** Five files of the change: two shown whole, three not shown (another repository). The review agent read one of the
 *  three in part; the checks read, between them, the other two — one by a Read with lines, one with none Sonah could
 *  read — and a failed Read of a shown file reads nothing. */
function record({ checks = true } = {}) {
  const whole = (path) => ({ path, state: 'whole', side: 'new', shown: [[1, 10]], beforeUnshown: 0, lines: 10,
    recorded: true });
  const unshown = (path) => ({ path, state: 'not_shown', reason: 'other_repository', side: 'new', shown: [],
    beforeUnshown: null, lines: 40, recorded: true });
  return { ran: true, coverage: 'partial', withheld: [], files: [], footer: [],
    agent: { turns: 3, tools: { Read: 1, Grep: 0, Glob: 0 }, reads: 1, terminal: 'answered' },
    manifest: { review: { sent: true, files: [whole('src/a.js'), whole('src/b.js'), unshown('other/c.py'),
      unshown('other/d.py'), unshown('other/e.py')], rules: [], commands: { count: 0, from: 1, inPart: [] }, texts: [] } },
    agents: [
      { label: 'code-review:agent', run: run([read('other/c.py', [[1, 20]], 40)]) },
      ...(checks ? [
        { label: 'code-verify:F1', run: run([read('other/d.py', [[300, 344]], 40), read('src/a.js', [[1, 10]], 10)]) },
        { label: 'code-verify:batch', run: run([], { unrangedPaths: ['other/e.py'] }) },
        { label: 'code-account:1', run: run([], { failed: [{ path: 'other/c.py' }] }) }] : [])] };
}

test('D109 amended: the one tally says which files the checks read; seeing stays what Sonah sent and what the review read', () => {
  const tally = codeChangeTally(record());
  // The review agent's own read keeps other/c.py seen in part; the checks' reads make no file seen.
  assert.deepEqual(tally.groups.in_part.map((u) => u.path), ['other/c.py']);
  assert.deepEqual(tally.groups.not_seen.map((u) => [u.path, u.checksRead]), [['other/d.py', true], ['other/e.py', true]]);
  assert.deepEqual(tally.units.map((u) => [u.path, u.checksRead]), [['src/a.js', true], ['src/b.js', false],
    ['other/c.py', false], ['other/d.py', true], ['other/e.py', true]], 'a failed Read reads nothing');
  assert.equal(codeUnseenFiles(record()), 2);
  assert.equal(codeUnseenReadByChecks(record()), 2);
  // With no check's reading record, as before: no file the checks read.
  assert.equal(codeUnseenReadByChecks(record({ checks: false })), 0);
});

test('D109 amended: the coverage line says how many of the files the code review did not see its checks read, and whose reading counts', () => {
  const [line] = codeCoverageLines(record());
  assert.equal(line, 'The change covers 5 files. The code review saw 2 of them whole. It saw 1 in part. It did not see 2. '
    + 'Its checks read both. Sonah counts as seen only what it sent the code review and what the code review read itself.');
  assert.equal(line, W.files(5, [['whole', 2], ['in_part', 1]], 2, 2));
  // One of the two read by a check: "1 of those 2".
  const one = record();
  one.agents = one.agents.filter((a) => a.label !== 'code-verify:batch');
  assert.ok(codeCoverageLines(one)[0].endsWith('It did not see 2. Its checks read 1 of those 2. Sonah counts as seen only '
    + 'what it sent the code review and what the code review read itself.'), codeCoverageLines(one)[0]);
  // No check read any of them: the line as before.
  assert.equal(codeCoverageLines(record({ checks: false }))[0], 'The change covers 5 files. The code review saw 2 of them '
    + 'whole. It saw 1 in part. It did not see 2.');
  // The real case's words: 110 files, 56 not seen, 8 of them read by the checks.
  assert.equal(W.files(110, [['whole', 53], ['in_part', 1]], 56, 8), 'The change covers 110 files. The code review saw 53 '
    + 'of them whole. It saw 1 in part. It did not see 56. Its checks read 8 of those 56. Sonah counts as seen only what '
    + 'it sent the code review and what the code review read itself.');
});

test('D109 amended: the header\'s count of files the code review did not see says how many of them its checks read, from the same tally', () => {
  const p = record();
  assert.equal(REPORT_NOT_CHECKED_PARTS.unseenFiles(codeUnseenFiles(p), codeUnseenReadByChecks(p)),
    '2 files of the change that the code review did not see (its checks read both)');
  assert.equal(REPORT_NOT_CHECKED_PARTS.unseenFiles(56, 8),
    '56 files of the change that the code review did not see (its checks read 8 of them)');
  assert.equal(REPORT_NOT_CHECKED_PARTS.unseenFiles(3), '3 files of the change that the code review did not see');
  // A request too large to send, or a review that did not answer: nothing seen, and no check counted.
  const unsent = record();
  unsent.manifest.review.sent = false;
  assert.equal(codeUnseenReadByChecks(unsent), 0);
  const silent = { ...record(), agent: { terminal: 'failed' }, agents: record().agents.map((a) => (a.label
    === 'code-review:agent' ? { ...a, run: run() } : a)) };
  silent.agents[0].run.turns = 0;
  assert.equal(codeUnseenReadByChecks(silent), 0);
});

test('D109 amended: the report model\'s first screen and its coverage line carry the checks\' reads', async () => {
  const { reportModel } = await import('../../render/report-model.js');
  const { Session } = await import('../src/session.js');
  const p = { ...record(), version: { pass: 'sonah.code-pass/12' }, base: { kind: 'recorded_edits' }, calls: {} };
  const model = reportModel(new Session({ sessionKey: 'session', events: [] }), { reviewScope: 'session-only',
    requirements: [], decisions: [], codePass: p }, {});
  const said = (parts) => parts.map((part) => part.text).join('');
  assert.ok(model.header.didNotCheck.phrases.includes('2 files of the change that the code review did not see (its checks '
    + 'read both)'), JSON.stringify(model.header.didNotCheck));
  assert.ok(model.notChecked.code.map(said).includes(`${codeCoverageLines(p)[0]}`), JSON.stringify(model.notChecked.code
    .map(said)));
});
