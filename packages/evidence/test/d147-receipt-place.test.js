// D147 (0.3.0-beta.9): the code review's checks across several worktrees of one repository. A relative path that names
// an existing file in more than one place of the change names none of them (D122: the repository reader's `name`), and
// the repair of the review's own items already says so. Every other reader of a receipt now keeps that reason too: a
// finding's check, the questions' check and the accounting void such a receipt with a closed cause of its own
// (`receipt_path_ambiguous`), re-asked in the repair's words, never as a quote not found word for word. And when more
// than one place holds a file of the change, every brief says that a path is the file's absolute path; a change with one
// place gets every request byte as before. Grounding stays word for word: a receipt holds only when its quote is on the
// named lines of the file its path resolves to, and an ambiguous relative path is never resolved by a guess.
//
// Synthetic sessions and files, an in-memory repository reader and deterministic fake agents: no recording, no model, no
// network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CODE_VOID_CAUSES, CODE_ACCOUNT_MISSING } from '../src/ledger.js';
import * as codePass from '../src/code-pass.js';
import { CODE_REPORT_WORDS } from '../src/code-report.js';
import * as fixture from '../../cli/test/code-pass-fixture.js';
import { runScenario, ROOT, SIBLING } from './d147-receipt-place-fixture.js';
import { verifyBriefBeforeTruthOnly } from './m33-integration-fixture.js';

const { CODE_VOID_CAUSE_WORDS, CODE_ITEM_ERROR_WORDS, CODE_PATH_RULES, CODE_BRIEFS_ABSOLUTE, CODE_REVIEW_SYSTEM,
  CODE_REVIEW_SYSTEM_WHOLE_FILES, CODE_VERIFY_SYSTEM, CODE_BATCH_VERIFY_SYSTEM, CODE_ACCOUNT_SYSTEM, manyPlacesHold,
  groundingContext, readFindingVerdict, readBatchVerdicts, readAccountEntries, accountEntries, planReviewRequest,
  shownAsOf, codeSnapshotPlan, freezeCodeSnapshot, changeBlock } = codePass;
const sha = (text) => createHash('sha256').update(text).digest('hex');
const flat = (text) => text.replace(/\s+/g, ' ');
const run = (options) => runScenario({ ...codePass, fixture }, options);
const LINE_2 = Object.freeze({ side: 'new', startLine: 2, endLine: 2, quote: fixture.PARSE_QUOTE });

/** A repository reader with `src/parse.js` in two places: its relative path names none (D122), its absolute paths each
 *  name their own file. */
const twoPlaces = () => {
  const text = fixture.CODE_FILES['src/parse.js'];
  const files = { 'src/parse.js': text, [`${SIBLING}/src/parse.js`]: text };
  const named = (path) => (String(path).startsWith(`${ROOT}/`) ? String(path).slice(ROOT.length + 1) : String(path));
  return { root: ROOT, top: ROOT, base: () => null,
    read: (path) => (Object.hasOwn(files, named(path)) ? { path: named(path), text: files[named(path)],
      sha256: sha(files[named(path)]) } : null),
    name: (path) => (path === 'src/parse.js' ? { ambiguous: true } : { path }) };
};

test('D147: the closed cause of a receipt whose relative path more than one place holds, its re-ask words (the '
  + 'repair\'s) and its page words', () => {
  assert.equal(CODE_VOID_CAUSES.at(-1), 'receipt_path_ambiguous');
  assert.ok(Object.isFrozen(CODE_VOID_CAUSES));
  // Re-asked in the words the repair of the review's own items already says it in: name the file by its absolute path.
  assert.equal(CODE_VOID_CAUSE_WORDS.receipt_path_ambiguous, CODE_ITEM_ERROR_WORDS.path_ambiguous);
  assert.match(CODE_VOID_CAUSE_WORDS.receipt_path_ambiguous, /name it by its absolute path$/);
  assert.notEqual(CODE_VOID_CAUSE_WORDS.receipt_path_ambiguous, CODE_VOID_CAUSE_WORDS.receipt_ungrounded);
  // Every void cause has re-ask words and page words.
  for (const cause of CODE_VOID_CAUSES) {
    assert.equal(typeof CODE_VOID_CAUSE_WORDS[cause], 'string', cause);
    assert.equal(typeof CODE_REPORT_WORDS.causes[cause], 'string', cause);
  }
  assert.equal(CODE_REPORT_WORDS.causes.receipt_path_ambiguous, 'the check named a path that more than one repository '
    + 'of the change holds, so Sonah could not tell which file it means');
});

test('D147: every reader of a receipt keeps the reason — a finding\'s check, a premise\'s receipt, the questions\' '
  + 'check and the accounting each void it receipt_path_ambiguous; a quote not on its lines stays receipt_ungrounded; '
  + 'an absolute path grounds', () => {
  const session = fixture.codeSession();
  const context = groundingContext({ repo: twoPlaces(), session });
  const relative = { path: 'src/parse.js', ...LINE_2 };
  const absolute = { path: `${ROOT}/src/parse.js`, ...LINE_2 };
  const sibling = { path: `${SIBLING}/src/parse.js`, ...LINE_2 };
  const nowhere = { ...absolute, quote: 'SYNTHETIC words on no line of the file' };
  // A finding's check: its receipts, and a premise's.
  const finding = { claims: [], anchor: { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2 },
    trace: [{ path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2, quote: fixture.PARSE_QUOTE }] };
  const verdict = (receipts, premiseReceipts = [absolute]) => ({ verdict: 'holds', reason: null, claims: [], receipts,
    premises: [{ premise: 'SYNTHETIC: the lines show it.', source: 'repository', receipts: premiseReceipts }],
    breaks: [], explanation: 'SYNTHETIC: traced.' });
  assert.deepEqual(readFindingVerdict(verdict([relative]), finding, context),
    { ok: false, cause: 'receipt_path_ambiguous', at: 'src/parse.js:2' });
  assert.deepEqual(readFindingVerdict(verdict([absolute], [relative]), finding, context),
    { ok: false, cause: 'receipt_path_ambiguous', at: 'src/parse.js:2' });
  assert.deepEqual(readFindingVerdict(verdict([nowhere]), finding, context),
    { ok: false, cause: 'receipt_ungrounded', at: `${ROOT}/src/parse.js:2` });
  // Any other receipt that does not ground keeps the old cause: a file that is not there, and a quote off its lines.
  const unreadable = { ...absolute, path: `${ROOT}/src/missing.js` };
  const offLines = { ...absolute, startLine: 4, endLine: 4 };
  for (const r of [unreadable, offLines, { ...relative, path: 'src/missing.js' }])
    assert.equal(readFindingVerdict(verdict([r]), finding, context).cause, 'receipt_ungrounded', r.path);
  const held = readFindingVerdict(verdict([absolute]), finding, context);
  assert.equal(held.ok, true);
  // Grounded on the file the absolute path names, under the name the change gives it.
  assert.deepEqual(held.receipts.map((r) => [r.path, r.quote]), [['src/parse.js', fixture.PARSE_QUOTE]]);
  // The questions' check.
  const batch = (receipts) => readBatchVerdicts({ questions: [{ key: 'Q1', verdict: 'sound', receipts,
    explanation: 'SYNTHETIC: traced.' }] }, [{ key: 'Q1', list: 'questions' }], context).get('Q1');
  assert.deepEqual(batch([relative]), { ok: false, cause: 'receipt_path_ambiguous', at: 'Q1 src/parse.js:2' });
  assert.deepEqual(batch([sibling, nowhere]), { ok: false, cause: 'receipt_ungrounded', at: `Q1 ${ROOT}/src/parse.js:2` });
  assert.equal(batch([sibling]).ok, true);
  for (const r of [{ ...absolute, path: `${ROOT}/src/missing.js` }, { ...sibling, startLine: 4, endLine: 4 }])
    assert.equal(batch([r]).cause, 'receipt_ungrounded', r.path);
  // The accounting, and what the entry's fate records: evidence that did not ground, as a quote not found does.
  const entry = (receipts) => readAccountEntries({ entries: [{ key: 'S1', outcome: 'holds', receipts, by: null,
    finding: null }], findings: [] }, ['S1'], { context }).get('S1');
  assert.deepEqual(entry([relative]), { state: 'void', cause: 'receipt_path_ambiguous', at: 'S1 src/parse.js:2' });
  assert.deepEqual(entry([nowhere]), { state: 'void', cause: 'receipt_ungrounded', at: `S1 ${ROOT}/src/parse.js:2` });
  assert.equal(entry([absolute]).state, 'ok');
  for (const r of [{ ...absolute, path: `${ROOT}/src/missing.js` }, { ...absolute, startLine: 4, endLine: 4 }])
    assert.equal(entry([r]).cause, 'receipt_ungrounded', r.path);
  const item = { key: 'S1', source: 'requirements', index: 0, id: null };
  const fateOf = (cause) => accountEntries({ inScope: [{ item, scope: 'ask' }], batches: [{ keys: ['S1'], state: 'ok',
    read: new Map([['S1', { state: 'void', cause, at: 'S1', reasked: true }]]) }] })[0];
  assert.deepEqual([fateOf('receipt_path_ambiguous').cause, fateOf('receipt_ungrounded').cause, fateOf('shape').cause],
    ['evidence_grounding_failed', 'evidence_grounding_failed', 'malformed']);
  assert.ok(CODE_ACCOUNT_MISSING.includes('evidence_grounding_failed'));
});

test('D147: in a change that two places hold, the checks that named the file by a relative path are re-asked in the '
  + 'repair\'s words, and ground when the re-ask names it by its absolute path', async () => {
  const seen = [];
  const { codePass: pass } = await run({ places: 'both', first: false, again: true, seen });
  assert.deepEqual(seen.map((r) => r.label), ['code-review:agent', 'code-verify:F1', 'code-verify:batch',
    'code-account:1', 'code-verify:F1:reask', 'code-verify:batch:reask', 'code-account:1:reask']);
  // Each re-ask names the cause and its words, never "not word for word".
  for (const label of ['code-verify:F1:reask', 'code-verify:batch:reask', 'code-account:1:reask']) {
    const prompt = seen.find((r) => r.label === label).prompt;
    assert.ok(prompt.includes(`receipt_path_ambiguous (${CODE_ITEM_ERROR_WORDS.path_ambiguous}) at `), label);
    assert.ok(!prompt.includes(CODE_VOID_CAUSE_WORDS.receipt_ungrounded), label);
  }
  // The finding is published checked, the question checked, the ask accounted for: the coverage is complete.
  assert.deepEqual(pass.findings.map((f) => [f.anchor.path, f.check?.verdict]), [['src/parse.js', 'holds']]);
  assert.deepEqual(pass.withheld, []);
  assert.deepEqual(pass.questions.map((q) => q.check?.verdict), ['sound']);
  assert.deepEqual(pass.account.entries.map((e) => [e.key, e.fate, e.reasked]), [['S1', 'holds', true]]);
  assert.equal(pass.coverage, 'complete');
});

test('D147: a re-ask that still names a relative path keeps the reason: the finding is withheld with the cause '
  + 'receipt_path_ambiguous, the question is published unchecked, the ask is missing, the coverage partial', async () => {
  const { codePass: pass } = await run({ places: 'both', first: false, again: false });
  assert.deepEqual(pass.withheld.map((w) => [w.what, w.reason, w.cause]),
    [['finding', 'verify_unexecuted', 'receipt_path_ambiguous']]);
  assert.deepEqual(pass.questions.map((q) => q.check ?? null), [null]);
  assert.deepEqual(pass.account.entries.map((e) => [e.fate, e.cause, e.reasked]),
    [['missing', 'evidence_grounding_failed', true]]);
  assert.equal(pass.coverage, 'partial');
  // Precision: the relative path is never resolved to one of the places by a guess, even though the quote is on line 2
  // of both files.
  assert.ok(!JSON.stringify(pass.findings).includes(SIBLING));
});

test('D147: when more than one place holds a file of the change, every brief says once where it says what a path is '
  + 'that a path is the file\'s absolute path; nothing else of a brief moves', async () => {
  const seen = [];
  await run({ places: 'both', first: true, seen });
  const systems = Object.fromEntries(seen.map((r) => [r.label.replace(/:F\d+|:\d+/, ''), r.system]));
  assert.deepEqual(systems, { 'code-review:agent': CODE_BRIEFS_ABSOLUTE.reviewWholeFiles,
    'code-verify': CODE_BRIEFS_ABSOLUTE.verify, 'code-verify:batch': CODE_BRIEFS_ABSOLUTE.batch,
    'code-account': CODE_BRIEFS_ABSOLUTE.account });
  const one = { review: CODE_REVIEW_SYSTEM, reviewWholeFiles: CODE_REVIEW_SYSTEM_WHOLE_FILES, verify: CODE_VERIFY_SYSTEM,
    batch: CODE_BATCH_VERIFY_SYSTEM, account: CODE_ACCOUNT_SYSTEM };
  const count = (text, words) => flat(text).split(words).length - 1;
  for (const [name, brief] of Object.entries(CODE_BRIEFS_ABSOLUTE)) {
    assert.equal(count(brief, CODE_PATH_RULES.relative), 0, name);
    // Where the one-place brief says a path is relative, the brief says it is absolute, once each.
    assert.equal(count(brief, CODE_PATH_RULES.absolute), count(one[name], CODE_PATH_RULES.relative), name);
    assert.ok(count(brief, CODE_PATH_RULES.absolute) >= 1, name);
    assert.equal(brief.split(CODE_PATH_RULES.absolute).join(CODE_PATH_RULES.relative), one[name], name);
  }
});

test('D147: a change with one place gets every request byte as before — the working folder\'s repository alone (with '
  + 'or without a listed place that holds none of it), or one other place alone; the briefs are beta.7\'s, byte for '
  + 'byte', async () => {
  // The briefs, each as 0.3.0-beta.7 shipped it. D152 moved a finding's checking brief alone (code-verify/5): rendered
  // back (`verifyBriefBeforeTruthOnly`, a no-op on every other brief), beta.7's.
  assert.notEqual(verifyBriefBeforeTruthOnly(CODE_VERIFY_SYSTEM), CODE_VERIFY_SYSTEM);
  assert.deepEqual(Object.fromEntries(Object.entries({ CODE_REVIEW_SYSTEM, CODE_REVIEW_SYSTEM_WHOLE_FILES,
    CODE_VERIFY_SYSTEM, CODE_BATCH_VERIFY_SYSTEM, CODE_ACCOUNT_SYSTEM }).map(([k, v]) => [k,
    sha(verifyBriefBeforeTruthOnly(v))])), {
    CODE_REVIEW_SYSTEM: 'ec27cbc9d64bafbaace4f51a422642f6c0d7a3c58d2e3dd12da651bf9acd52de',
    CODE_REVIEW_SYSTEM_WHOLE_FILES: '8f5df35d39d4bf1169874abbc6ee1a696abd19fec2494d5595f921d9eb4f1d24',
    CODE_VERIFY_SYSTEM: '7802732393914a3d3d3c0c87c0053acd06a72bc1e192abf7334fc12b51f5907f',
    CODE_BATCH_VERIFY_SYSTEM: '742ca8d694f48f5e0d154db92095baea52c9bbe74ce0a8dd75c9019bb9008ba2',
    CODE_ACCOUNT_SYSTEM: '26ae1e42f5cf5309ba170bc03b4a319117c094e5326a6cc37f21cb7074a5bca7' });
  // Every request of the step, its brief and its prompt, as the code of 0.3.0-beta.7 sent it for the same scenario
  // (computed once against `git archive b261849a` and this fixture); D152's brief rendered back.
  const sent = async (places) => {
    const seen = [];
    await run({ places, first: false, again: false, seen });
    return seen.map((r) => [r.label, sha(`${verifyBriefBeforeTruthOnly(r.system)}\u0000${r.prompt}`)]);
  };
  const ONE = [
    ['code-review:agent', 'e3fc5f09d28fbd962be1174d5226936e5a1dbf59e5f0e75ae651d406878d2d4a'],
    ['code-verify:F1', 'cb12de2e77e597896f2fd2ba386236d3a9541da5374e030b0fec9fa97c25eecb'],
    ['code-verify:batch', '6de6a40e54b60745929340052fba9bb10c73587ab1fa47b34365ea00334763ff'],
    ['code-account:1', 'ca2eb98be17e2954442337b9a5a639e8a47f5c760071919f78908d40f6198689']];
  assert.deepEqual(await sent('one'), ONE);
  // A place the base lists that holds no file of the change is no place of it: one place, the same bytes.
  assert.deepEqual(await sent('listed'), ONE);
  assert.deepEqual(await sent('sibling'), [
    ['code-review:agent', 'c639c37030e63b1d1b213d5131863ad8a1a89a4e92084156bcf5371d39027a24'],
    ['code-verify:F1', '8bf1af949ccab49d2852e5f7aaf06b00dfc6c50f196356c1696c2f664a1d3f8f'],
    ['code-verify:batch', '77f74fcf0e9aea5f816218d65eee63f7264c58d4db8f1bc9cfdefb3a6604e1ec'],
    ['code-account:1', 'a96c84bf64a29c888c39b53ab9b8dc87c1838805c863c2d54437edea57c68c83']]);
});

test('D147: how many places hold a file of the change, by structure — the working folder\'s repository when a file of '
  + 'the change has no place, and each other place that holds one', () => {
  const here = { path: 'src/a.js', diff: 'git' };
  const there = { path: '/w/B/a.js', place: '/w/B', diff: 'git' };
  const unchanged = { path: 'src/b.js' };
  const B = { at: '/w/B' }, C = { at: '/w/C' };
  assert.equal(manyPlacesHold([here], []), false);
  assert.equal(manyPlacesHold([there], [B]), false);
  assert.equal(manyPlacesHold([here, there], [B]), true);
  assert.equal(manyPlacesHold([there, { ...there, path: '/w/C/a.js', place: '/w/C' }], [B, C]), true);
  // A path with no difference is no file of the change.
  assert.equal(manyPlacesHold([unchanged, there], [B]), false);
  assert.equal(manyPlacesHold([], []), false);
});

test('D147: in a change that two places hold, every request names each file of the change by its absolute path — no '
  + 'relative name of the working repository\'s file is left to be ambiguous', async () => {
  const seen = [];
  await run({ places: 'both', first: true, seen });
  assert.equal(seen.length, 4);
  for (const r of seen) {
    // The table of contents and the hunks' headers, the whole files, the commands' files, the finding a check is given,
    // the accounting's findings: each by the absolute path.
    assert.ok(r.prompt.includes(`- ${ROOT}/src/parse.js → lines `), r.label);
    assert.ok(r.prompt.includes(`diff --git a/${ROOT}/src/parse.js b/${ROOT}/src/parse.js`), r.label);
    for (const relativeName of ['- src/parse.js', 'a/src/parse.js', '"path":"src/parse.js"', '"paths":["src/parse.js"'])
      assert.ok(!r.prompt.includes(relativeName), `${r.label}: ${relativeName}`);
  }
  const review = seen.find((r) => r.label === 'code-review:agent').prompt;
  assert.ok(review.includes(`FILE {"path":"${ROOT}/src/parse.js","lines":4}`));
  assert.ok(review.includes(`{"path":"${ROOT}/src/parse.js","commandsAfterLastEdit":"none","move":"never_ran"}`));
  assert.ok(seen.find((r) => r.label === 'code-verify:F1').prompt.includes(`"path":"${ROOT}/src/parse.js","side":"new"`));
  assert.ok(seen.find((r) => r.label === 'code-account:1').prompt.includes(`"anchor":{"path":"${ROOT}/src/parse.js"`));
});

test('D147: the review request\'s every block shows a path by the name `where` gives it — absolute with more than one '
  + 'place, itself with one', () => {
  const session = fixture.codeSession();
  const plan = codeSnapshotPlan(session);
  const enc = (text) => new TextEncoder().encode(text);
  const files = freezeCodeSnapshot(plan, plan.map((e) => ({ path: e.path, bytes: enc(fixture.CODE_FILES[e.path] ?? '') })),
    { base: { kind: 'recorded_edits' } });
  const outsideFiles = files.map((f) => ({ ...f, path: 'src/gen.js' }));
  const inputs = { words: { asked: ['SYNTHETIC ask'], asks: [] },
    projectFiles: [{ path: 'CLAUDE.md', kind: 'project', actor: 'person', text: 'SYNTHETIC rules\n' }], files,
    dossier: [{ key: 'S1', kind: 'ask', actor: 'person', shown: { asked: 'SYNTHETIC ask' }, paths: ['src/parse.js'] }],
    commands: { commands: [{ n: 1, at: 9, text: 'npm test', exit: 0 }], files: [{ path: 'src/parse.js', first: 1 }] },
    sessionReads: [{ path: 'src/util.js', lines: 3, read: [[1, 2]], text: fixture.CODE_FILES['src/util.js'] }],
    outsideFiles, startCommit: true };
  const many = { root: ROOT, top: ROOT, places: [{ kind: 'recorded_edits', at: SIBLING, written: 1 }], absoluteNames: true };
  const one = { root: ROOT, top: ROOT, places: [] };
  const prompt = (where) => planReviewRequest({ ...inputs, where }).request.prompt;
  const shown = {
    'the table of contents': (p) => `- ${p}src/parse.js → lines `, 'the instruction files': (p) => `"path":"${p}CLAUDE.md"`,
    'the whole files': (p) => `FILE {"path":"${p}src/parse.js"`, 'the reads': (p) => `FILE {"path":"${p}src/util.js"`,
    'the dossier': (p) => `"paths":["${p}src/parse.js"]`, 'the commands': (p) => `{"path":"${p}src/parse.js","first`,
    'the files outside the evaluated session': (p) => `- ${p}src/gen.js`,
  };
  for (const [block, text] of Object.entries(shown)) {
    assert.ok(prompt(many).includes(text(`${ROOT}/`)), `${block}: absolute`);
    assert.ok(!prompt(many).includes(text('')), `${block}: no relative name`);
    assert.ok(prompt(one).includes(text('')), `${block}: one place, as before`);
  }
  // The name, by structure: a relative path joined to the working directory; an absolute or home-spelled one as it is.
  const as = shownAsOf(many);
  assert.deepEqual(['src/a.js', '../x.js', `${SIBLING}/a.js`, '~/notes.md', '$HOME/n.md'].map(as),
    [`${ROOT}/src/a.js`, '/work/x.js', `${SIBLING}/a.js`, '~/notes.md', '$HOME/n.md']);
  assert.equal(shownAsOf(one)('src/a.js'), 'src/a.js');
  assert.equal(shownAsOf({ ...many, root: null })('src/a.js'), 'src/a.js');
});

test('D147: the change block fills its cap by the bytes it shows each file in: with absolute names, a file it shows '
  + 'never puts the block over its cap', () => {
  const session = fixture.codeSession();
  const plan = codeSnapshotPlan(session);
  const enc = (text) => new TextEncoder().encode(text);
  const files = freezeCodeSnapshot(plan, plan.map((e) => ({ path: e.path, bytes: enc(fixture.CODE_FILES[e.path] ?? '') })),
    { base: { kind: 'recorded_edits' } });
  const shownAs = shownAsOf({ root: '/a/long/working/directory/of/the/session', absoluteNames: true });
  let shownAt = null;
  for (let maxBytes = 50; maxBytes < 3000; maxBytes++) {
    const block = changeBlock(files, { maxBytes, shownAs });
    if (!block.shown.size) continue;
    shownAt ??= maxBytes;
    assert.ok(Buffer.byteLength(block.change) <= maxBytes, `${maxBytes}: ${Buffer.byteLength(block.change)}`);
  }
  // And it shows the file once the cap holds it by that name, later than by its relative one.
  assert.ok(shownAt > Math.min(...Array.from({ length: 2950 }, (_, i) => i + 50)
    .filter((maxBytes) => changeBlock(files, { maxBytes }).shown.size)), String(shownAt));
});
