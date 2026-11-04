// D207's review of real reports: four fixed sentences that real reports showed to be false, each said again only on a
// record of D207's code step (an earlier record keeps its words). 1. The files outside the evaluated session: "changed
// outside this session's recorded writes" stood beside files of the change that no recorded write changed; now the files,
// then what holds of them all by what the record shows, then, where it can work, the way to a branch's changes. 2. The code
// step's line: "one review call", where a change split into parts makes one for each. 3. A review that saw the whole change
// and only a check fell short (the change seen 73 of 73 whole): the terminal said it "did not cover all of the change". 4.
// The docs: a review that did not complete "asks again only what failed", where any change to what the session review found
// asks the code review again in whole.
//
// Pure records and snapshots made by hand, and the docs: no model, no network, no clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BRANCH_WORDS, CODE_REPORT_WORDS as W, codeChangedOutsideLine, codeNoChangeOf, codePlaceLines, outsideHowOf,
  outsideLeadHowOf } from '../../evidence/src/code-report.js';
import { CODE_UNIT_LIMITS } from '../../evidence/src/code-pass.js';
import { codeSnapshotLine, codeStepLine } from '../src/session-review-command.js';
import { REPORT_DID_WORDS } from '../../render/report-words.js';

const COMMIT = 'c'.repeat(40);
const NOW = 'sonah.code-pass/14';
const BEFORE = 'sonah.code-pass/13';
const OLD = 'changed outside this session\'s recorded writes';
const MINE = Object.freeze([{ path: 'src/a.js', state: 'shown', diff: 'recorded' }]);
const AWAY = Object.freeze(['docs/a.md', 'lib/b.js']);
/** A code pass record of the working folder's git repository, the files outside the evaluated session `AWAY`. */
const record = (base = {}, { version = NOW, files = MINE } = {}) => ({ version: { pass: version }, ran: true,
  base: { kind: 'git', commit: COMMIT, how: 'reflog', written: 1, changedOutside: [...AWAY], ...base }, files,
  withheld: [], footer: [], coverage: 'complete' });

test('D207\'s review of real reports: the line of the files outside the evaluated session says what holds of them, by the record, and the way out where it can work; an earlier record keeps its words', () => {
  // Git and every recording could say: no commit of the session holds them, and none was left uncommitted.
  const sure = record();
  assert.equal(codeNoChangeOf(sure), null, 'a change of the session\'s own');
  assert.equal(outsideHowOf(sure), 'commit');
  const line = codeChangedOutsideLine(sure);
  assert.equal(line, W.changedOutside(AWAY, 0, W.outsideWhy.commit(2), true));
  assert.ok(line.startsWith('Sonah did not review 2 files outside the evaluated session: docs/a.md, lib/b.js. No recorded '
    + 'write changed them, and Sonah found no commit of the session that changed them itself.'), line);
  assert.ok(line.endsWith(BRANCH_WORDS), line);
  assert.equal(line.includes(OLD), false, line);
  // The window alone: nothing is said of commits.
  const window = codeChangedOutsideLine(record({ timeByWindow: true }));
  assert.equal(window, W.changedOutside(AWAY, 0, W.outsideWhy.window(2), true));
  assert.equal(window.includes('commit'), false, window);
  // A base the person named: only an untracked file is outside, placed by the window; no way out to name again.
  const named = codeChangedOutsideLine(record({ namedRef: 'main' }));
  assert.equal(named, W.changedOutside(AWAY, 0, W.outsideWhy.window(2), false));
  assert.equal(named.includes('--code-base'), false, named);
  // No change of the session's own: the first screen's reason names the way out, so this line does not repeat it.
  const empty = record({}, { files: [] });
  assert.notEqual(codeNoChangeOf(empty), null);
  assert.equal(codeChangedOutsideLine(empty), W.changedOutside(AWAY, 0, W.outsideWhy.commit(2), false));
  // An earlier record: its words, byte for byte.
  const earlier = record({}, { version: BEFORE });
  assert.equal(outsideHowOf(earlier), null);
  assert.equal(codeChangedOutsideLine(earlier), W.changedOutside(AWAY));
  assert.ok(codeChangedOutsideLine(earlier).includes(OLD));
  // The words of a file outside given to the code review: the same, in their own form.
  assert.equal(W.outsideFiles(['docs/a.md'], 0, W.outsideWhy.window(1)), '1 file is outside the evaluated session: '
    + 'docs/a.md. No recorded write changed it, and Sonah found no change to it while the agent worked.');
});

test('D207\'s review of real reports: another place says what holds of its own files, by its own record; the files list\'s lead says what holds of them all', () => {
  const place = (over) => ({ kind: 'git', at: '/work/other', written: 1, commit: COMMIT, how: 'reflog',
    changedOutside: ['/work/other/x.md'], ...over });
  for (const [over, how] of [[{}, 'commit'], [{ timeByWindow: true }, 'window']]) {
    const pass = record({ places: [place(over)] });
    assert.equal(outsideHowOf(pass, place(over)), how);
    const lines = codePlaceLines(pass);
    assert.ok(lines.includes(W.placeChangedOutside('/work/other', ['/work/other/x.md'], 0, W.outsideWhy[how](1))),
      JSON.stringify(lines));
    assert.equal(lines.some((l) => l.includes(OLD) || l.includes('--code-base')), false, JSON.stringify(lines));
  }
  // The lead: one way where every place says the same, else what holds of both.
  assert.equal(outsideLeadHowOf(record({ places: [place({})] })), 'commit');
  assert.equal(outsideLeadHowOf(record({ timeByWindow: true, places: [place({ timeByWindow: true })] })), 'window');
  assert.equal(outsideLeadHowOf(record({ places: [place({ timeByWindow: true })] })), 'end');
  assert.equal(outsideLeadHowOf(record({ changedOutside: [], places: [place({ timeByWindow: true })] })), 'window');
  assert.equal(outsideLeadHowOf(record({}, { version: BEFORE })), null);
  assert.equal(outsideLeadHowOf(record({ changedOutside: [] })), null);
  // `end` holds of both: it says nothing of commits, and nothing of a change the window alone could not place.
  assert.equal(W.outsideWhy.end(3), 'No recorded write changed them. Sonah found no change to them while the agent worked '
    + 'that was still uncommitted when the agent stopped.');
  assert.equal(REPORT_DID_WORDS.outsideSession(3, W.outsideWhy.end(3)), `3 files are outside the evaluated session. ${
    W.outsideWhy.end(3)}`);
  assert.ok(REPORT_DID_WORDS.outsideSession(3).includes(OLD), 'an earlier record keeps its words');
});

/** A snapshot of the working folder's git repository as the CLI reads it: one recorded write, `away` outside. */
const snapshot = (base = {}, { files = [{ path: 'src/a.js', diff: 'recorded', recorded: true, text: 'a\n' }] } = {}) => ({
  root: true, dir: '/work/repo', realRoot: '/work/repo', top: '/work/repo', repository: true,
  base: { kind: 'git', commit: COMMIT, how: 'reflog', outside: 0, written: 1, changedOutside: [...AWAY], ...base }, files,
  plan: [] });

test('D207\'s review of real reports: the terminal says what holds of the paths outside, as the page does, and the way out once', () => {
  const sure = codeSnapshotLine(snapshot());
  assert.ok(sure.includes(` 2 more paths are outside the evaluated session. ${W.outsideWhy.commit(2)} Sonah leaves them `
    + 'out of the change.'), sure);
  assert.equal(sure.split(BRANCH_WORDS).length, 2, sure);
  assert.equal(sure.includes(OLD), false, sure);
  const window = codeSnapshotLine(snapshot({ timeByWindow: true }));
  assert.ok(window.includes(` 2 more paths are outside the evaluated session. ${W.outsideWhy.window(2)}`), window);
  const named = codeSnapshotLine(snapshot({ namedRef: 'main' }));
  assert.ok(named.includes(W.outsideWhy.window(2)), named);
  assert.equal(named.includes(BRANCH_WORDS), false, named);
  // No change of its own: the way out still once.
  const none = codeSnapshotLine(snapshot({}, { files: [] }));
  assert.equal(none.split(BRANCH_WORDS).length, 2, none);
  // Another place: by its own snapshot.
  const placed = codeSnapshotLine(snapshot({ places: [{ kind: 'git', at: '/work/other', written: 1, commit: COMMIT,
    how: 'reflog', changedOutside: ['/work/other/x.md'], timeByWindow: true }] }));
  assert.ok(placed.includes(` 1 more path there is outside the evaluated session. ${W.outsideWhy.window(1)}`), placed);
  assert.equal(placed.includes(OLD), false, placed);
});

test('D207\'s review of real reports: the code step\'s line says one review call for each part of the change, at most the units one review plans', () => {
  const line = codeStepLine({ on: true, source: 'default' }, { root: true, files: [{ path: 'a.js', diff: 'recorded' }] });
  assert.ok(line.includes(`It adds one review call for each part of the change (at most ${CODE_UNIT_LIMITS.units}) and one `
    + 'check call for each finding.'), line);
  assert.equal(/one review call[,.]/.test(line), false, line);
});

test('D207\'s review of real reports: the docs say that a rerun asks the code review again in whole when what the session review found changes', async () => {
  const flat = (text) => text.replace(/\s+/g, ' ');
  const doc = async (path) => flat(await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8'));
  const install = await doc('docs/INSTALL.md');
  assert.equal(install.includes('asks again only what failed'), false);
  assert.ok(install.includes('A stored answer is reused only for the same input, and the code review\'s input holds what '
    + 'the session review found: when the rerun changes that, the code review is asked again in whole.'));
  assert.ok(install.includes('The code review\'s requests hold what the session review found, so when that changes, every '
    + 'code review request is new and is asked again.'));
  const trouble = await doc('docs/TROUBLESHOOTING.md');
  assert.equal(trouble.includes('Then run the same command again: only those parts are asked again.'), false);
  assert.ok(trouble.includes('only those parts of the session review are asked again. The code review\'s input holds what '
    + 'the session review found, so when their answers change it, the code review is asked again in whole.'));
  assert.ok(trouble.includes('while the repository and what the session review found are unchanged, the answers that came '
    + 'back are reused and only these are asked again'));
  assert.equal(trouble.includes('so the next run asks it again and reuses every other stored answer. The exit'), false);
  assert.ok(trouble.includes('If that check now keeps a decision, what the session review found changes, and so does the '
    + 'code review\'s input, so the code review is asked again in whole.'));
  // The rows quote the page's words now, and name an earlier report's.
  assert.ok(trouble.includes('| Sonah did not review files outside the evaluated session (a report from before these words: '
    + '"files that changed outside this session\'s recorded writes") |'));
  assert.ok(trouble.includes(W.outsideWhy.commit(2)) && trouble.includes(W.outsideWhy.window(2)));
  assert.ok(trouble.includes('code review covered the whole change, but some of its checks gave no result that Sonah '
    + 'could use'));
});
