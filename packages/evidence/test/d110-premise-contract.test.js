// D110 (bucket C, F4; the owner, 2026-10-17: "There is some usage left to go for C and E"): the premise contract. A
// finding's checking agent lists the premises a finding rests on (1 to 6), each with its source (ledger.js
// CODE_PREMISE_SOURCES: a line of the repository, documented behaviour of the language, or outside both) and its
// receipts; code computes the label (code-pass.js `findingConfirmed`): a finding is published as checked only when its
// verdict holds and every premise is `repository` or `language`, each receipt grounded; one `outside` premise makes it
// a finding to verify (`codePass.unconfirmed`), never confirmed, never withheld. The invariants, each a test:
//   1. A missing or malformed premise list, or a `repository` premise with no receipt, is void (`shape`); a premise
//      receipt that does not ground is void (`receipt_ungrounded`); each takes the one existing re-ask.
//   2. Every finding in the confirmed list has a stored check that holds, with 1 to 6 premises, each `repository` (with
//      a grounded receipt) or `language`; every finding to verify holds and has a premise that cannot confirm.
//   3. Each grounded finding the checks answered ends once: confirmed, to verify, an open question or withheld; no id
//      is in both lists.
//   4. The label is a pure function of the stored check and its grounding: every reader computes it again from the
//      record, so a stored report with one premise's receipts removed, or its source made `outside`, no longer shows
//      that finding as checked (a mutation of the record).
//   5. Code reads a premise's source only so that `outside` keeps a finding from being checked: an `outside` premise
//      with grounded receipts still does not confirm; a `language` premise with none does.
//   6. No session status moves: a finding to verify contradicts no row and moves no ask; it links an ask only as a line
//      beside it.
//
// Synthetic sessions and files, an in-memory repository reader and deterministic fake agents: no recording, no model, no
// network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CODE_PREMISE_SOURCES, ASK_CODE_LINKS, ASK_CODE_ATTENTION_LINKS } from '../src/ledger.js';
import { runCodePass, codeSnapshotPlan, freezeCodeSnapshot, findingConfirmed, findingToVerify, premiseConfirms,
  codePassFindings, codePassUnconfirmed, premiseRuled, codeRowCheck, codeLinkStands, CODE_VERIFY_SYSTEM, CODE_VERIFY_SCHEMA,
  CODE_BATCH_VERIFY_SYSTEM, CODE_BATCH_VERIFY_SCHEMA, CODE_PASS_PROFILE, TRACE_LIMITS } from '../src/code-pass.js';
import { askCodeLinks } from '../src/ask-code-links.js';
import { askRowKind } from '../src/review.js';
import { answerableRowIds } from '../src/checklist.js';
import { CODE_FILES, codeSession, reviewFinding, holds, holdsWith, repositoryPremise, traceReceipts, allSound,
  verifiedFinding, batchItems, PARSE_QUOTE, accountsHold } from '../../cli/test/code-pass-fixture.js';
import { premiseReport, triageReport, triageSession, OUTSIDE_PREMISE, UNCONFIRMED_ID, ROWS }
  from './report-triage-fixture.js';

const enc = (text) => new TextEncoder().encode(text);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const ROOT = '/work/repo';

/** The session writes src/parse.js (no git base: the change is the recorded edit); the repository now holds the
 *  fixture's files. */
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
/** The fake agents: the review agent answers `findings`; a finding's checking agent `verify(finding, nth)` (its nth
 *  call, re-asks counted); every question sound. `seen` receives every request. */
function agents({ findings, verify = holds, seen = [] }) {
  let calls = 0;
  return async (request) => {
    // F3b (D111): an accounting agent's request answers every item as holding, and stays out of `seen`: this file
    // reads the review's requests and its checks' (d111-accounting.test.js reads the accounting's).
    if (/^code-account:\d+(:reask)?$/.test(request.label ?? '')) return accountsHold(request.prompt);
    seen.push(request);
    if (request.label === 'code-review:agent' || request.label === 'code-review:repair')
      return { findings, questions: [] };
    if (/^code-verify:F\d+(:reask)?$/.test(request.label)) return verify(verifiedFinding(request.prompt), calls++, request);
    if (/^code-verify:batch(:reask)?$/.test(request.label)) return allSound(batchItems(request.prompt));
    throw new Error(`unexpected ${request.label}`);
  };
}
const run = async ({ findings = [reviewFinding()], verify, seen } = {}) => {
  const { session, snapshot, repo, report } = setup();
  return runCodePass({ report, session, snapshot, repo, judge: agents({ findings, verify, seen }), root: ROOT,
    base: { kind: 'recorded_edits' } });
};
const labels = (seen) => seen.map((r) => r.label);
/** A premise outside the repository and the language, as a check writes one. */
const OUTSIDE = Object.freeze({ premise: 'SYNTHETIC the runtime splits an empty string into one empty part.',
  source: 'outside', receipts: [] });
const LANGUAGE = Object.freeze({ premise: 'SYNTHETIC in JavaScript, "".split(",") returns [""].', source: 'language',
  receipts: [] });

// ---- the contract ----------------------------------------------------------------------------------------------------

test('D110: the checking agent\'s contract requires 1 to 6 premises, each with its words, its closed source and its receipts; the brief names the sources; the batch request did not move', () => {
  assert.deepEqual(CODE_PREMISE_SOURCES, ['repository', 'language', 'outside']);
  assert.deepEqual([TRACE_LIMITS.premises, TRACE_LIMITS.premiseChars], [6, 300]);
  assert.ok(CODE_VERIFY_SCHEMA.required.includes('premises'));
  const premises = CODE_VERIFY_SCHEMA.properties.premises;
  assert.deepEqual([premises.minItems, premises.maxItems], [1, 6]);
  assert.deepEqual(premises.items.required, ['premise', 'source', 'receipts']);
  assert.deepEqual(premises.items.properties.source.enum, [...CODE_PREMISE_SOURCES]);
  assert.equal(premises.items.properties.premise.maxLength, 300);
  for (const source of CODE_PREMISE_SOURCES) assert.ok(CODE_VERIFY_SYSTEM.includes(`"${source}"`), source);
  assert.match(CODE_VERIFY_SYSTEM, /That a test, bench or\s+command reaches some code is shown only by its call chain/);
  assert.match(CODE_VERIFY_SYSTEM, /Your memory of how a tool behaves is not a line of the repository\./);
  // The model is told no consequence: the source says where a premise's evidence is, and code computes the label.
  assert.doesNotMatch(CODE_VERIFY_SYSTEM, /confirm/i);
  assert.match(CODE_VERIFY_SYSTEM, /No ratings, severity, rank or confidence\.$/);
  assert.doesNotMatch(CODE_BATCH_VERIFY_SYSTEM, /premise[s]? /);
  assert.equal(Object.hasOwn(CODE_BATCH_VERIFY_SCHEMA.properties.questions.items.properties, 'premises'), false);
  assert.deepEqual(CODE_PASS_PROFILE.premises, { sources: CODE_PREMISE_SOURCES,
    confirm: 'holds-and-every-premise-repository-or-language' });
});

// ---- invariant 1: void shapes and grounding, each with the one re-ask -------------------------------------------------

test('D110 (1): a missing or malformed premise list, or a repository premise with no receipt, is void `shape` and takes the one re-ask; still void, withheld unexecuted', async () => {
  const cases = [
    ['no list', (f) => { const { premises: _p, ...rest } = holds(f); return rest; }, 'answer.premises'],
    ['an empty list', (f) => holdsWith(f, []), 'premises'],
    ['seven premises', (f) => holdsWith(f, Array.from({ length: 7 }, () => LANGUAGE)), 'premises'],
    ['a source outside the list', (f) => holdsWith(f, [{ ...LANGUAGE, source: 'memory' }]), 'premises[0].source'],
    ['a repository premise with no receipt', (f) => holdsWith(f, [{ ...repositoryPremise(f), receipts: [] }]),
      'premises[0].receipts'],
    ['words over 300 characters', (f) => holdsWith(f, [{ ...LANGUAGE, premise: 'x'.repeat(301) }]), 'premises[0].premise'],
    ['a key outside the contract', (f) => holdsWith(f, [{ ...LANGUAGE, confidence: 'high' }]), 'premises[0]."confidence"'],
    ['receipts that are not a list', (f) => holdsWith(f, [{ ...LANGUAGE, receipts: null }]), 'premises[0].receipts'],
    ['a receipt out of its shape', (f) => holdsWith(f, [{ ...repositoryPremise(f), receipts: [{ path: 'src/parse.js' }] }]),
      'premises[0].receipts[0].side'],
  ];
  for (const [name, verify, at] of cases) {
    const seen = [];
    const result = await run({ verify, seen });
    assert.deepEqual(labels(seen), ['code-review:agent', 'code-verify:F1', 'code-verify:F1:reask'], name);
    assert.ok(seen[2].prompt.includes(`- shape (the answer broke its contract) at ${at}\n`), `${name}: ${seen[2].prompt
      .split('Re-ask')[1]}`);
    assert.deepEqual(result.codePass.withheld.map((w) => [w.reason, w.cause]), [['verify_unexecuted', 'shape']], name);
    assert.deepEqual([result.codePass.findings, result.codePass.unconfirmed], [[], []], name);
  }
  // Mended by its re-ask, it counts.
  const mended = await run({ verify: (f, n) => (n === 0 ? holdsWith(f, []) : holds(f)) });
  assert.equal(mended.codePass.findings.length, 1);
  assert.equal(mended.codePass.calls.verifyRepeat, 1);
});

test('D110 (1): a premise receipt that does not ground is void `receipt_ungrounded` at its place, and takes the one re-ask', async () => {
  const off = (f) => holdsWith(f, [{ ...repositoryPremise(f), receipts: [{ path: 'src/parse.js', side: 'new',
    startLine: 2, endLine: 2, quote: 'not in the file at all' }] }]);
  const seen = [];
  const result = await run({ verify: off, seen });
  assert.match(seen[2].prompt, /^- receipt_ungrounded \([^)]*\) at src\/parse\.js:2$/m);
  assert.deepEqual(result.codePass.withheld.map((w) => [w.reason, w.cause]), [['verify_unexecuted', 'receipt_ungrounded']]);
  // An outside premise's receipts ground like any other: one that does not is void too.
  const outside = await run({ verify: (f) => holdsWith(f, [{ ...OUTSIDE, receipts: [{ path: 'src/parse.js', side: 'new',
    startLine: 2, endLine: 2, quote: 'not in the file at all' }] }]) });
  assert.deepEqual(outside.codePass.withheld.map((w) => w.cause), ['receipt_ungrounded']);
});

// ---- invariants 2, 3 and 5: the label code computes -------------------------------------------------------------------

test('D110 (2, 5): a check that holds on lines of the repository and documented behaviour of the language is published as checked, its premises stored grounded', async () => {
  const result = await run({ verify: (f) => holdsWith(f, [repositoryPremise(f), LANGUAGE]) });
  const [finding] = result.codePass.findings;
  assert.deepEqual(result.codePass.unconfirmed, []);
  assert.equal(findingConfirmed(finding.check), true);
  assert.deepEqual(finding.check.premises.map((p) => [p.premise, p.source, p.receipts.length]),
    [['Synthetic: the traced lines show the problem.', 'repository', 1], [LANGUAGE.premise, 'language', 0]]);
  const [receipt] = finding.check.premises[0].receipts;
  assert.equal(receipt.quote, PARSE_QUOTE);
  assert.ok(receipt.span.includes(receipt.quote) && /^[0-9a-f]{64}$/.test(receipt.sha256), 'stored grounded');
  // A language premise with no receipt confirms; every premise checked by `premiseConfirms`.
  assert.ok(finding.check.premises.every(premiseConfirms));
  assert.ok(premiseRuled(result.codePass));
});

test('D110 (2, 5): one premise outside the repository and the language makes a finding that holds one to verify — never confirmed, never withheld — even with grounded receipts', async () => {
  for (const outside of [OUTSIDE, { ...OUTSIDE, receipts: [{ path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2,
    quote: PARSE_QUOTE }] }]) {
    const result = await run({ verify: (f) => holdsWith(f, [repositoryPremise(f), outside]) });
    assert.deepEqual(result.codePass.findings, []);
    assert.deepEqual(result.codePass.withheld, []);
    const [finding] = result.codePass.unconfirmed;
    assert.equal(finding.title, reviewFinding().title);
    assert.equal(finding.check.verdict, 'holds');
    assert.equal(findingConfirmed(finding.check), false);
    assert.deepEqual(finding.check.premises.map((p) => [p.premise, p.source]), [[repositoryPremise({ trace: [] }).premise,
      'repository'], [OUTSIDE.premise, 'outside']]);
    assert.match(finding.id, /^sha256:[0-9a-f]{64}$/);
    // Every reader reads it as one to verify, never as checked.
    assert.deepEqual([codePassFindings({ codePass: result.codePass }), codePassUnconfirmed({ codePass: result.codePass })
      .map((f) => f.id)], [[], [finding.id]]);
  }
});

test('D110 (3): each grounded finding ends once — checked, to verify, an open question or withheld; no id is in both lists', async () => {
  const titled = (title, line = 2) => reviewFinding({ title, ...(line === 2 ? {} : {
    trace: [{ step: 'SYNTHETIC.', path: 'src/parse.js', side: 'new', startLine: line, endLine: line,
      quote: CODE_FILES['src/parse.js'].split('\n')[line - 1].trim() }],
    anchor: { path: 'src/parse.js', side: 'new', startLine: line, endLine: line } }) });
  const findings = [titled('SYNTHETIC checked', 1), titled('SYNTHETIC to verify', 2), titled('SYNTHETIC refuted', 3),
    titled('SYNTHETIC unsettled', 2), titled('SYNTHETIC not against the goal', 3), titled('SYNTHETIC void', 1)];
  const verdicts = {
    'SYNTHETIC checked': (f) => holds(f),
    'SYNTHETIC to verify': (f) => holdsWith(f, [OUTSIDE]),
    'SYNTHETIC refuted': (f) => ({ ...holdsWith(f, [LANGUAGE]), verdict: 'refuted', reason: 'step_unsupported' }),
    'SYNTHETIC unsettled': (f) => ({ ...holdsWith(f, [LANGUAGE]), verdict: 'cannot_tell' }),
    'SYNTHETIC not against the goal': (f) => ({ ...holdsWith(f, [LANGUAGE]), verdict: 'refuted',
      reason: 'not_against_goal' }),
    'SYNTHETIC void': (f) => holdsWith(f, []),
  };
  const result = await run({ findings, verify: (f) => verdicts[f.title](f) });
  const p = result.codePass;
  assert.deepEqual(p.findings.map((f) => f.title), ['SYNTHETIC checked']);
  assert.deepEqual(p.unconfirmed.map((f) => f.title), ['SYNTHETIC to verify']);
  assert.deepEqual(p.questions.map((q) => [q.question, q.from]), [['SYNTHETIC not against the goal', 'finding']]);
  assert.deepEqual(p.withheld.map((w) => [w.text, w.reason]), [['SYNTHETIC refuted', 'verify_refuted'],
    ['SYNTHETIC unsettled', 'verify_cannot_tell'], ['SYNTHETIC void', 'verify_unexecuted']]);
  assert.equal(p.findings.length + p.unconfirmed.length + p.questions.filter((q) => q.from === 'finding').length
    + p.withheld.filter((w) => w.what === 'finding').length, findings.length);
  assert.ok(p.findings.every((f) => findingConfirmed(f.check)));
  assert.ok(p.unconfirmed.every((f) => f.check.verdict === 'holds' && !findingConfirmed(f.check)));
  const ids = [...p.findings, ...p.unconfirmed].map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'no id in both lists');
});

test('D110 (3): one identity is published once, in the list of the first finding of that identity', async () => {
  const twice = [reviewFinding({ title: 'SYNTHETIC first' }), reviewFinding({ title: 'SYNTHETIC second' })];
  const firstOutside = await run({ findings: twice, verify: (f) => (f.title === 'SYNTHETIC first' ? holdsWith(f, [OUTSIDE])
    : holds(f)) });
  assert.deepEqual([firstOutside.codePass.findings.length, firstOutside.codePass.unconfirmed.map((f) => f.title)],
    [0, ['SYNTHETIC first']]);
  const firstChecked = await run({ findings: twice, verify: (f) => (f.title === 'SYNTHETIC first' ? holds(f)
    : holdsWith(f, [OUTSIDE])) });
  assert.deepEqual([firstChecked.codePass.findings.map((f) => f.title), firstChecked.codePass.unconfirmed.length],
    [['SYNTHETIC first'], 0]);
});

// ---- invariant 4: the label is computed again from the record ---------------------------------------------------------

test('D110 (4): the label is a pure function of the stored check — a stored report with one premise\'s receipts removed, its source made outside, or no premise, no longer shows that finding as checked', async () => {
  const result = await run({ verify: (f) => holdsWith(f, [repositoryPremise(f), LANGUAGE]) });
  const stored = JSON.parse(JSON.stringify({ codePass: result.codePass }));
  assert.equal(codePassFindings(stored).length, 1);
  assert.equal(codePassUnconfirmed(stored).length, 0);
  const mutate = (change) => {
    const copy = structuredClone(stored);
    change(copy.codePass.findings[0].check);
    return copy;
  };
  // A premise that can no longer confirm: the finding is one to verify, with that premise to name.
  for (const [name, change] of [
    ['receipts removed', (check) => { check.premises[0].receipts = []; }],
    ['source made outside', (check) => { check.premises[1].source = 'outside'; }],
    ['a source outside the list', (check) => { check.premises[1].source = 'memory'; }],
    ['a receipt no longer in its span', (check) => { check.premises[0].receipts[0].span = 'something else'; }],
    ['a receipt with no file version', (check) => { check.premises[0].receipts[0].sha256 = 'not a hash'; }],
    ['a receipt hash out of its form', (check) => { check.premises[0].receipts[0].sha256 = 'A'.repeat(64); }],
  ]) {
    const copy = mutate(change);
    assert.deepEqual(codePassFindings(copy), [], name);
    assert.deepEqual(codePassUnconfirmed(copy).map((f) => f.id), [stored.codePass.findings[0].id], name);
    assert.ok(codePassUnconfirmed(copy)[0].check.premises.some((p) => !premiseConfirms(p)), name);
  }
  // D110's review: a stored check out of the shape the step writes — a verdict that does not hold, or a premise list
  // that is gone, empty, over 6 or holds a premise with no words — is read in neither list: no reader can say that its
  // check found the same problem, or name a premise that keeps it from being checked.
  for (const [name, change] of [
    ['no premise', (check) => { check.premises = []; }],
    ['premises gone', (check) => { delete check.premises; }],
    ['the verdict not holds', (check) => { check.verdict = 'cannot_tell'; }],
    ['the verdict refuted', (check) => { check.verdict = 'refuted'; check.premises[1].source = 'outside'; }],
    ['seven premises that each confirm', (check) => { check.premises = Array.from({ length: 7 },
      () => structuredClone(check.premises[1])); }],
    ['seven premises, one outside', (check) => { check.premises = [...Array.from({ length: 6 },
      () => structuredClone(check.premises[1])), { ...OUTSIDE }]; }],
    ['a premise with no words', (check) => { check.premises[1].premise = '  '; }],
    ['a premise that is not an object', (check) => { check.premises[1] = 'language'; }],
  ]) {
    const copy = mutate(change);
    assert.deepEqual([codePassFindings(copy), codePassUnconfirmed(copy)], [[], []], name);
    assert.deepEqual([findingConfirmed(copy.codePass.findings[0].check), findingToVerify(copy.codePass.findings[0].check)],
      [false, false], name);
  }
  // Six premises that each confirm, in the shape the step writes, still confirm.
  const six = mutate((check) => { check.premises = Array.from({ length: 6 }, () => structuredClone(check.premises[1])); });
  assert.deepEqual([codePassFindings(six).length, codePassUnconfirmed(six).length], [1, 0]);
  // And a finding to verify that a writer put in the confirmed list is still read as one to verify; one whose stored
  // check confirms, in the other list, is read as checked.
  const outside = await run({ verify: (f) => holdsWith(f, [OUTSIDE]) });
  const moved = { codePass: { ...outside.codePass, findings: outside.codePass.unconfirmed, unconfirmed: [] } };
  assert.deepEqual([codePassFindings(moved).length, codePassUnconfirmed(moved).length], [0, 1]);
  const back = { codePass: { ...stored.codePass, findings: [], unconfirmed: stored.codePass.findings } };
  assert.deepEqual([codePassFindings(back).length, codePassUnconfirmed(back).length], [1, 0]);
  // A report made before the premise contract (no rule named in its record) keeps the gate of its day.
  const earlier = { codePass: { ...stored.codePass, version: { pass: 'sonah.code-pass/12', verify: 'sonah.code-verify/2' },
    findings: [{ ...stored.codePass.findings[0], check: { verdict: 'holds', explanation: 'x', receipts: [] } }] } };
  assert.deepEqual([premiseRuled(earlier.codePass), codePassFindings(earlier).length, codePassUnconfirmed(earlier).length],
    [false, 1, 0]);
});

// ---- invariant 6: no session status moves -----------------------------------------------------------------------------

test('D110 (6): a claim_false finding to verify contradicts no row; one that holds on the repository does', async () => {
  const { session, snapshot, repo } = setup();
  const report = { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [], requirements: [],
    decisions: [], failures: [], writtenClaims: [], pivots: [],
    promises: [{ id: `sha256:${'1'.repeat(64)}`, text: 'The agent said parse returns an empty list for empty input.',
      status: 'open', stated: { eventId: 'C1', role: 'commentary', quote: 'parse now returns an empty list for empty input.' },
      receipts: [] }] };
  const claimFalse = (review) => {
    const claim = review.split('\n').filter((line) => line.startsWith('{"key":"S')).map((line) => JSON.parse(line))
      .find((item) => item.kind === 'claim');
    return [reviewFinding({ kind: 'claim_false', lens: 'claims', title: 'SYNTHETIC parse("") is [""]',
      leadsFrom: claim ? [claim.key] : [] })];
  };
  const judge = (verify) => async (request) => {
    if (request.label === 'code-review:agent') return { findings: claimFalse(request.prompt), questions: [] };
    if (/^code-verify:F/.test(request.label)) return verify(verifiedFinding(request.prompt));
    return allSound(batchItems(request.prompt));
  };
  const toVerify = await runCodePass({ report, session, snapshot, repo, root: ROOT, base: { kind: 'recorded_edits' },
    judge: judge((f) => holdsWith(f, [OUTSIDE])) });
  assert.equal(toVerify.codePass.unconfirmed.length, 1);
  assert.deepEqual([...toVerify.checks.keys()], [], 'no row is contradicted by a finding to verify');
  const checked = await runCodePass({ report, session, snapshot, repo, root: ROOT, base: { kind: 'recorded_edits' },
    judge: judge(holds) });
  assert.deepEqual([...checked.checks.keys()], ['promises:0']);
});

test('D110 (6): a finding to verify links the ask it follows from as a line beside it, never as an attention link — a done ask stays done; a person can answer it', async () => {
  assert.equal(ASK_CODE_LINKS.at(-1), 'unconfirmed_finding');
  assert.ok(!ASK_CODE_ATTENTION_LINKS.includes('unconfirmed_finding'));
  const session = triageSession();
  const report = premiseReport(session);
  const ask = report.requirements[ROWS.askAdd];
  assert.equal(ask.status, 'done');
  assert.deepEqual(ask.codeLinks, [{ link: 'unconfirmed_finding', unconfirmed: UNCONFIRMED_ID }]);
  assert.equal(askRowKind(ask), null, 'a done ask with only a finding to verify is no attention row');
  // A person can confirm or overrule a finding to verify, by its id, as any published finding.
  const toVerify = await run({ verify: (f) => holdsWith(f, [OUTSIDE]) });
  assert.deepEqual(answerableRowIds({ codePass: toVerify.codePass }), [toVerify.codePass.unconfirmed[0].id]);
  // The same report before the premise contract has no such link, and its ask is as it was.
  assert.equal(triageReport(session).requirements[ROWS.askAdd].codeLinks, undefined);
  // Fixture (g)'s outside premise is the check's own words, kept byte for byte in the record.
  assert.ok(codePassUnconfirmed(report)[0].check.premises.some((p) => p.premise === OUTSIDE_PREMISE));
  assert.ok(traceReceipts(reviewFinding()).length > 0);
});

test('D110 (6, review): a join the step makes from a finding stands only beside a finding that code\'s label confirms — a row\'s contradiction, and an ask\'s attention link', () => {
  const session = triageSession();
  const report = premiseReport(session);
  const [checked] = codePassFindings(report);
  const contradicted = (finding) => ({ outcome: 'contradicted-by-code', receipts: [], by: 'finding', finding });
  // A row's code check: a contradiction naming a finding to verify is read as none; naming a checked one, as stored.
  const row = { ...report.requirements[ROWS.askAdd], codeLinks: undefined };
  assert.equal(codeRowCheck(report, { ...row, codeCheck: contradicted(UNCONFIRMED_ID) }), null);
  assert.equal(codeRowCheck(report, { ...row, codeCheck: contradicted(checked.id) })?.finding, checked.id);
  assert.equal(codeRowCheck(report, { ...row, codeCheck: contradicted(undefined) }), null);
  // So the step's ask links make no attention link from it (ask-code-links.js reads the row's check the same way).
  const linksWith = (codeCheck) => {
    const copy = { ...report, requirements: report.requirements.map((r, i) => (i === ROWS.askAdd ? { ...r, codeCheck }
      : r)) };
    return askCodeLinks(copy, session)[ROWS.askAdd].map((l) => l.link);
  };
  assert.ok(!linksWith(contradicted(UNCONFIRMED_ID)).includes('contradicted_by_code'));
  assert.ok(linksWith(contradicted(checked.id)).includes('contradicted_by_code'));
  // An ask's stored attention link: it stands beside a checked finding, and not beside one to verify.
  for (const link of ASK_CODE_ATTENTION_LINKS) {
    assert.equal(codeLinkStands(report, { link, finding: checked.id }), true, link);
    assert.equal(codeLinkStands(report, { link, finding: UNCONFIRMED_ID }), false, link);
  }
  assert.equal(codeLinkStands(report, { link: 'unconfirmed_finding', unconfirmed: UNCONFIRMED_ID }), true);
  // A report before the premise contract keeps every join as stored.
  const earlier = triageReport(session);
  assert.equal(codeLinkStands(earlier, { link: 'leads_from', finding: 'sha256:none' }), true);
  assert.equal(codeRowCheck(earlier, { codeCheck: contradicted(undefined) })?.outcome, 'contradicted-by-code');
});
