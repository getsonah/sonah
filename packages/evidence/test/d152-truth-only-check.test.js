// D152 (0.3.0-beta.9): the check judges truth only. A finding's checking agent answers whether the finding is true —
// holds, refuted on a fact (CODE_REFUTATION_REASONS: `not_against_goal` is gone), or cannot tell — and lists what its
// behaviour breaks (`breaks`: 0 to `TRACE_LIMITS.breaks` receipts, a line of the repository or the person's words),
// each grounded by code. How much a finding matters comes from its kind and the ties code grounds, never from the
// check: a confirmed finding tied to no row it follows from and to no grounded receipt of what it breaks is published
// open (`codePass.open`, the kind `code_finding_open`: Good to know, never Must act). The invariants, each a test:
//   1. The verdict's contract: `breaks` required, a list; `not_against_goal` voids the verdict (its one re-ask).
//   2. Each receipt of what a finding breaks grounds by string search — a code one in the file it names, the person's
//      words in the session text the check was shown — or is dropped alone with its closed cause, never voiding the
//      check; past the limit, dropped too.
//   3. Each grounded finding the checks answered ends once: tied (published), open, to verify or withheld.
//   4. Every reader computes the lists again from the record (`findingTied`, `tieRuled`): a record moved between lists,
//      or a receipt whose quote is no longer in its stored span, reads by its own ties; a record before the tie rule
//      reads as it was written.
//   5. The request: only a finding's checking brief and contract moved (golden digests); rendered back, D149's bytes.
//   6. D152's review: the copies of one problem merge their ties — a unit's copy (D149), a repair's (D107), the
//      accounting's (D111), a later held copy of its identity — so where it is published never depends on which copy
//      came first.
//   7. D152's review: a record of another tie rule keeps its open list; the re-ask grounds the person's words as the
//      first answer does; one identity is in one list, the open one too; the label is read before the tie.
//
// Synthetic sessions and files, an in-memory repository reader and deterministic fake agents: no recording, no model, no
// network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CODE_REFUTATION_REASONS, CODE_ITEM_ERRORS } from '../src/ledger.js';
import { runCodePass, codeSnapshotPlan, freezeCodeSnapshot, readFindingVerdict, groundingContext, findingTied,
  tieRuled, codePassFindings, codePassOpen, codePassUnconfirmed, CODE_VERIFY_SYSTEM, CODE_VERIFY_SCHEMA,
  CODE_BRIEFS_ABSOLUTE, CODE_PASS_PROFILE, CODE_TIE_RULE, TRACE_LIMITS } from '../src/code-pass.js';
import { itemKindOf, boundTier, ITEM_KIND_TABLE } from '../src/triage.js';
import { answerableRowIds } from '../src/checklist.js';
import { CODE_REPORT_WORDS as W, codeHowLine } from '../src/code-report.js';
import { CODE_FILES, CODE_TEXT, codeSession, reviewFinding, holds, holdsWith, repositoryPremise, traceReceipts,
  allSound, verifiedFinding, batchItems, PARSE_QUOTE, accountsHold } from '../../cli/test/code-pass-fixture.js';
import { verifyBriefBeforeTruthOnly } from './m33-integration-fixture.js';
import { scenario, GIT, ROOT as UNITS_ROOT, linesOf } from './d149-hunk-ledger-fixture.js';
import * as fixture from '../../cli/test/code-pass-fixture.js';
import { codeSnapshotPlan as planOf, freezeCodeSnapshot as freezeOf, isCodeReviewLabel } from '../src/code-pass.js';

const enc = (text) => new TextEncoder().encode(text);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const ROOT = '/work/repo';
/** The person's words a receipt of what a finding breaks may quote: a part of the fixture's ask. */
const ASKED = 'returns [] for empty input';
const OUTSIDE = { premise: 'SYNTHETIC: the platform splits so.', source: 'outside', receipts: [] };
/** A code receipt of the fixture's repository: line 1 of src/util.js, a line no trace step quotes. */
const UTIL = { path: 'src/util.js', side: 'new', startLine: 1, endLine: 1,
  quote: CODE_FILES['src/util.js'].split('\n')[0].trim() };
const SAID = { path: null, side: 'session', startLine: null, endLine: null, quote: ASKED };

function setup() {
  const session = codeSession();
  const plan = codeSnapshotPlan(session);
  const snapshot = freezeCodeSnapshot(plan, plan.map((entry) => (Object.hasOwn(CODE_FILES, entry.path)
    ? { path: entry.path, bytes: enc(CODE_FILES[entry.path]) } : { path: entry.path, state: 'deleted' })),
  { base: { kind: 'recorded_edits' } });
  const named = (path) => String(path).replace(/^\.\//, '').replace(`${ROOT}/`, '');
  const repo = { root: ROOT, top: ROOT, read: (path) => (Object.hasOwn(CODE_FILES, named(path))
    ? { path: named(path), text: CODE_FILES[named(path)], sha256: sha(CODE_FILES[named(path)]) } : null),
  base: () => null };
  const report = { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [], promises: [],
    requirements: [{ text: 'Return [] for empty input.', status: 'done',
      instruction: { eventId: 'I1', role: 'instruction', quote: 'add a parse function that returns [] for empty input' } }],
    decisions: [], failures: [], writtenClaims: [], pivots: [] };
  return { session, snapshot, repo, report };
}
function agents({ findings, verify, seen = [] }) {
  return async (request) => {
    if (/^code-account:\d+(:reask)?$/.test(request.label ?? '')) return accountsHold(request.prompt);
    seen.push(request);
    if (request.label === 'code-review:agent' || request.label === 'code-review:repair') return { findings, questions: [] };
    if (/^code-verify:F\d+(:reask)?$/.test(request.label)) return verify(verifiedFinding(request.prompt), request);
    if (/^code-verify:batch(:reask)?$/.test(request.label)) return allSound(batchItems(request.prompt));
    throw new Error(`unexpected ${request.label}`);
  };
}
const run = async ({ findings = [reviewFinding()], verify = holds, seen } = {}) => {
  const { session, snapshot, repo, report } = setup();
  return runCodePass({ report, session, snapshot, repo, judge: agents({ findings, verify, seen }), root: ROOT,
    base: { kind: 'recorded_edits' } });
};
/** A verdict as the agent gives it: a finding's check that holds, quoting its trace, with `breaks` and `over`. */
const verdictOf = (finding, breaks, over = {}) => ({ ...holdsWith(finding, [repositoryPremise(finding)], breaks), ...over });

test('D152 (1): the contract — breaks required and a list, no refutation by importance; the brief asks for truth only', () => {
  assert.deepEqual(CODE_REFUTATION_REASONS, ['incorrect', 'mitigation_shown', 'input_unreachable', 'step_unsupported',
    'out_of_scope']);
  assert.deepEqual(CODE_VERIFY_SCHEMA.required, ['verdict', 'reason', 'claims', 'premises', 'breaks', 'receipts',
    'explanation']);
  assert.deepEqual(CODE_VERIFY_SCHEMA.properties.reason.enum, [...CODE_REFUTATION_REASONS, null]);
  const entry = CODE_VERIFY_SCHEMA.properties.breaks;
  assert.deepEqual([entry.type, entry.maxItems, entry.items.properties.side.enum, entry.items.required],
    ['array', undefined, ['new', 'old', 'session'], ['path', 'side', 'startLine', 'endLine', 'quote']]);
  for (const brief of [CODE_VERIFY_SYSTEM, CODE_BRIEFS_ABSOLUTE.verify]) {
    assert.ok(brief.includes('Judge whether the finding is true, never whether it matters'));
    assert.ok(brief.includes(`- breaks: what the behaviour the title states contradicts, 0 to ${TRACE_LIMITS.breaks}`));
    assert.ok(!brief.includes('not_against_goal'));
  }
  assert.deepEqual([TRACE_LIMITS.breaks, CODE_PASS_PROFILE.tie], [4, { rule: CODE_TIE_RULE }]);
});

test('D152 (2): each receipt of what a finding breaks grounds or is dropped alone with its cause; the verdict stands', () => {
  const { session, repo } = setup();
  const context = groundingContext({ repo, session });
  const finding = reviewFinding();
  // The verdict numbers the claims it is shown (`verifierFindingOf`).
  const numbered = { ...finding, claims: finding.claims.map((text, at) => ({ claim: at + 1, text })) };
  const shown = [{ eventId: 'I1', role: 'instruction', text: CODE_TEXT.ask, actor: 'person' }];
  const read = (breaks, s = shown) => readFindingVerdict(verdictOf(numbered, breaks), finding, context, s);
  // A line of the repository and the person's words, both grounded and stored as the step stores receipts.
  const both = read([UTIL, SAID]);
  assert.equal(both.ok, true);
  assert.deepEqual(both.breaks.map((r) => [r.role, r.quote]), [['code', UTIL.quote], ['instruction', ASKED]]);
  assert.equal(both.breaks[0].span.includes(UTIL.quote), true);
  assert.deepEqual([both.breaks[1].source, both.breaks[1].eventId, both.breaksDropped], ['session', 'I1', []]);
  // The person's words the check was not shown, a quote in no file, a file not there, a session entry with lines, a
  // code entry with no path: each dropped alone, with its closed cause; the verdict holds.
  const dropped = read([SAID, { ...UTIL, quote: 'SYNTHETIC words on no line' }, { ...UTIL, path: 'src/none.js' },
    { ...SAID, startLine: 1 }], []);
  assert.deepEqual([dropped.ok, dropped.verdict, dropped.breaks], [true, 'holds', []]);
  assert.deepEqual(dropped.breaksDropped, [{ index: 0, cause: 'quote_ungrounded' }, { index: 1, cause: 'quote_ungrounded' },
    { index: 2, cause: 'file_not_readable' }, { index: 3, cause: 'value_outside_list' }]);
  assert.deepEqual(read([{ ...UTIL, path: null }]).breaksDropped, [{ index: 0, cause: 'value_outside_list' }]);
  assert.ok(dropped.breaksDropped.every((d) => CODE_ITEM_ERRORS.includes(d.cause)));
  // Past the limit: the first four are read, the rest dropped.
  const many = read(Array.from({ length: TRACE_LIMITS.breaks + 2 }, () => UTIL));
  assert.deepEqual([many.breaks.length, many.breaksDropped], [TRACE_LIMITS.breaks,
    [{ index: 4, cause: 'text_over_limit' }, { index: 5, cause: 'text_over_limit' }]]);
  // The list missing or not a list voids the verdict's shape, as any member does; so does a refutation by importance.
  const { breaks: _none, ...noBreaks } = verdictOf(numbered, []);
  assert.deepEqual(readFindingVerdict(noBreaks, finding, context, shown), { ok: false, cause: 'shape', at: 'answer.breaks' });
  assert.deepEqual(readFindingVerdict({ ...verdictOf(numbered, []), breaks: 'none' }, finding, context, shown),
    { ok: false, cause: 'shape', at: 'breaks' });
  assert.deepEqual(readFindingVerdict(verdictOf(numbered, [], { verdict: 'refuted', reason: 'not_against_goal' }), finding,
    context, shown), { ok: false, cause: 'shape', at: 'reason' });
});

test('D152 (3): each finding ends once — tied by its row or by what it breaks, open, to verify, or withheld', async () => {
  const titled = (title, over = {}) => reviewFinding({ title, ...over });
  const findings = [titled('SYNTHETIC by its row', { leadsFrom: ['S1'] }), titled('SYNTHETIC by a doc line'),
    titled('SYNTHETIC by your words'), titled('SYNTHETIC tied to nothing'), titled('SYNTHETIC by an ungrounded line'),
    titled('SYNTHETIC to verify', { leadsFrom: ['S1'] }), titled('SYNTHETIC refuted', { leadsFrom: ['S1'] }),
    titled('SYNTHETIC unsettled')];
  // Each its own kind and anchor line, so that no two are one identity.
  findings.forEach((f, at) => { f.kind = ['bug', 'missed_case', 'weak_test', 'contract_break'][at % 4];
    f.anchor = { ...f.anchor, startLine: 1 + (at >= 4), endLine: 1 + (at >= 4) };
    f.trace = [{ ...f.trace[0], startLine: f.anchor.startLine, endLine: f.anchor.startLine,
      quote: CODE_FILES['src/parse.js'].split('\n')[f.anchor.startLine - 1].trim() }]; });
  const verdicts = {
    'SYNTHETIC by its row': (f) => verdictOf(f, []),
    'SYNTHETIC by a doc line': (f) => verdictOf(f, [UTIL]),
    'SYNTHETIC by your words': (f) => verdictOf(f, [SAID]),
    'SYNTHETIC tied to nothing': (f) => verdictOf(f, []),
    'SYNTHETIC by an ungrounded line': (f) => verdictOf(f, [{ ...UTIL, quote: 'SYNTHETIC words on no line' }]),
    'SYNTHETIC to verify': (f) => holdsWith(f, [OUTSIDE], [UTIL]),
    'SYNTHETIC refuted': (f) => verdictOf(f, [UTIL], { verdict: 'refuted', reason: 'step_unsupported' }),
    'SYNTHETIC unsettled': (f) => verdictOf(f, [UTIL], { verdict: 'cannot_tell' }),
  };
  const { codePass: p } = await run({ findings, verify: (f) => verdicts[f.title](f) });
  const titles = (rows) => rows.map((f) => f.title);
  assert.deepEqual(titles(p.findings), ['SYNTHETIC by its row', 'SYNTHETIC by a doc line', 'SYNTHETIC by your words']);
  assert.deepEqual(titles(p.open), ['SYNTHETIC tied to nothing', 'SYNTHETIC by an ungrounded line']);
  assert.deepEqual(titles(p.unconfirmed), ['SYNTHETIC to verify']);
  assert.deepEqual(p.withheld.map((w) => [w.text, w.reason, w.check.breaks.length]), [
    ['SYNTHETIC refuted', 'verify_refuted', 1], ['SYNTHETIC unsettled', 'verify_cannot_tell', 1]]);
  assert.deepEqual(p.questions, [], 'no finding becomes a question');
  assert.equal(p.findings.length + p.open.length + p.unconfirmed.length + p.withheld.length, findings.length);
  assert.ok(p.findings.every(findingTied) && !p.open.some(findingTied));
  assert.deepEqual(p.open[1].check.breaksDropped, [{ index: 0, cause: 'quote_ungrounded' }]);
  // The readers' lists are the step's.
  const report = { codePass: p };
  assert.deepEqual([titles(codePassFindings(report)), titles(codePassOpen(report)), titles(codePassUnconfirmed(report))],
    [titles(p.findings), titles(p.open), titles(p.unconfirmed)]);
  // An open finding's item: its own kind, whatever its finding kind; Good to know by default, a proposal of high bounded
  // to Must know; a person can answer it by its id.
  assert.equal(itemKindOf('codePass.open', p.open[0]), 'code_finding_open');
  assert.deepEqual([boundTier('code_finding_open').final, boundTier('code_finding_open', 'high').final,
    boundTier('code_finding_open', 'high').bound], ['good_to_know', 'must_know', 'kind_ceiling']);
  assert.equal(ITEM_KIND_TABLE.code_finding_open.type, 'decide');
  assert.ok(answerableRowIds({ codePass: p }).includes(p.open[0].id));
  // The paragraph on how the code review works says that the check judges truth only.
  assert.equal(codeHowLine(p), W.howTied);
});

test('D152 (4): every reader computes the lists again from the record; a record before the tie rule reads as written', async () => {
  const findings = [reviewFinding({ title: 'SYNTHETIC tied', leadsFrom: ['S1'] }),
    reviewFinding({ title: 'SYNTHETIC open', anchor: { path: 'src/parse.js', side: 'new', startLine: 1, endLine: 1 },
      trace: [{ step: 'SYNTHETIC.', path: 'src/parse.js', side: 'new', startLine: 1, endLine: 1,
        quote: CODE_FILES['src/parse.js'].split('\n')[0].trim() }] }),
    reviewFinding({ title: 'SYNTHETIC by a doc line', anchor: { path: 'src/parse.js', side: 'new', startLine: 3,
      endLine: 3 }, trace: [{ step: 'SYNTHETIC.', path: 'src/parse.js', side: 'new', startLine: 3, endLine: 3,
      quote: CODE_FILES['src/parse.js'].split('\n')[2].trim() }] })];
  const { codePass } = await run({ findings, verify: (f) => verdictOf(f, f.title === 'SYNTHETIC by a doc line' ? [UTIL]
    : []) });
  const titles = (rows) => rows.map((f) => f.title);
  assert.deepEqual([titles(codePass.findings), titles(codePass.open)], [['SYNTHETIC tied', 'SYNTHETIC by a doc line'],
    ['SYNTHETIC open']]);
  assert.equal(tieRuled(codePass), true);
  // Every finding put in one list: each read by its own ties.
  const oneList = { ...codePass, findings: [...codePass.findings, ...codePass.open], open: [] };
  assert.deepEqual([titles(codePassFindings({ codePass: oneList })), titles(codePassOpen({ codePass: oneList }))],
    [['SYNTHETIC tied', 'SYNTHETIC by a doc line'], ['SYNTHETIC open']]);
  const allOpen = { ...codePass, findings: [], open: [...codePass.findings, ...codePass.open] };
  assert.deepEqual(titles(codePassFindings({ codePass: allOpen })), ['SYNTHETIC tied', 'SYNTHETIC by a doc line']);
  // A receipt of what it breaks whose quote is no longer in its stored span ties nothing: the finding reads open.
  const docLine = codePass.findings[1];
  const moved = { ...docLine, check: { ...docLine.check, breaks: docLine.check.breaks.map((r) => ({ ...r,
    span: 'SYNTHETIC another line' })) } };
  assert.deepEqual(titles(codePassOpen({ codePass: { ...codePass, findings: [codePass.findings[0], moved] } })),
    ['SYNTHETIC by a doc line', 'SYNTHETIC open']);
  // A record before the tie rule (no tie member, and no open list: its writer kept none): its published findings stand
  // as written, whatever they are tied to.
  const { open: _open, ...rest } = codePass;
  const { tie: _tie, ...version } = codePass.version;
  const before = { ...rest, version, findings: [...codePass.findings, ...codePass.open] };
  assert.equal(tieRuled(before), false);
  assert.deepEqual([titles(codePassFindings({ codePass: before })), codePassOpen({ codePass: before })],
    [['SYNTHETIC tied', 'SYNTHETIC by a doc line', 'SYNTHETIC open'], []]);
  assert.equal(codeHowLine(before), W.how);
});

test('D152 (5): only a finding\'s checking request moved — its brief and contract; rendered back, D149\'s bytes', async () => {
  const seen = [];
  await run({ findings: [reviewFinding({ leadsFrom: ['S1'] })], seen });
  const labels = seen.map((r) => r.label);
  assert.deepEqual(labels, ['code-review:agent', 'code-verify:F1']);
  const verify = seen[1];
  assert.equal(verify.schema, CODE_VERIFY_SCHEMA);
  // The briefs, as D149 (and 0.3.0-beta.7) sent them, by digest; the review agent's request did not move.
  assert.equal(sha(verifyBriefBeforeTruthOnly(CODE_VERIFY_SYSTEM)),
    '7802732393914a3d3d3c0c87c0053acd06a72bc1e192abf7334fc12b51f5907f');
  assert.equal(sha(CODE_VERIFY_SYSTEM), 'bc256d1f54bdd7b09dd63396f6540befbeddfea9bfff2f09bc20e74b12f38f2f');
  // The request carries none of the rows the finding follows from (D89): the asks list alone names a key.
  assert.ok(!verify.prompt.includes('leadsFrom'));
  // A fake checker's breaks quote the trace; the published finding keeps them grounded.
  const { codePass } = await run({ findings: [reviewFinding()], verify: (f) => verdictOf(f, traceReceipts(f)) });
  assert.deepEqual(codePass.findings.map((f) => f.check.breaks.map((r) => r.quote)), [[PARSE_QUOTE]]);
});

// ---- D152's review: the copies of one problem merge their ties --------------------------------------------------------

/** One run with a judge of its own: the review agent's answer and repair, the accounting's answer, each check. */
const runWith = async ({ review, repair = { findings: [], questions: [] }, account = accountsHold, verify }) => {
  const { session, snapshot, repo, report } = setup();
  const judge = async (request) => {
    if (/^code-account:\d+(:reask)?$/.test(request.label ?? '')) return account(request.prompt);
    if (request.label === 'code-review:agent') return review;
    if (request.label === 'code-review:repair') return repair;
    if (/^code-verify:F\d+(:reask)?$/.test(request.label)) return verify(verifiedFinding(request.prompt), request);
    if (/^code-verify:batch(:reask)?$/.test(request.label)) return allSound(batchItems(request.prompt));
    throw new Error(`unexpected ${request.label}`);
  };
  return (await runCodePass({ report, session, snapshot, repo, judge, root: ROOT, base: { kind: 'recorded_edits' } }))
    .codePass;
};
/** A copy of the fixture's finding: the same file, lines and kind, other words, tied to the ask (`S1`). */
const tiedCopy = () => reviewFinding({ title: 'SYNTHETIC the same problem, other words', leadsFrom: ['S1'] });
/** Where one problem ended: the titles of each list, and the keys each published or open finding follows from. */
const ended = (p) => ({ findings: p.findings.map((f) => f.title), open: p.open.map((f) => f.title),
  unconfirmed: p.unconfirmed.map((f) => f.title), keys: [...p.findings, ...p.open].map((f) => f.leadsFrom.map((r) => r.key)) });
const untiedVerdict = (f) => verdictOf(f, []);

test('D152 (6): a later held copy of one identity merges its rows and its grounded breaks; the order of the copies decides nothing', async () => {
  const untied = reviewFinding();
  for (const findings of [[untied, tiedCopy()], [tiedCopy(), untied]]) {
    const p = await runWith({ review: { findings, questions: [] }, verify: untiedVerdict });
    assert.deepEqual([p.findings.length, p.open, p.findings[0]?.leadsFrom.map((r) => r.key)], [1, [], ['S1']],
      findings[0].title);
  }
  // A copy whose own check grounded what it breaks: the first copy, untied, gains that receipt.
  const twin = reviewFinding({ title: 'SYNTHETIC the same problem, its check quotes a doc line' });
  const p = await runWith({ review: { findings: [untied, twin], questions: [] },
    verify: (f) => verdictOf(f, f.title === twin.title ? [UTIL] : []) });
  assert.deepEqual([p.findings.map((f) => f.title), p.open, p.findings[0]?.check.breaks.map((r) => r.quote)],
    [[untied.title], [], [UTIL.quote]]);
});

test('D152 (6): a repair\'s copy and the accounting\'s copy folded into a finding give it their rows', async () => {
  const untied = reviewFinding();
  // The repair: the answer's second finding quotes words on no line, so a repair is asked; the repair's copy of the
  // first (the same identity, tied to the ask) folds into it.
  const broken = reviewFinding({ kind: 'missed_case', title: 'SYNTHETIC words on no line',
    trace: [{ ...untied.trace[0], quote: 'SYNTHETIC words on no line' }] });
  const repaired = await runWith({ review: { findings: [untied, broken], questions: [] },
    repair: { findings: [tiedCopy()], questions: [] }, verify: untiedVerdict });
  assert.deepEqual(repaired.fates.filter((r) => r.from === 'repair' && r.list === 'findings').map((r) => [r.fate, r.into]),
    [['folded', [{ from: 'answer', index: 0 }]]]);
  assert.deepEqual(ended(repaired), { findings: [untied.title], open: [], unconfirmed: [], keys: [['S1']] });
  // The accounting's copy of the review's finding, tied to the ask, folds into it.
  const accounted = await runWith({ review: { findings: [untied], questions: [] },
    account: (prompt) => ({ ...accountsHold(prompt), findings: [tiedCopy()] }), verify: untiedVerdict });
  assert.deepEqual(accounted.fates.filter((r) => r.from === 'account').map((r) => [r.fate, r.into]),
    [['folded', [{ from: 'answer', index: 0 }]]]);
  assert.deepEqual(ended(accounted), { findings: [untied.title], open: [], unconfirmed: [], keys: [['S1']] });
});

test('D152 (6): in a review of several units, a unit\'s copy folded into the first gives it its rows, whichever unit came first', async () => {
  const mods = { codeSnapshotPlan: planOf, freezeCodeSnapshot: freezeOf, runCodePass, fixture };
  const FILES = { 'src/one/a.js': linesOf('aa', 4_000), 'src/two/c.js': linesOf('cc', 3_500),
    'src/parse.js': CODE_FILES['src/parse.js'] };
  const once = async (tiedFirst) => {
    const f = scenario(mods, { files: FILES });
    const judge = async (request) => {
      if (/^code-account:\d+(:reask)?$/.test(request.label)) return accountsHold(request.prompt);
      if (isCodeReviewLabel(request.label)) {
        const key = fixture.dossierItems(request.prompt)[0]?.key ?? fixture.askedItems(request.prompt)[0]?.key;
        const tied = request.label.includes(':U1:') === tiedFirst;
        return { findings: [reviewFinding(tied ? { leadsFrom: [key], title: 'SYNTHETIC tied copy' } : {})], questions: [] };
      }
      if (/^code-verify:F\d+/.test(request.label)) return untiedVerdict(verifiedFinding(request.prompt));
      if (/^code-verify:batch/.test(request.label)) return allSound(batchItems(request.prompt));
      throw new Error(`unexpected ${request.label}`);
    };
    return (await runCodePass({ report: f.report, session: f.session, snapshot: f.snapshot, repo: f.repo, judge,
      base: GIT, root: UNITS_ROOT, wholeFiles: false })).codePass;
  };
  for (const tiedFirst of [true, false]) {
    const p = await once(tiedFirst);
    assert.deepEqual([p.findings.length, p.open.length, p.findings[0]?.proposedBy?.length,
      p.findings[0]?.leadsFrom.length], [1, 0, 2, 1], `the tied copy in the first unit: ${tiedFirst}`);
  }
});

test('D152 (7): a record of another tie rule keeps the open list its writer put apart; every reader still reads it', async () => {
  const { codePass } = await run({ findings: [reviewFinding({ title: 'SYNTHETIC tied', leadsFrom: ['S1'] }),
    reviewFinding({ title: 'SYNTHETIC open', kind: 'missed_case' })], verify: untiedVerdict });
  const titles = (rows) => rows.map((f) => f.title);
  assert.deepEqual([titles(codePass.findings), titles(codePass.open)], [['SYNTHETIC tied'], ['SYNTHETIC open']]);
  const other = { ...codePass, version: { ...codePass.version, tie: { rule: 'SYNTHETIC another rule' } } };
  assert.equal(tieRuled(other), false);
  assert.deepEqual([titles(codePassFindings({ codePass: other })), titles(codePassOpen({ codePass: other })),
    codePassUnconfirmed({ codePass: other })], [['SYNTHETIC tied'], ['SYNTHETIC open'], []]);
  assert.ok(answerableRowIds({ codePass: other }).includes(codePass.open[0].id));
});

test('D152 (7): the re-ask grounds the person\'s words as the first answer does', async () => {
  // The first answer refutes by importance (void, its one re-ask); the re-ask holds, quoting the person's words.
  const p = await runWith({ review: { findings: [reviewFinding()], questions: [] },
    verify: (f, request) => (request.label.endsWith(':reask') ? verdictOf(f, [SAID])
      : verdictOf(f, [], { verdict: 'refuted', reason: 'not_against_goal' })) });
  assert.deepEqual([p.calls.verifyRepeat, p.open.length, p.findings.map((f) => f.check.breaks.map((r) => r.source))],
    [1, 0, [['session']]]);
});

test('D152 (7): one identity is in one list, the open one too; the label is read before the tie', async () => {
  // Two copies of one problem, neither tied: one open finding.
  const twin = reviewFinding({ title: 'SYNTHETIC the same problem, other words' });
  const open = await runWith({ review: { findings: [reviewFinding(), twin], questions: [] }, verify: untiedVerdict });
  assert.deepEqual([open.findings.length, open.open.length, open.unconfirmed.length], [0, 1, 0]);
  // A finding to verify that nothing ties: to verify, never open.
  const toVerify = await runWith({ review: { findings: [reviewFinding()], questions: [] },
    verify: (f) => holdsWith(f, [OUTSIDE], []) });
  assert.deepEqual([toVerify.findings.length, toVerify.open.length, toVerify.unconfirmed.length], [0, 0, 1]);
});
