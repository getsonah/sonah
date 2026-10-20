// D113 amended (2026-10-18; the owner, in chat: "changed during the session is fine, for code review, you can even
// review code that is outside the session, but tag it by outside the evaluated session"): the files git shows differing
// from the session's start commit that no recorded write of the session could have changed (D113's files named apart)
// are given to the code review too — in a block of their own after the session's own change, giving way first when the
// request's one bound bites — and every finding anchored in one is tagged so and ties to no item of the session.
//
// The invariants here, of the request planner and of a finding's grounding (code-pass.js `planReviewRequest`,
// `outsideBlock`, `groundFinding`): (1) a request planned with no such file is the one planned before this amendment,
// byte for byte; (2) over generated changes and bounds, the session's own part of every request — what its manifest
// shows of each file, rule, read and command, and whether it is sent — is the one planned without them, and while their
// block stands nothing of the session's own change gave way; a request without their block is the one planned without
// them, byte for byte; (3) their block comes after the session's own change and before the dossier; (4) a finding
// with no changed line of the session's own in its scope, anchored in such a file or in scope by their lines alone, is
// `outsideSession`, and one whose scope holds a changed line of the session's own is the session's (judgment call (h),
// settled by the owner: "b"); an ask not met or a claim the code contradicts tagged so is out of scope, keeping its tag
// (its second review); their lines count for scope as the session's own do (its review); (5) its review:
// a finding on such a file withheld after its check, or by its scope, keeps its tag and ties to nothing, and its row
// says why a tie kind is withheld by its kind.
//
// Synthetic files and an in-memory repository reader: no recording, no model, no network, no clock or random read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { freezeCodeSnapshot, planReviewRequest, groundingContext, groundFinding, outsideBlock, codeSnapshotPlan,
  runCodePass, codeChangeTally, CODE_OUTSIDE_BLOCK, CODE_OUTSIDE_YIELD, OUTSIDE_SESSION_WORDS, CODE_REQUEST_BLOCKS,
  CODE_REQUEST_BLOCKS_WHOLE_FILES, CODE_RULE_BLOCK_MAX_BYTES } from '../src/code-pass.js';
import { changedSpans, ELSEWHERE_ROW_WORDS } from '../src/code-context.js';
import { reviewInputBytes } from '../src/challenge.js';
import { CODE_REPORT_WORDS, withheldWhy, codeCoverageLines, codeFooterLines } from '../src/code-report.js';
import { memoryRepo, buildCodeSession, codeSession, CODE_TEXT, CODE_FILES, holds, allSound, accountsHold,
  verifiedFinding, batchItems, reviewFinding, codeJudge, readsEveryFile, SYNTHETIC_RUN } from '../../cli/test/code-pass-fixture.js';

const enc = (text) => new TextEncoder().encode(text);
const ROOT = '/work/repo';
const GIT = { kind: 'git', commit: 'a'.repeat(40), how: 'reflog' };
const ASK = 'SYNTHETIC_ASK: change the modules.';
const CHANGE_HEADING = '# The change — built by Sonah';
const OUTSIDE_HEADING = `# The files ${OUTSIDE_SESSION_WORDS}`;
const READS_HEADING = '# The lines of unchanged tracked files the session read';
const DOSSIER_HEADING = '# Sonah\'s review of the session (the dossier)';

/** `n` lines of `width` bytes each (a file's text, ending in a line end). */
const linesOf = (tag, n, width = 40) => Array.from({ length: n }, (_, i) => `${tag} ${String(i + 1).padStart(5, '0')}`
  .padEnd(width, '.')).join('\n') + '\n';
/** git's own patch of a file whose line `at` changed, three lines of context; and its text before and after. */
function modified(path, n, at) {
  const before = linesOf(path, n);
  const line = `${path} ${String(at).padStart(5, '0')}`;
  const after = before.replace(line, line.toUpperCase());
  const a = before.split('\n').slice(0, -1), b = after.split('\n').slice(0, -1);
  const from = Math.max(1, at - 3), to = Math.min(a.length, at + 3);
  const rows = [];
  for (let l = from; l <= to; l++) { if (l === at) rows.push(`-${a[l - 1]}`, `+${b[l - 1]}`); else rows.push(` ${a[l - 1]}`); }
  const patch = [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`,
    `@@ -${from},${to - from + 1} +${from},${to - from + 1} @@`, ...rows, ''].join('\n');
  return { path, before, after, patch };
}
/** git's own patch of an added file of `n` lines. */
function added(path, n) {
  const after = linesOf(path, n);
  const rows = after.split('\n').slice(0, -1);
  return { path, before: null, after, patch: [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null',
    `+++ b/${path}`, `@@ -0,0 +1,${rows.length} @@`, ...rows.map((r) => `+${r}`), ''].join('\n') };
}
/** The frozen files of a git base: `own` written by a recorded write, `away` by none (D113's files named apart). */
function frozen(changes, recorded) {
  const plan = changes.map((c) => ({ path: c.path, recordedPath: c.path, changed: true, recorded, outside: false,
    last: null, edits: [] }));
  const reads = changes.map((c) => ({ path: c.path, bytes: enc(c.after), type: c.before === null ? 'added' : 'modified',
    ...(c.before === null ? {} : { base: { bytes: enc(c.before) } }), patch: c.patch }));
  return freezeCodeSnapshot(plan, reads, { base: GIT });
}
/** A deterministic generator (a linear congruential one): the same seed, the same cases. */
const lcg = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
/** The session's own part of a manifest: what it shows of each unit, and whether the request is sent. */
const ownPart = (m) => ({ sent: m.sent, files: m.files, rules: m.rules, commands: m.commands, reads: m.reads ?? null,
  texts: m.texts });

test('D113 amended: a request planned with no file outside the evaluated session is the one planned before, byte for byte', () => {
  const own = frozen([modified('src/a.js', 30, 5)], true);
  for (const wholeFiles of [false, true]) {
    const inputs = { words: { asked: [ASK] }, files: own, elsewhere: 2, where: { root: ROOT, top: null }, wholeFiles };
    assert.deepEqual(planReviewRequest({ ...inputs, outsideFiles: [] }), planReviewRequest(inputs));
  }
  // The change block counts the files named apart, tagged in the fixed words.
  assert.equal(ELSEWHERE_ROW_WORDS(2), '- and 2 more paths differ from the start commit in the working directory, changed '
    + `outside this session's recorded writes: ${OUTSIDE_SESSION_WORDS}, not part of this change`);
  assert.equal(CODE_REPORT_WORDS.outsideTag, OUTSIDE_SESSION_WORDS, 'the readers\' tag is the request\'s');
  assert.deepEqual(CODE_OUTSIDE_YIELD, ['outsideHunks', CODE_OUTSIDE_BLOCK]);
});

test('D113 amended invariant: over generated changes and bounds, the files outside the evaluated session give way first — the session\'s own part is the one planned without them, and nothing of it gives way while their block stands', () => {
  const random = lcg(1130);
  let cases = 0, bit = 0, gone = 0, stood = 0;
  for (let round = 0; round < 60; round++) {
    const own = frozen(Array.from({ length: 1 + Math.floor(random() * 3) }, (_, i) => (random() < 0.3
      ? added(`src/n${i}.js`, 5 + Math.floor(random() * 300)) : modified(`src/m${i}.js`, 20 + Math.floor(random() * 600),
        3 + Math.floor(random() * 15)))), true);
    const away = frozen(Array.from({ length: 1 + Math.floor(random() * 5) }, (_, i) => (random() < 0.5
      ? added(`docs/later${i}.md`, 5 + Math.floor(random() * 400)) : modified(`lib/old${i}.js`,
        20 + Math.floor(random() * 500), 3 + Math.floor(random() * 15)))), false);
    const projectFiles = random() < 0.5 ? [{ path: 'CLAUDE.md', kind: 'project', text: linesOf('rule', 40 + Math.floor(
      random() * 200)) }] : [];
    for (const wholeFiles of [false, true]) {
      const inputs = { words: { asked: [ASK] }, projectFiles, files: own, elsewhere: away.length,
        where: { root: ROOT, top: null }, wholeFiles };
      const fullOwn = planReviewRequest(inputs);
      const fullBoth = planReviewRequest({ ...inputs, outsideFiles: away });
      const most = reviewInputBytes(fullBoth.request);
      const least = Math.floor(reviewInputBytes(fullOwn.request) * 0.3);
      // The minimum of the session's own request (what a request too large to send names), and just above it.
      const minimum = reviewInputBytes({ system: '', prompt: '' }) + planReviewRequest({ ...inputs, bound: 0 }).manifest
        .bytes.total;
      for (const bound of [minimum, minimum + 1, Infinity, most, most - 1, Math.floor((most + reviewInputBytes(fullOwn.request)) / 2),
        reviewInputBytes(fullOwn.request), reviewInputBytes(fullOwn.request) - 1, least + Math.floor(random() * (most
          - least)), least]) {
        cases++;
        const label = `${round} ${wholeFiles} ${bound}`;
        const without = planReviewRequest({ ...inputs, bound });
        const both = planReviewRequest({ ...inputs, bound, outsideFiles: away });
        // The session's own part is the one planned without them, at every bound; so is whether the request is sent.
        assert.deepEqual(ownPart(both.manifest), ownPart(without.manifest), label);
        assert.equal(both.request === null, without.request === null, label);
        if (both.request === null) continue;
        const shown = both.request.prompt.includes(OUTSIDE_HEADING);
        if (!shown) {
          // Their block gave way whole: the request is the one planned without them, byte for byte.
          gone++;
          assert.deepEqual(both.request, without.request, label);
          assert.equal(both.outside, null, label);
          assert.ok(both.manifest.outsideFiles.every((e) => e.shown.length === 0), label);
        } else {
          // While their block stands, nothing of the session's own change gave way.
          stood++;
          assert.deepEqual(ownPart({ ...without.manifest, sent: true }), ownPart(fullOwn.manifest), label);
          if (bound < reviewInputBytes(fullBoth.request)) bit++;
          // Their block after the session's own change (and part B's blocks), before the dossier.
          const at = (heading) => both.request.prompt.indexOf(heading);
          assert.ok(at(CHANGE_HEADING) < at(OUTSIDE_HEADING) && at(OUTSIDE_HEADING) < at(DOSSIER_HEADING), label);
          if (both.request.prompt.includes(READS_HEADING)) assert.ok(at(READS_HEADING) < at(OUTSIDE_HEADING), label);
          const names = Object.keys(both.manifest.bytes).filter((k) => !['brief', 'total'].includes(k));
          const ownNames = both.request.prompt.includes(READS_HEADING) ? CODE_REQUEST_BLOCKS_WHOLE_FILES
            : CODE_REQUEST_BLOCKS;
          assert.deepEqual(names.filter((n) => n !== CODE_OUTSIDE_BLOCK), [...ownNames], label);
          assert.equal(names.indexOf(CODE_OUTSIDE_BLOCK), names.indexOf(ownNames.includes('reads') ? 'reads' : 'change')
            + 1, label);
        }
        // Their manifest: one entry for each of them, in their table's order, apart from the session's own.
        assert.deepEqual(both.manifest.outsideFiles.map((e) => e.path), away.map((f) => f.path).sort(), label);
        assert.ok(both.manifest.outsideFiles.every((e) => e.recorded === false), label);
        assert.ok(!both.manifest.files.some((e) => away.some((f) => f.path === e.path)), label);
      }
    }
  }
  // Every case is generated: their block given whole, in part (the bound bites), and given way whole.
  assert.ok(cases > 0 && bit > 0 && gone > 0 && stood > bit, JSON.stringify({ cases, bit, gone, stood }));
});

test('D113 amended: their block shows them under its own heading and note, by their table of contents and hunks, with no dossier key beside a row', () => {
  const away = frozen([modified('lib/old.js', 30, 4), added('docs/later.md', 3)], false);
  const block = outsideBlock(away);
  assert.ok(block.text.startsWith(`${OUTSIDE_HEADING} — built by Sonah`), block.text);
  assert.ok(block.text.includes(`they are ${OUTSIDE_SESSION_WORDS}`));
  assert.ok(block.text.includes('never ask_not_met or claim_false'), 'the tie kinds are named');
  assert.match(block.text, /^- docs\/later\.md → lines \d+-\d+ · added · not written by a recorded edit$/m);
  assert.match(block.text, /^- lib\/old\.js → lines \d+-\d+ · modified · not written by a recorded edit$/m);
  assert.deepEqual([...block.shown].sort(), ['docs/later.md', 'lib/old.js']);
  // At no room for their hunks, the table of contents alone.
  const toc = outsideBlock(away, { room: 0 });
  assert.equal(toc.shown.size, 0);
  assert.ok(!toc.text.includes('diff --git'));
});

test('D113 amended: a finding with no changed line of the session\'s own in its scope, anchored in a file outside the evaluated session or in scope by their lines alone, is outsideSession, and one in scope by the session\'s own lines is the session\'s (h, "b"); an ask not met or a claim the code contradicts tagged so is out of scope, tagged', () => {
  const own = modified('src/a.js', 30, 10);
  const away = modified('lib/old.js', 30, 12);
  const files = { 'src/a.js': own.after, 'lib/old.js': away.after, 'docs/guide.md': linesOf('guide', 10) };
  const repo = memoryRepo({ root: ROOT, now: files, before: { 'src/a.js': own.before, 'lib/old.js': away.before } });
  const [ownFile] = frozen([own], true);
  const [awayFile] = frozen([away], false);
  const changed = new Map([[ownFile.path, changedSpans(ownFile.hunks)]]);
  const outsideChanged = new Map([[awayFile.path, changedSpans(awayFile.hunks)]]);
  const session = buildCodeSession('s-d113-outside', CODE_TEXT, [{ id: 'I1', kind: 'instruction', blob: 'ask',
    turn: 'T1' }]);
  const context = groundingContext({ repo, session, changed, outsideChanged });
  const lineOf = (path, n) => files[path].split('\n')[n - 1];
  const step = (path, n) => ({ step: 'Synthetic step.', path, side: 'new', startLine: n, endLine: n,
    quote: lineOf(path, n).slice(0, 40) });
  const finding = (kind, anchorPath, n, trace = [step(anchorPath, n)]) => ({ kind, lens: 'behaviour', title: 'T',
    claims: [], input: 'i', trace, anchor: { path: anchorPath, side: 'new', startLine: n, endLine: n }, leadsFrom: [] });
  // The session's own change: in scope, untagged.
  const mine = groundFinding(finding('bug', 'src/a.js', 10), context);
  assert.equal(mine.ok, true);
  assert.equal(mine.outsideSession, undefined);
  // Anchored in a file outside the evaluated session, on its changed line: in scope, tagged.
  const theirs = groundFinding(finding('bug', 'lib/old.js', 12), context);
  assert.deepEqual([theirs.ok, theirs.outsideSession], [true, true]);
  // A broken contract elsewhere, in scope by their changed line alone: tagged; by the session's own line: not tagged.
  const byTheirs = groundFinding(finding('contract_break', 'docs/guide.md', 3, [step('docs/guide.md', 3),
    step('lib/old.js', 12)]), context);
  assert.deepEqual([byTheirs.ok, byTheirs.outsideSession], [true, true]);
  const byMine = groundFinding(finding('contract_break', 'docs/guide.md', 3, [step('docs/guide.md', 3),
    step('src/a.js', 10)]), context);
  assert.deepEqual([byMine.ok, byMine.outsideSession], [true, undefined]);
  // Judgment call (h), settled by the owner (2026-10-18: "b"): anchored in such a file, in scope by a changed line of the
  // session's own, it is the session's finding: untagged, and it keeps its ties (a tie kind among them, in scope).
  const out = { ok: false, error: 'out_of_scope', at: 'anchor' };
  for (const kind of ['contract_break', 'rule_break', 'claim_false']) {
    const anchoredThere = groundFinding(finding(kind, 'lib/old.js', 2, [step('lib/old.js', 2), step('src/a.js', 10)]),
      context);
    assert.deepEqual([anchoredThere.ok, anchoredThere.outsideSession], [true, undefined], kind);
    // The same with only their changed line in its scope: tagged (a tie kind out of scope, tagged).
    const onlyTheirs = groundFinding(finding(kind, 'lib/old.js', 2, [step('lib/old.js', 2), step('lib/old.js', 12)]),
      context);
    assert.deepEqual(onlyTheirs, kind === 'claim_false' ? { ...out, outsideSession: true }
      : { ok: true, trace: onlyTheirs.trace, anchor: onlyTheirs.anchor, outsideSession: true }, kind);
  }
  // The kinds that are a tie to an item of the session keep the session's own change as their scope; out of scope for
  // that, the result keeps the tag (D113 amended, its second review).
  for (const kind of ['ask_not_met', 'claim_false']) {
    assert.deepEqual(groundFinding(finding(kind, 'lib/old.js', 12), context), { ...out, outsideSession: true }, kind);
    assert.equal(groundFinding(finding(kind, 'src/a.js', 10), context).ok, true, kind);
  }
  assert.deepEqual(groundFinding(finding('claim_false', 'docs/guide.md', 3, [step('docs/guide.md', 3), step('lib/old.js',
    12)]), context), { ...out, outsideSession: true }, 'a claim the code contradicts in scope by their lines alone');
  // Its second review (low): anchored in a file of the session's own change on a line it did not touch, its only changed
  // line in scope theirs: a claim the code contradicts is out of scope and tagged, so it ties to nothing.
  assert.deepEqual(groundFinding(finding('claim_false', 'src/a.js', 2, [step('src/a.js', 2), step('lib/old.js', 12)]),
    context), { ...out, outsideSession: true });
  // With no file outside the evaluated session given, their lines are out of scope, as before this amendment.
  const before = groundingContext({ repo, session, changed });
  assert.deepEqual(groundFinding(finding('bug', 'lib/old.js', 12), before), out);
  // Their lines count for scope as the session's own do: anchored in such a file on a line its change did not touch,
  // with no changed line of either in its scope, out of scope (as on a line of the session's own file it did not touch);
  // anchored in such a file, tagged.
  for (const [path, n] of [['lib/old.js', 2], ['src/a.js', 2]]) {
    const tag = path === 'lib/old.js' ? { outsideSession: true } : {};
    assert.deepEqual(groundFinding(finding('bug', path, n), context), { ...out, ...tag }, path);
    assert.deepEqual(groundFinding(finding('contract_break', path, n), context), { ...out, ...tag }, path);
  }
  // The item-by-item check's context (`runCodePass`'s `ownContext`: their lines given, `outsideScope` false): their
  // lines put no finding in scope but tag one by the same rule; a finding in scope by the session's own lines is the
  // session's, wherever it is anchored (h).
  const ownContext = groundingContext({ repo, session, changed, outsideChanged, outsideScope: false });
  for (const kind of ['contract_break', 'claim_false']) {
    const ownThere = groundFinding(finding(kind, 'lib/old.js', 12, [step('lib/old.js', 12), step('src/a.js', 10)]),
      ownContext);
    assert.deepEqual([ownThere.ok, ownThere.outsideSession], [true, undefined], kind);
    assert.deepEqual(groundFinding(finding(kind, 'lib/old.js', 12), ownContext), { ...out, outsideSession: true }, kind);
    assert.deepEqual(groundFinding(finding(kind, 'src/a.js', 2, [step('src/a.js', 2), step('lib/old.js', 12)]),
      ownContext), { ...out, outsideSession: true }, kind);
  }
  assert.deepEqual(groundFinding(finding('bug', 'lib/old.js', 12), ownContext), { ...out, outsideSession: true });
  assert.equal(groundFinding(finding('bug', 'src/a.js', 10), ownContext).outsideSession, undefined);
});

/** The fixture's session writing src/parse.js, with lib/old.js outside the evaluated session (its line 1 changed by no
 *  recorded write), a session review's report and an in-memory repository; `run` the code pass over them with `judge`
 *  (every request kept in `seen`), at `bound`, with or without the files outside the evaluated session. */
function outsideFixture({ rules = null } = {}) {
  const ROOT_ = '/work/repo';
  const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
  const PARSE_PATCH = ['diff --git a/src/parse.js b/src/parse.js', 'index 1111111..2222222 100644', '--- a/src/parse.js',
    '+++ b/src/parse.js', '@@ -1,4 +1,4 @@', ' export function parse(input) {', '-  const parts = input.split(";");',
    '+  const parts = input.split(",");', '   return parts.map((part) => part.trim());', ' }', ''].join('\n');
  const OLD = { before: 'export const old = 1;\nexport const other = 3;\n', after: 'export const old = 2;\nexport const other = 3;\n' };
  const OLD_PATCH = ['diff --git a/lib/old.js b/lib/old.js', 'index 1111111..2222222 100644', '--- a/lib/old.js',
    '+++ b/lib/old.js', '@@ -1,2 +1,2 @@', '-export const old = 1;', '+export const old = 2;', ' export const other = 3;',
    ''].join('\n');
  // With `rules`, the session also loaded a rule file of yours (CLAUDE.md) holding them; else the fixture's session.
  const T1 = { turn: 'T1' };
  const session = rules === null ? codeSession() : buildCodeSession('sess-code-pass', { ...CODE_TEXT, rules }, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }],
  { projectInstructions: [{ path: 'CLAUDE.md', blob: 'rules' }] });
  const plan = codeSnapshotPlan(session);
  const snapshot = freezeCodeSnapshot(plan, plan.map((e) => (e.path === 'src/parse.js' ? { path: e.path,
    bytes: enc(CODE_FILES[e.path]), type: 'modified', base: { bytes: enc(BASE_PARSE) }, patch: PARSE_PATCH }
    : { path: e.path, state: 'deleted' })), { base: GIT });
  const outsideSnapshot = freezeCodeSnapshot([{ path: 'lib/old.js', recordedPath: 'lib/old.js', changed: true,
    recorded: false, outside: false, last: null, edits: [] }], [{ path: 'lib/old.js', bytes: enc(OLD.after),
    type: 'modified', base: { bytes: enc(OLD.before) }, patch: OLD_PATCH }], { base: GIT });
  const repo = memoryRepo({ root: ROOT_, now: { ...CODE_FILES, 'lib/old.js': OLD.after },
    before: { 'src/parse.js': BASE_PARSE, 'lib/old.js': OLD.before } });
  const R = (eventId, role, quote) => ({ eventId, role, quote });
  const report = { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', pr: null, codeCoverage: 'missing',
    coverage: 'complete', sessionReview: 'complete', findings: [], decisions: [], failures: [], writtenClaims: [],
    promises: [{ id: `sha256:${'1'.repeat(64)}`, stated: R('C1', 'commentary', 'parse now returns an empty list for '
      + 'empty input.'), text: 'The agent said parse returns an empty list.', status: 'open', receipts: [] }],
    requirements: [{ text: 'Return [] for empty input.', instruction: R('I1', 'instruction', CODE_TEXT.ask),
      status: 'partly-done', deliverable: R('W1', 'code', 'export function parse(input) {'),
      shortfall: R('C1', 'commentary', 'parse now returns an empty list for empty input.') }] };
  const run = (seen, judge, bound = Infinity, withOutside = true) => runCodePass({ report, session, snapshot, repo, bound,
    judge: async (request) => { seen.push(request); return judge(request); },
    base: { ...GIT, changedOutside: ['lib/old.js'], written: 1 }, root: ROOT_,
    ...(withOutside ? { outsideSnapshot } : {}) });
  return { run };
}
/** A judge of the fixture's code pass: the review agent answers `review`, a finding's check `verify(finding)`; every
 *  question sound and every item of the item-by-item check holding. */
const outsideJudge = ({ review, verify = holds }) => async (request) => {
  if (request.label === 'code-review:agent') return review;
  if (request.label === 'code-review:repair') return { findings: [], questions: [] };
  if (/^code-verify:F\d+(?::reask)?$/.test(request.label)) return verify(verifiedFinding(request.prompt));
  if (/^code-verify:batch(?::reask)?$/.test(request.label)) return allSound(batchItems(request.prompt));
  if (/^code-account:\d+(?::reask)?$/.test(request.label)) return accountsHold(request.prompt);
  throw new Error(`unexpected ${request.label}`);
};
/** A finding of the review agent on lib/old.js line 1 (outside the evaluated session), leading from the ask S1. */
const oldFinding = (over = {}) => ({ kind: 'bug', lens: 'behaviour', title: 'old is 2 where its callers expect 1',
  claims: [], input: 'import { old }', trace: [{ step: 'old is now 2.', path: 'lib/old.js', side: 'new', startLine: 1,
    endLine: 1, quote: 'export const old = 2;' }], anchor: { path: 'lib/old.js', side: 'new', startLine: 1, endLine: 1 },
  leadsFrom: ['S1'], ...over });

test('D113 amended: when their block gives way whole for the bound, the review request is the session\'s own; a finding the review still makes on such a file is tagged, and its check is shown their table of contents', async () => {
  const { run: runWith } = outsideFixture();
  const judgeWith = () => outsideJudge({ review: { findings: [oldFinding()], questions: [] } });
  const run = (seen, bound, withOutside = true) => runWith(seen, judgeWith(), bound, withOutside);
  const alone = [];
  await run(alone, Infinity, false);
  const ownBytes = reviewInputBytes(alone.find((r) => r.label === 'code-review:agent'));
  // At the session's own request's size, their block cannot stand: it gives way whole, and the request is the one
  // planned without them.
  const seen = [];
  const { codePass } = await run(seen, ownBytes);
  const review = seen.find((r) => r.label === 'code-review:agent');
  assert.deepEqual(review, alone.find((r) => r.label === 'code-review:agent'));
  assert.ok(!review.prompt.includes(OUTSIDE_HEADING));
  assert.deepEqual(codePass.manifest.review.outsideFiles.map((e) => [e.path, e.state, e.reason]),
    [['lib/old.js', 'left_out', 'request_bound']]);
  assert.deepEqual(codePass.outsideFiles.map((f) => [f.path, f.state]), [['lib/old.js', 'left_out']]);
  // The review read it itself and made a finding on it: tagged, tied to nothing of the session, and its check is shown
  // their table of contents (their block at no room for hunks).
  const [away] = codePass.findings;
  assert.deepEqual([away.anchor.path, away.outsideSession, away.leadsFrom], ['lib/old.js', true, []]);
  const check = seen.find((r) => r.label === 'code-verify:F1');
  assert.ok(check.prompt.includes(OUTSIDE_HEADING) && check.prompt.includes('- lib/old.js · modified'), check.prompt);
  assert.ok(!check.prompt.includes('diff --git a/lib/old.js'));
  // The tally: their part counted apart; not sent to the review, and not read by it, so not seen.
  const tally = codeChangeTally(codePass);
  assert.deepEqual([tally.outside.total, tally.outside.groups.not_seen.length], [1, 1]);
});

test('D113 amended: a finding on a file outside the evaluated session withheld after its check, or by its scope with its anchor spelled another way, keeps its tag and ties to nothing of the session', async () => {
  const { run } = outsideFixture();
  // A verdict other than holds, quoting the finding's trace as `holds` does.
  const said = (verdict, reason) => (finding) => ({ ...holds(finding), verdict, reason,
    explanation: `Synthetic: ${verdict}.` });
  const cases = [[said('refuted', 'incorrect'), 'verify_refuted'], [said('cannot_tell', null), 'verify_cannot_tell'],
    [() => ({}), 'verify_unexecuted'], [() => { throw new Error('synthetic call failure'); }, 'request_failed']];
  for (const [verify, reason] of cases) {
    const { codePass } = await run([], outsideJudge({ review: { findings: [oldFinding()], questions: [] }, verify }));
    assert.deepEqual(codePass.findings, [], reason);
    assert.deepEqual(codePass.withheld.map((w) => [w.reason, w.outsideSession, w.leadsFrom]), [[reason, true,
      undefined]], reason);
    // The session's own finding withheld the same way: untagged, and it keeps the row it leads from.
    const own = await run([], outsideJudge({ review: { findings: [reviewFinding({ leadsFrom: ['S1'] })], questions: [] },
      verify }));
    assert.deepEqual(own.codePass.withheld.map((w) => [w.reason, w.outsideSession, w.leadsFrom?.map((r) => r.key)]),
      [[reason, undefined, ['S1']]], reason);
  }
  // An ask not met on lib/old.js, its anchor and trace spelled ./lib/old.js: out of scope, withheld tagged by the path
  // its file is read under.
  const spelled = { path: './lib/old.js', side: 'new', startLine: 1, endLine: 1 };
  const { codePass } = await run([], outsideJudge({ review: { findings: [oldFinding({ kind: 'ask_not_met', lens: 'ask',
    title: 'the ask is not met in lib/old.js', anchor: spelled, trace: [{ step: 'old is now 2.', ...spelled,
      quote: 'export const old = 2;' }] })], questions: [] } }));
  assert.deepEqual(codePass.withheld.map((w) => [w.kind, w.reason, w.outsideSession, w.leadsFrom]), [['ask_not_met',
    'out_of_scope', true, undefined]]);
  assert.ok(withheldWhy(codePass.withheld[0]).startsWith(CODE_REPORT_WORDS.outsideTie.ask_not_met));
  // Why: the tie words only for a tie kind tagged so and out of scope; every other row by its reason, as before.
  const row = { what: 'finding', reason: 'out_of_scope', cause: 'out_of_scope', kind: 'ask_not_met' };
  const R = CODE_REPORT_WORDS.withheldReasons;
  assert.equal(withheldWhy({ ...row, outsideSession: true }), CODE_REPORT_WORDS.outsideTie.ask_not_met);
  assert.equal(withheldWhy({ ...row, kind: 'claim_false', outsideSession: true }),
    CODE_REPORT_WORDS.outsideTie.claim_false);
  assert.equal(withheldWhy(row), R.out_of_scope);
  assert.equal(withheldWhy({ ...row, kind: 'bug', outsideSession: true }), R.out_of_scope);
  assert.equal(withheldWhy({ ...row, reason: 'verify_cannot_tell', cause: undefined, outsideSession: true }),
    R.verify_cannot_tell);
});

test('D113 amended, its second review: the checks of the findings outside the evaluated session are counted apart — one failed, one void, one too large to send — and the session\'s own coverage, footer, gaps and tally are the ones of the same session with no file outside it', async () => {
  // A rule file of yours over the rule block's cap: the review request leaves it out, and the check of a finding that
  // quotes it is shown it whole, over the bound below, so too large to send. The review agent reads every file and the
  // rule file whole, so the session's own coverage is complete; only a check can make it short.
  const rules = Array.from({ length: 12_000 }, (_, i) => `SYNTHETIC_RULE ${String(i + 1).padStart(5, '0')}: a rule.`
    .padEnd(40, '.')).join('\n') + '\n';
  const { run } = outsideFixture({ rules });
  const [FAILS, VOID, LARGE] = ['SYNTHETIC_AWAY_FAILS: old is 2', 'SYNTHETIC_AWAY_VOID: old is 2 again',
    'SYNTHETIC_AWAY_LARGE: old is 2 against your rule'];
  const old1 = { step: 'old is now 2.', path: 'lib/old.js', side: 'new', startLine: 1, endLine: 1,
    quote: 'export const old = 2;' };
  const review = (prompt) => ({ findings: [reviewFinding({ leadsFrom: ['S1'] }),
    ...(prompt.includes(OUTSIDE_HEADING) ? [oldFinding({ title: FAILS }),
      oldFinding({ title: VOID, anchor: { path: 'lib/old.js', side: 'new', startLine: 1, endLine: 2 },
        trace: [{ ...old1, endLine: 2 }] }),
      oldFinding({ kind: 'contract_break', lens: 'contracts', title: LARGE, trace: [{ step: 'Your rule.', path: null,
        side: 'session', startLine: null, endLine: null, quote: 'SYNTHETIC_RULE 00001: a rule.' }, old1] })] : [])],
  questions: [] });
  const verify = (finding, request) => {
    if (finding.title === FAILS || (finding.title === VOID && request.label.endsWith(':reask')))
      throw new Error('SYNTHETIC: the call did not answer');
    return finding.title === VOID ? {} : holds(finding);
  };
  const reads = { ...CODE_FILES, 'lib/old.js': 'export const old = 2;\nexport const other = 3;\n', 'CLAUDE.md': rules };
  const judgeOf = (seen) => codeJudge({ review, verify, seen, run: (request) => (request.label.startsWith('code-review')
    ? readsEveryFile(request, reads) : SYNTHETIC_RUN) });
  // The bound: far over the review request and the session's own finding's check, under the rule file alone.
  const bound = 300_000;
  const seen = [];
  const { codePass: busy } = await run(seen, judgeOf(seen), bound);
  const { codePass: quiet } = await run([], judgeOf([]), bound, false);
  assert.ok(Buffer.byteLength(rules) > CODE_RULE_BLOCK_MAX_BYTES && Buffer.byteLength(rules) > bound);
  assert.deepEqual([busy.manifest.review.sent, busy.manifest.review.rules[0].state, busy.manifest.review.rules[0].reason],
    [true, 'left_out', 'block_cap']);
  assert.ok(seen.some((r) => r.label === 'code-review:agent' && r.prompt.includes(OUTSIDE_HEADING)), 'their block given');
  assert.ok(!seen.some((r) => /^code-verify:F\d+$/.test(r.label) && r.prompt.includes(LARGE)), 'too large: not sent');
  // Each finding on them withheld, tagged, by what became of its check; their calls counted apart.
  assert.deepEqual(busy.withheld.filter((w) => w.outsideSession === true).map((w) => [w.text, w.reason]),
    [[FAILS, 'request_failed'], [VOID, 'verify_unexecuted'], [LARGE, 'request_too_large']]);
  assert.deepEqual(busy.outsideChecks, { keys: ['F2', 'F3', 'F4'], failed: 2, tooLarge: 1 });
  assert.equal(quiet.outsideChecks, undefined);
  // The session's own: as with no file outside the evaluated session.
  assert.equal(quiet.coverage, 'complete');
  const own = (rows) => rows.filter((x) => x.outsideSession !== true).map(({ id: _id, ...rest }) => rest);
  for (const key of ['files', 'coverage', 'footer', 'gaps']) assert.deepEqual(busy[key], quiet[key], key);
  for (const key of ['findings', 'questions', 'withheld']) assert.deepEqual(own(busy[key]), own(quiet[key]), key);
  assert.deepEqual(busy.account.reviewCoverage, quiet.account.reviewCoverage);
  assert.deepEqual(codeCoverageLines(busy), codeCoverageLines(quiet));
  assert.deepEqual(codeFooterLines({ codePass: busy }), codeFooterLines({ codePass: quiet }));
  const { outside: _outside, ...ownTally } = codeChangeTally(busy);
  assert.deepEqual(ownTally, codeChangeTally(quiet));
});
