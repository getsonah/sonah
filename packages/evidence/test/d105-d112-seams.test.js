// The seams of 0.3.0-beta.4's join that no lane could test alone: bucket B (D105 one request, one bound, a manifest; D107
// the repair kept by identity; D108 the code around the change, on; D109 one tally), bucket C (D110 the premise
// contract; D111 the accounting) and bucket E (D112 one point, one item), each built on its own lane from a5e6aedf and
// joined after its review. Each test holds one place where two of them meet, and fails if either side stops holding its
// part there:
//   1. D110 x D105/D109: a finding whose file the request left out, or showed in part, is labelled by its premises,
//      which ground on the repository as Sonah reads it, never on what the request showed; the one tally counts that
//      file by what the review saw, never by the finding's label.
//   2. D111 x D105/D109: an accounting request too large for the review's one bound is not sent; its items are counted
//      in the footer beside the one tally's files the review did not see, and neither count moves the other.
//   3. D112 x D107/D110: a question of the code review on a claim that a repaired claim_false finding contradicts is a
//      member of that finding's item, since the repaired finding is published, confirmed by its premises, and names the
//      row it contradicts.
//
// Synthetic sessions and files, an in-memory repository reader and deterministic fake agents: no recording, no model, no
// network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, codeSeenOf, codeChangeTally, codePassFindings,
  codePassUnconfirmed, findingConfirmed, withCodePass } from '../src/code-pass.js';
import { reviewInputBytes } from '../src/challenge.js';
import { CODE_REPORT_WORDS as W, codeCoverageLines, codeFooterLines, codeSeenLines, codeUnseenFiles,
  codeReviewCoverage } from '../src/code-report.js';
import { buildCodeSession, codeSession, CODE_FILES, holds, holdsWith, repositoryPremise, allSound, verifiedFinding,
  batchItems, fatesOf, accountsHold, accountsHoldWith, fileReceipt, reviewFinding, dossierItems, PARSE_QUOTE }
  from '../../cli/test/code-pass-fixture.js';
import { reportModel, reportPlacement, itemVisibleText } from '../../render/report-model.js';
import { REPORT_ITEM_WORDS } from '../../render/report-words.js';

const enc = (text) => new TextEncoder().encode(text);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const ROOT = '/work/repo';
const GIT = { kind: 'git', commit: 'b'.repeat(40), how: 'reflog' };
const ASK = 'SYNTHETIC_ASK: add the modules and run the tests.';
const RULES = 'SYNTHETIC_RULES: every module exports one function.';
/** An accounting agent's request (F3b, D111), its first call or its re-ask. */
const ACCOUNT_LABEL = /^code-account:\d+(:reask)?$/;
/** A premise outside the repository and the language, as a check writes one. */
const OUTSIDE = Object.freeze({ premise: 'SYNTHETIC the runtime decides this.', source: 'outside', receipts: [] });

/** `n` lines of `width` bytes each (a file's text, ending in a line end). */
const linesOf = (tag, n, width = 40) => Array.from({ length: n }, (_, i) => `${tag} ${String(i + 1).padStart(5, '0')}`
  .padEnd(width, '.')).join('\n') + '\n';
/** git's own patch of an added file. */
const addedPatch = (path, text) => {
  const rows = text.split('\n').slice(0, -1);
  return [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`,
    `@@ -0,0 +1,${rows.length} @@`, ...rows.map((r) => `+${r}`), ''].join('\n');
};

/** A session that writes `files` (path -> text, each added) and then runs `npm test`, the project's rule file loaded;
 *  the snapshot of that change with a git base; an in-memory repository reader; and the session review's report, with
 *  one ask (S1). As d105-d107-seams.test.js builds it. */
function gitFixture(files) {
  const blobs = { ask: ASK, rules: RULES, ok: 'ok', cmd: 'npm test' };
  const T1 = { turn: 'T1' };
  const specs = [{ id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    ...Object.entries(files).map(([path, text], at) => {
      blobs[`file-${at}`] = text;
      return { id: `W${at + 1}`, kind: 'invocation', write: path, blob: `file-${at}`, ...T1 };
    }),
    { id: 'B1', kind: 'invocation', tool: 'Bash', operation: 'command', paths: [], input: [], changes: [], callKey: 'B1',
      command: [{ sourceKey: 'cmd', fromByte: 0, untilByte: 8 }], ...T1 },
    { id: 'B1-r', kind: 'observation', invocation: 'B1', blob: 'ok', ...T1 }];
  const session = buildCodeSession('sess-d105-d112', blobs, specs,
    { projectInstructions: [{ path: 'CLAUDE.md', blob: 'rules' }] });
  const plan = codeSnapshotPlan(session, { root: ROOT });
  const snapshot = freezeCodeSnapshot(plan, plan.map((entry) => ({ path: entry.path, bytes: enc(files[entry.path]),
    type: 'added', patch: addedPatch(entry.path, files[entry.path]) })), { base: GIT });
  const now = { ...files, 'CLAUDE.md': RULES };
  const repo = { root: ROOT, top: ROOT, base: () => null, read: (path) => {
    const named = String(path).replace(`${ROOT}/`, '');
    return Object.hasOwn(now, named) ? { path: named, text: now[named], sha256: sha(now[named]) } : null;
  } };
  const report = { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [], promises: [],
    requirements: [{ text: 'Add the modules.', instruction: { eventId: 'I1', role: 'instruction', quote: ASK },
      status: 'done' }], decisions: [], failures: [], writtenClaims: [], pivots: [] };
  return { session, snapshot, repo, report, now };
}

/** The fake agents: the review agent answers `review`, its one repair `repair`; a finding's checker answers
 *  `verify(finding)`, every question is sound; an accounting agent answers `account(prompt)`. `seen` receives every
 *  request. */
function agents({ review, repair = review, verify = holds, account = accountsHold, seen = [] }) {
  return async (request) => {
    seen.push(request);
    if (ACCOUNT_LABEL.test(request.label ?? '')) return account(request.prompt);
    if (request.label === 'code-review:agent') return structuredClone(typeof review === 'function'
      ? review(request.prompt) : review);
    if (request.label === 'code-review:repair') return structuredClone(typeof repair === 'function'
      ? repair(request.prompt) : repair);
    if (/^code-verify:F\d+/.test(request.label)) return verify(verifiedFinding(request.prompt));
    if (/^code-verify:batch/.test(request.label)) return allSound(batchItems(request.prompt));
    throw new Error(`unexpected request ${request.label}`);
  };
}
const runOn = (f, judge, more = {}) => runCodePass({ report: f.report, session: f.session, snapshot: f.snapshot,
  repo: f.repo, judge, base: GIT, root: ROOT, bound: 1_620_000 * 4, ...more });
const said = (parts) => parts.map((part) => part.text).join('');

// 10,250 lines of 40 bytes: over the change block's cap, so the request leaves its hunks out, and over the whole files'
// cap, so part B does not show it whole either (D105, D106, D108's default).
const HUGE_LINES = 10_250;
const FILES = Object.freeze({ 'src/a.js': linesOf('alpha', 2), 'src/huge.js': linesOf('hugefile', HUGE_LINES) });
/** A bug in src/huge.js at line 5000, its one code step quoting that line. */
const hugeFinding = (over = {}) => ({ kind: 'bug', lens: 'behaviour', title: 'SYNTHETIC: line 5000 of the left-out file '
  + 'is wrong', claims: [], input: 'SYNTHETIC input', trace: [{ step: 'It reaches line 5000.', path: 'src/huge.js',
  side: 'new', startLine: 5_000, endLine: 5_000, quote: 'hugefile 05000' }],
anchor: { path: 'src/huge.js', side: 'new', startLine: 5_000, endLine: 5_000 }, leadsFrom: [], ...over });

// ---- seam 1: D110's label on a file the manifest left out or showed in part ----------------------------------------

test('D110 x D105/D109: a finding in a file the request left out is checked by premises that ground on the repository, '
  + 'and the one tally still counts that file as not seen; one premise outside makes it an item to verify, the same '
  + 'file still not seen', async () => {
  const f = gitFixture(FILES);
  const answer = { findings: [hugeFinding()], questions: [] };
  const confirmed = (await runOn(f, agents({ review: answer }))).codePass;
  // D105/D109: the request left the file's hunks out; the review read nothing of it.
  const entry = confirmed.manifest.review.files.find((x) => x.path === 'src/huge.js');
  assert.deepEqual([entry.state, entry.shown], ['left_out', []]);
  // D110: the check's one premise quotes line 5000, which the request never showed; it grounds on the file as Sonah
  // reads it, so code's label confirms the finding.
  assert.equal(confirmed.findings.length, 1);
  const [finding] = confirmed.findings;
  assert.deepEqual(finding.check.premises.map((p) => [p.source, p.receipts.map((r) => [r.path, r.startLine])]),
    [['repository', [['src/huge.js', 5_000]]]]);
  assert.equal(findingConfirmed(finding.check), true);
  assert.deepEqual([codePassFindings({ codePass: confirmed }).length, codePassUnconfirmed({ codePass: confirmed })],
    [1, []]);
  // D109: the one tally counts the file by what the review saw, never by the finding: not seen, the coverage partial,
  // the receipt outside every line the review saw.
  const tally = codeChangeTally(confirmed);
  assert.deepEqual(tally.groups.not_seen.map((u) => u.path), ['src/huge.js']);
  assert.deepEqual(codeCoverageLines(confirmed), [W.files(2, [['whole', 1]], 1), W.coverage.partial]);
  assert.equal(codeUnseenFiles(confirmed), 1);
  assert.deepEqual(confirmed.receiptPlaces, { inside: 0, outside: 1, unknown: 0 });
  // The readers: a confirmed bug, its premise said as what its check quotes, beside the line that the review did not
  // see the file.
  const model = reportModel(f.session, withCodePass(f.report, { codePass: confirmed, checks: new Map() }), {});
  const items = Object.values(model.tiers).flat();
  const bug = items.find((x) => x.kind === 'code_bug');
  assert.ok(bug, items.map((x) => x.kind).join());
  assert.ok(JSON.stringify(bug.evidence).includes(W.premiseSources.repository), JSON.stringify(bug.evidence));
  assert.ok(model.notChecked.code.map(said).includes(W.files(2, [['whole', 1]], 1)));
  // One premise outside the repository and the language: an item to verify, never checked; the tally the same.
  const toVerify = (await runOn(f, agents({ review: answer,
    verify: (x) => holdsWith(x, [repositoryPremise(x), OUTSIDE]) }))).codePass;
  assert.deepEqual([toVerify.findings.length, toVerify.unconfirmed.length], [0, 1]);
  assert.deepEqual(codeChangeTally(toVerify).groups.not_seen.map((u) => u.path), ['src/huge.js']);
  assert.deepEqual(codeCoverageLines(toVerify), codeCoverageLines(confirmed));
  const verifyItem = Object.values(reportModel(f.session, withCodePass(f.report, { codePass: toVerify,
    checks: new Map() }), {}).tiers).flat().find((x) => x.kind === 'code_finding_unconfirmed');
  assert.deepEqual(verifyItem.restsOutside.map(said), [OUTSIDE.premise]);
});

/** D109's recorded-edits plan entry and its edits (d109-one-tally.test.js builds them so). */
const planEntry = (path, edits) => ({ path, recordedPath: path, changed: true, recorded: true, outside: false,
  last: { deleted: false, spans: [] }, edits });
const wholeWrite = (text) => ({ before: [], after: [text], whole: true, placed: null });
const edit = (before, after) => ({ before: [before], after: [after], whole: false, placed: null });

test('D110 x D109: a finding on a line that the request did not show of a file it showed in part is checked by a '
  + 'premise that quotes that line; the tally keeps the file seen in part, with only the lines the request showed',
async () => {
  // docs/a.md: written whole (its text since changed, so the write cannot be placed), then one line edited (placed): the
  // request shows line 2 of 3, and the file's change is the whole file (D109).
  const now = { 'docs/a.md': 'intro\nnew middle\nend\n' };
  const session = buildCodeSession('sess-d109-d110', { ask: ASK }, [{ id: 'I1', kind: 'instruction', blob: 'ask',
    turn: 'T1' }]);
  const plan = [planEntry('docs/a.md', [wholeWrite('intro\nold middle\nend\n'), edit('old middle', 'new middle')])];
  const snapshot = freezeCodeSnapshot(plan, [{ path: 'docs/a.md', bytes: enc(now['docs/a.md']) }],
    { base: { kind: 'recorded_edits' } });
  const repo = { root: ROOT, top: ROOT, read: (path) => (Object.hasOwn(now, path) ? { path, text: now[path] } : null),
    base: () => null };
  const report = { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [], promises: [],
    requirements: [{ text: 'Write them.', instruction: { eventId: 'I1', role: 'instruction', quote: ASK },
      status: 'done' }], decisions: [], failures: [], writtenClaims: [], pivots: [] };
  // The finding sits on the line the request showed (the change's scope); its check's one premise quotes line 1, which
  // the request did not show.
  const finding = { kind: 'bug', lens: 'behaviour', title: 'SYNTHETIC: the middle line is wrong', claims: [],
    input: 'SYNTHETIC input', trace: [{ step: 'It reads line 2.', path: 'docs/a.md', side: 'new', startLine: 2,
      endLine: 2, quote: 'new middle' }], anchor: { path: 'docs/a.md', side: 'new', startLine: 2, endLine: 2 },
    leadsFrom: [] };
  const premise = { premise: 'SYNTHETIC the first line opens the document.', source: 'repository',
    receipts: [{ path: 'docs/a.md', side: 'new', startLine: 1, endLine: 1, quote: 'intro' }] };
  const { codePass } = await runCodePass({ report, session, snapshot, repo, root: ROOT, base: { kind: 'recorded_edits' },
    wholeFiles: false, judge: agents({ review: { findings: [finding], questions: [] },
      verify: (x) => holdsWith(x, [premise]), account: (prompt) => accountsHoldWith(fileReceipt(prompt, now))(prompt) }) });
  const entry = codePass.manifest.review.files[0];
  assert.deepEqual([entry.state, entry.shown, entry.change], ['hunks_only', [[2, 2]], [[1, 3]]]);
  // D110: confirmed by a premise on line 1, which the request did not show.
  assert.deepEqual([codePass.findings.length, codePass.withheld, codePass.unconfirmed], [1, [], []]);
  assert.deepEqual(codePass.findings[0].check.premises.map((p) => [p.source, p.receipts.map((r) => r.startLine)]),
    [['repository', [1]]]);
  assert.equal(findingConfirmed(codePass.findings[0].check), true);
  // One premise outside instead: an item to verify; the label reads the premises, never what the request showed.
  const outside = (await runCodePass({ report, session, snapshot, repo, root: ROOT, base: { kind: 'recorded_edits' },
    wholeFiles: false, judge: agents({ review: { findings: [finding], questions: [] },
      verify: (x) => holdsWith(x, [premise, OUTSIDE]),
      account: (prompt) => accountsHoldWith(fileReceipt(prompt, now))(prompt) }) })).codePass;
  assert.deepEqual([outside.findings.length, outside.unconfirmed.length], [0, 1]);
  // D109: seen in part, with the line the request showed (the finding's own); the premise's line is not among them,
  // and the tally is the same whatever the label.
  for (const pass of [codePass, outside]) {
    assert.deepEqual(codeSeenOf(pass).files.map((x) => [x.path, x.state, x.lines]), [['docs/a.md', 'in_part', [[2, 2]]]]);
    assert.deepEqual(codeChangeTally(pass).groups.in_part.map((u) => u.path), ['docs/a.md']);
    assert.deepEqual(codeSeenLines(pass), [W.seenInPart(['docs/a.md (line 2 of 3)'])]);
    assert.equal(pass.coverage, 'partial');
  }
});

// ---- seam 2: D111's accounting inside D105's one bound, its footer beside D109's tally -------------------------------

test('D111 x D105/D109: an accounting request too large for the review\'s one bound is not sent; the footer counts its '
  + 'ask beside the tally\'s file the review did not see, and neither count moves the other', async () => {
  const f = gitFixture(FILES);
  // Long questions on the ask: the accounting's request lists them, the review's request does not.
  const questions = Array.from({ length: 12 }, (_, i) => ({ question: `SYNTHETIC question ${i + 1}: `.padEnd(990, 'q'),
    key: 'S1', quote: 'add the modules' }));
  const answer = { findings: [], questions };
  const seen = [];
  await runOn(f, agents({ review: answer, seen }));
  const review = seen.find((r) => r.label === 'code-review:agent');
  const account = seen.find((r) => r.label === 'code-account:1');
  assert.ok(account, seen.map((r) => r.label).join());
  assert.ok(reviewInputBytes(account) > reviewInputBytes(review), 'the accounting request is the larger');
  const atBound = [];
  const { codePass: pass } = await runOn(f, agents({ review: answer, seen: atBound }),
    { bound: reviewInputBytes(review) });
  // D105: the review fits its bound and is sent; the accounting request does not and is not sent (nor does the check
  // of the questions, which lists them too).
  assert.ok(atBound.some((r) => r.label === 'code-review:agent'));
  assert.ok(!atBound.some((r) => ACCOUNT_LABEL.test(r.label)), 'no accounting call');
  assert.deepEqual([pass.calls.account, pass.account.batches.map((b) => b.state)], [0, ['too_large']]);
  assert.deepEqual(pass.account.entries.map((e) => [e.key, e.fate, e.cause]), [['S1', 'missing', 'too_large']]);
  assert.equal(pass.questions.length, 12, 'no question lost');
  // The record's footer: each call Sonah did not make, by its part, and the ask counted; no file line moved by them.
  assert.deepEqual(pass.footer.filter((e) => e.kind !== 'withheld'), [{ kind: 'too_large', part: 'batch', count: 1 },
    { kind: 'too_large', part: 'account', count: 1 }, { kind: 'unaccounted', scope: 'ask', count: 1 }]);
  // D109: the tally is the change's alone: the left-out file not seen, one of two.
  assert.deepEqual(codeChangeTally(pass).groups.not_seen.map((u) => u.path), ['src/huge.js']);
  assert.equal(codeUnseenFiles(pass), 1);
  // The footer's lines: the tally's file, the accounting's call and its count, each once, the count last.
  const lines = codeFooterLines({ codePass: pass });
  const fileLine = lines.findIndex((l) => l.includes('src/huge.js'));
  const notMade = W.footerKinds.too_large({ count: 2, parts: [W.parts.batch, W.parts.account] });
  const callLine = lines.indexOf(notMade);
  // D111 amended: with no session, Sonah cannot read whose words the ask rests on, and never calls it yours.
  const askLine = lines.indexOf(W.unaccounted.ask.other(1));
  assert.ok(fileLine >= 0 && callLine > fileLine && askLine > callLine, lines.join('\n'));
  assert.equal(lines.filter((l) => l.includes('src/huge.js')).length, 1);
  // The coverage: the review's own is short (the file it did not see), so the coverage line says so, once.
  assert.deepEqual([pass.coverage, codeReviewCoverage(pass)], ['partial', 'partial']);
  assert.deepEqual(codeCoverageLines(pass), [W.files(2, [['whole', 1]], 1), W.coverage.partial]);
  // The readers list the same lines.
  const nc = reportModel(f.session, withCodePass(f.report, { codePass: pass, checks: new Map() }), {}).notChecked;
  const facts = nc.facts.filter((x) => x.group === 'code').map((x) => said(x.parts));
  for (const line of [notMade, W.unaccounted.ask.person(1)])
    assert.ok(facts.includes(`${line}.`), `${line}\n${facts.join('\n')}`);
  assert.ok(facts.some((l) => l.includes('src/huge.js')), facts.join('\n'));
});

// ---- seam 3: D112's member in a D107-repaired finding's item ---------------------------------------------------------

/** The fixture's code session with its claim as the session review's promise (S2 in the dossier, after the ask). */
function claimFixture() {
  const session = codeSession();
  const plan = codeSnapshotPlan(session);
  const snapshot = freezeCodeSnapshot(plan, plan.map((entry) => (Object.hasOwn(CODE_FILES, entry.path)
    ? { path: entry.path, bytes: enc(CODE_FILES[entry.path]) } : { path: entry.path, state: 'deleted' })),
  { base: { kind: 'recorded_edits' } });
  const named = (path) => String(path).replace(/^\.\//, '').replace(`${ROOT}/`, '');
  const repo = { root: ROOT, top: ROOT, base: () => null, read: (path) => (Object.hasOwn(CODE_FILES, named(path))
    ? { path: named(path), text: CODE_FILES[named(path)], sha256: sha(CODE_FILES[named(path)]) } : null) };
  const report = { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [],
    promises: [{ id: `sha256:${'1'.repeat(64)}`, stated: { eventId: 'C1', role: 'commentary',
      quote: 'parse now returns an empty list for empty input.' },
    text: 'The agent said parse returns an empty list for empty input.', status: 'open', receipts: [] }],
    requirements: [{ text: 'Return [] for empty input.', status: 'done',
      instruction: { eventId: 'I1', role: 'instruction', quote: 'add a parse function that returns [] for empty input' } }],
    decisions: [], failures: [], writtenClaims: [], pivots: [] };
  return { session, snapshot, repo, report };
}

test('D112 x D107/D110: a question of the code review on a claim that a repaired claim_false finding contradicts is a '
  + 'member of that finding\'s item', async () => {
  const f = claimFixture();
  const claimKey = (prompt) => dossierItems(prompt).find((entry) => entry.kind === 'claim')?.key;
  const finding = (prompt, quote) => reviewFinding({ kind: 'claim_false', lens: 'claims',
    title: 'parse("") returns [""], not the empty list the agent said', leadsFrom: [claimKey(prompt)],
    trace: [{ step: 'An empty string splits into one empty part.', path: 'src/parse.js', side: 'new', startLine: 2,
      endLine: 2, quote }] });
  const question = (prompt) => ({ question: 'SYNTHETIC: should an empty input give an empty list or an error?',
    key: claimKey(prompt), quote: 'parse now returns an empty list' });
  // The answer's finding quotes words that are not on its line: it fails its grounding and goes to the one repair,
  // which mends the quote; the question stands from the answer, and the repair's copy of it folds into it.
  const answer = (prompt) => ({ findings: [finding(prompt, 'SYNTHETIC words that are not on the line')],
    questions: [question(prompt)] });
  const repair = (prompt) => ({ findings: [finding(prompt, PARSE_QUOTE)], questions: [question(prompt)] });
  const seen = [];
  const result = await runCodePass({ report: f.report, session: f.session, snapshot: f.snapshot, repo: f.repo,
    root: ROOT, base: { kind: 'recorded_edits' }, judge: agents({ review: answer, repair, seen }) });
  const pass = result.codePass;
  // D107: the mended finding takes the failing one's place one to one, is checked and published; nothing is withheld.
  assert.equal(pass.calls.repair, 1);
  assert.deepEqual(pass.fates.filter((r) => r.list === 'findings').map((r) => [r.from, r.fate]),
    [['answer', 'replaced'], ['repair', 'kept']]);
  assert.deepEqual(pass.withheld, []);
  // D110: its check's premise grounds on the repository: code's label confirms it, so it contradicts the claim.
  assert.equal(pass.findings.length, 1);
  assert.equal(findingConfirmed(pass.findings[0].check), true);
  const joined = withCodePass(f.report, result);
  assert.deepEqual([joined.promises[0].codeCheck?.outcome, joined.promises[0].codeCheck?.finding],
    ['contradicted-by-code', pass.findings[0].id]);
  assert.deepEqual(pass.questions.map((q) => [q.from, q.concerns?.source, q.concerns?.index]),
    [['review', 'promises', 0]]);
  // D112: the claim folds into the repaired finding's item, and the question on the claim is a member of that item.
  const model = reportModel(f.session, joined, {});
  const items = Object.values(model.tiers).flat();
  assert.deepEqual(items.filter((x) => ['code_claim_false', 'code_question'].includes(x.kind)).map((x) => x.kind),
    ['code_claim_false'], 'the question is no item of its own');
  const item = items.find((x) => x.kind === 'code_claim_false');
  assert.deepEqual(item.members.map((m) => [m.kind, m.tie]), [['code_question', 'concerns']]);
  const placement = reportPlacement(model);
  assert.deepEqual([placement['promises:0'], placement['codePass.questions:0']],
    [{ foldedInto: item.n }, { memberOf: item.n }]);
  assert.ok(itemVisibleText(item).includes(REPORT_ITEM_WORDS.members(1)), itemVisibleText(item));
});
