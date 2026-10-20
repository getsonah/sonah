// D111 (F3b, bucket C; the owner, 2026-10-17: "There is some usage left to go for C and E"): the accounting. After the
// code review and its repair, accounting agents account for the items of the session review in scope (ledger.js
// CODE_ACCOUNT_SCOPE: the session review's asks, then the statements the agent wrote into a file, then its decisions not
// to act), in batches of at most CODE_ACCOUNT_LIMITS.keys, at most CODE_ACCOUNT_LIMITS.calls a review, each its own call. The
// invariants of the global rewrite's F3, each a test:
//   I1  every item in scope ends with exactly one fate of the closed list; `missing` with one closed cause.
//   I2  an entry counts as examined only when it gives a receipt and every receipt grounds by string search.
//   I3  a `breaks` entry names a finding or question of the code review, or carries a finding that faces its checker,
//       or it is missing (`unreported`); no entry changes a finding's fate; a `holds` entry for an item a published
//       finding follows from is voided (`inconsistent`), the finding kept.
//   I5  every finding of the review, its repair and the accounting has exactly one fate record.
//   I6  an accounting finding of one identity with a finding that stands is folded into it, never checked twice.
//   I7  the review's request and contract do not depend on the accounting; failing every accounting call changes no
//       finding's or question's fate, only the counts of what was not accounted for.
//   I8  every accounting request carries at most `keys` items, each item in exactly one batch or past the cap; the
//       contract's largest answer is at most half the output ceiling, computed from its maxima.
//   I9  the page and the report .md depend only on the counts of items not examined or missing: the words, receipts and
//       outcomes of examined entries change no byte, and no line says what the accounting examined. Amended by D125
//       (2026-10-20, the owner: "Let's fix 1st"; amended, "go for option 3"): but a `holds` entry on an ask that the
//       session review left not checked, which the ask's row notes, its status and every count as before
//       (render/test/d125-code-holds.test.js); this file's asks are read done.
//   I10 the coverage is never complete while an item in scope is not examined or missing.
//   I11 the closed lists and the bounds are in the session run profile (the digest is m33-fast-profile-baseline's).
//
// Synthetic sessions and files, an in-memory repository reader and deterministic fake agents: no recording, no model, no
// network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CODE_ACCOUNT_SCOPE, CODE_ACCOUNT_OUTCOMES, CODE_ACCOUNT_FATES, CODE_ACCOUNT_MISSING, CODE_REPAIR_FATES }
  from '../src/ledger.js';
import { runCodePass, codeSnapshotPlan, freezeCodeSnapshot, withCodePass, accountScopeOf, checkedAccount, checkedFates,
  accountItems, accountFindingCount, markSourceChanged,
  CODE_ACCOUNT_SCHEMA, CODE_ACCOUNT_SYSTEM, CODE_ACCOUNT_LIMITS, CODE_ACCOUNT_VERSION, CODE_PASS_PROFILE,
  CODE_REVIEW_SYSTEM, CODE_REVIEW_SCHEMA, CODE_AGENT_LIMITS } from '../src/code-pass.js';
import { codeDossier } from '../src/code-context.js';
import { requestBeforeListedAsks } from './m33-integration-fixture.js';
import { TOKEN_BYTES } from '../src/windows.js';
import { reviewInputBytes } from '../src/challenge.js';
import { CODE_REPORT_WORDS, codeFooterLines, codeCoverageLines, codeReviewCoverage, codeQuestionsLine }
  from '../src/code-report.js';
import { renderSessionPage, escapeHtml } from '../../render/session-page.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import { reportModel } from '../../render/report-model.js';
import { REPORT_NOT_CHECKED_WORDS } from '../../render/report-words.js';
import { RUN_STATE_WORDS, runStateLine } from '../../cli/src/session-review-command.js';
import { CODE_FILES, codeSession, reviewFinding, holds, holdsWith, allSound, verifiedFinding, batchItems,
  accountItemsShown, withRun, readsEveryFile, PARSE_QUOTE } from '../../cli/test/code-pass-fixture.js';

const enc = (text) => new TextEncoder().encode(text);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const ROOT = '/work/repo';
const R = (eventId, role, quote) => ({ eventId, role, quote });
/** A receipt that grounds: line 2 of parse.js, which the session wrote. */
const LINE_2 = Object.freeze({ path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2, quote: PARSE_QUOTE });
/** A receipt that does not: the words are on no line of the file. */
const NOWHERE = Object.freeze({ ...LINE_2, quote: 'SYNTHETIC words on no line of the file' });

/** A report over `codeSession` with `asks` asks, a claim (out of scope), `written` statements written into a file and a
 *  decision not to act beside one made without asking (out of scope). */
function reportOf({ asks = 2, written = 1 } = {}) {
  return { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [], pivots: [], failures: [],
    requirements: Array.from({ length: asks }, (_, i) => ({ text: `SYNTHETIC ask ${i + 1}`, status: 'done',
      instruction: R('I1', 'instruction', 'add a parse function that returns [] for empty input') })),
    promises: [{ id: `sha256:${'1'.repeat(64)}`, stated: R('C1', 'commentary', 'parse now returns an empty list'),
      status: 'open', receipts: [] }],
    writtenClaims: Array.from({ length: written }, (_, i) => ({ id: `sha256:${String(i + 4).repeat(64)}`,
      stated: R('C1', 'commentary', 'parse now returns an empty list'), label: 'unverified' })),
    decisions: [
      { id: `sha256:${'2'.repeat(64)}`, dimension: 'The README', chosen: 'leave it as it is', actions: [], column: 'unasked',
        notActing: true, stated: null },
      { id: `sha256:${'3'.repeat(64)}`, dimension: 'How to split the input', chosen: 'Split on commas', actions: ['W1'],
        column: 'unasked', stated: null }],
  };
}
/** The session writes src/parse.js (no git base: the change is the recorded edit); the repository holds the fixture's
 *  files. */
function setup(report = reportOf()) {
  const session = codeSession();
  const plan = codeSnapshotPlan(session);
  const snapshot = freezeCodeSnapshot(plan, plan.map((entry) => (Object.hasOwn(CODE_FILES, entry.path)
    ? { path: entry.path, bytes: enc(CODE_FILES[entry.path]) } : { path: entry.path, state: 'deleted' })),
  { base: { kind: 'recorded_edits' } });
  const named = (path) => String(path).replace(/^\.\//, '').replace(`${ROOT}/`, '');
  const repo = { root: ROOT, top: ROOT, read: (path) => (Object.hasOwn(CODE_FILES, named(path))
    ? { path: named(path), text: CODE_FILES[named(path)], sha256: sha(CODE_FILES[named(path)]) } : null),
  base: () => null };
  return { session, snapshot, repo, report };
}
/** An accounting answer from `entryOf(key, n)` (an entry's fields but its key, by the item's place in the batch), and
 *  `findings` of its own. */
const answerWith = (entryOf, findings = []) => (prompt) => ({ entries: accountItemsShown(prompt)
  .map(({ key }, n) => ({ key, outcome: 'holds', receipts: [LINE_2], by: null, finding: null, ...entryOf(key, n) })),
findings });
const ALL_HOLD = answerWith(() => ({}));
/** The fake agents: the review agent answers `findings` and `questions`, having read every file of the repository whole
 *  (so the change is seen, and only the accounting can keep the coverage short); each finding's checker `verify`; every
 *  question sound; the accounting agent `account(prompt, request)`. `seen` receives every request. */
function agents({ findings = [], questions = [], verify = holds, account = ALL_HOLD, seen = [] } = {}) {
  return async (request) => {
    seen.push(request);
    if (request.label === 'code-review:agent' || request.label === 'code-review:repair')
      return withRun({ findings, questions }, readsEveryFile(request));
    if (/^code-verify:F\d+(:reask)?$/.test(request.label)) return verify(verifiedFinding(request.prompt), request);
    if (/^code-verify:batch(:reask)?$/.test(request.label)) return allSound(batchItems(request.prompt));
    if (/^code-account:\d+(:reask)?$/.test(request.label)) return account(request.prompt, request);
    throw new Error(`unexpected ${request.label}`);
  };
}
const run = async (judge, { report, bound = Infinity } = {}) => {
  const f = setup(report);
  return runCodePass({ report: f.report, session: f.session, snapshot: f.snapshot, repo: f.repo, judge, bound, root: ROOT,
    base: { kind: 'recorded_edits' } });
};
const labels = (seen) => seen.map((r) => r.label);
const fates = ({ codePass: p }) => p.account.entries.map((e) => [e.key, e.scope, e.fate, e.cause ?? null]);
/** The keys of the fixture's dossier: S1 and S2 the asks, S3 the claim, S4 the written statement, S5 the decision not
 *  to act, S6 the decision made without asking. */
const [ASK1, ASK2, CLAIM, WRITTEN, NOT_ACTING] = ['S1', 'S2', 'S3', 'S4', 'S5'];

// ---- the contract, the brief and the bounds ----------------------------------------------------------------------------

test('D111: the accounting\'s contract, closed and bounded; its brief asks one entry for every item and tells no consequence; the review\'s brief and contract did not move', () => {
  assert.deepEqual(CODE_ACCOUNT_SCOPE, ['ask', 'written_claim', 'not_acting']);
  assert.deepEqual(CODE_ACCOUNT_OUTCOMES, ['breaks', 'holds', 'outside', 'not_examined']);
  assert.deepEqual(CODE_ACCOUNT_FATES, [...CODE_ACCOUNT_OUTCOMES, 'missing']);
  assert.deepEqual(CODE_ACCOUNT_MISSING, ['not_returned', 'malformed', 'evidence_grounding_failed', 'unreported',
    'inconsistent', 'batch_failed', 'too_large', 'over_review_limit']);
  assert.deepEqual(CODE_ACCOUNT_LIMITS, { keys: 30, calls: 4, receipts: 4, findings: 5, keyChars: 16, pathChars: 300,
    outputTokens: 128_000 });
  // D114 (0.3.0-beta.5): /2, its request shows the person's asks as the session review lists them.
  assert.equal(CODE_ACCOUNT_VERSION, 'sonah.code-account/2');
  assert.deepEqual(CODE_AGENT_LIMITS.account, { maxTurns: 80, timeoutMs: 30 * 60_000 });
  assert.deepEqual(CODE_ACCOUNT_SCHEMA.required, ['entries', 'findings']);
  const entry = CODE_ACCOUNT_SCHEMA.properties.entries;
  assert.deepEqual([entry.maxItems, entry.items.required], [30, ['key', 'outcome', 'receipts', 'by', 'finding']]);
  assert.deepEqual(entry.items.properties.outcome.enum, [...CODE_ACCOUNT_OUTCOMES]);
  assert.deepEqual([entry.items.properties.receipts.maxItems, CODE_ACCOUNT_SCHEMA.properties.findings.maxItems], [4, 5]);
  for (const outcome of CODE_ACCOUNT_OUTCOMES) assert.ok(CODE_ACCOUNT_SYSTEM.includes(`"${outcome}"`), outcome);
  assert.match(CODE_ACCOUNT_SYSTEM, /one entry for EVERY item, each once/);
  // No consequence of an outcome is told: code reads only the closed outcome, the keys and the receipts' grounding.
  assert.doesNotMatch(CODE_ACCOUNT_SYSTEM, /footer|coverage|shown to|counted|publish|private/i);
  assert.match(CODE_ACCOUNT_SYSTEM, /Give no rating, score, rank or confidence\.$/);
  // F3b leaves the review's method text alone (its own measured change, later): the review agent's brief and contract
  // are D110's, byte for byte. D114 (0.3.0-beta.5) moved its brief by the listed asks alone: rendered back
  // (`requestBeforeListedAsks`), D110's.
  assert.equal(sha(CODE_REVIEW_SYSTEM), 'ec27cbc9d64bafbaace4f51a422642f6c0d7a3c58d2e3dd12da651bf9acd52de');
  assert.equal(sha(requestBeforeListedAsks({ system: CODE_REVIEW_SYSTEM }).system),
    '90ee94101097ea841108ba4a4049c09ea46b0ef1d2daf46052d67cd65a222fb1');
  assert.equal(sha(JSON.stringify(CODE_REVIEW_SCHEMA)),
    '11eb71fd8a59b8e9f089ea6d437cb5de4b962e191ef8c01a622b4221c1f2751f');
  assert.doesNotMatch(CODE_REVIEW_SYSTEM, /account/i);
});

test('D111 (I8): the contract\'s largest answer for a full batch, computed from its maxima, is at most half the output ceiling', () => {
  // The most characters a JSON value of `schema` can take, every string and list at its maximum (a string at its quotes
  // and its most characters; a number at 16; keys and punctuation as written). A schema with an unbounded string or list
  // has no maximum: the test fails on it.
  const most = (schema) => {
    const types = [schema.type].flat();
    if (schema.enum) return Math.max(...schema.enum.map((v) => JSON.stringify(v).length));
    const alts = types.map((type) => {
      if (type === 'null') return 4;
      if (type === 'integer' || type === 'number') return 16;
      if (type === 'boolean') return 5;
      if (type === 'string') {
        assert.ok(Number.isSafeInteger(schema.maxLength), `unbounded string ${JSON.stringify(schema)}`);
        return 2 + schema.maxLength;
      }
      if (type === 'array') {
        assert.ok(Number.isSafeInteger(schema.maxItems), `unbounded list ${JSON.stringify(schema)}`);
        return 2 + schema.maxItems * (most(schema.items) + 1);
      }
      if (type === 'object') return 2 + Object.entries(schema.properties).reduce((n, [key, value]) =>
        n + JSON.stringify(key).length + 1 + most(value) + 1, 0);
      throw new Error(`type ${type}`);
    });
    return Math.max(...alts);
  };
  const chars = most(CODE_ACCOUNT_SCHEMA);
  // Characters as bytes, at the rate Sonah sizes every request by (windows.js TOKEN_BYTES): the global rewrite's estimate
  // of about 126 KB and 40,000 tokens, now computed. Under half the CLI's ceiling, so a full answer is never cut there.
  const tokens = chars / TOKEN_BYTES;
  assert.ok(tokens <= CODE_ACCOUNT_LIMITS.outputTokens / 2, `${chars} characters, about ${Math.round(tokens)} tokens`);
  assert.ok(chars > 100_000 && chars < 140_000, `${chars}: the global rewrite's estimate, about 126 KB`);
});

// ---- the order and the batches (I8) ------------------------------------------------------------------------------------

test('D111 (I8): the items in scope are the asks, then the statements written into a file, then the decisions not to act, in batches of at most 30, at most 4 a review; each item in one batch or past the cap', async () => {
  const f = setup();
  const dossier = codeDossier({ report: f.report, session: f.session });
  assert.deepEqual(accountScopeOf(dossier).map(({ item, scope }) => [item.key, scope]),
    [[ASK1, 'ask'], [ASK2, 'ask'], [WRITTEN, 'written_claim'], [NOT_ACTING, 'not_acting']]);
  // 130 asks and 1 statement and 1 decision not to act: 120 sent in 4 batches of 30, the rest past the cap.
  const seen = [];
  const result = await run(agents({ seen }), { report: reportOf({ asks: 130 }) });
  const sent = seen.filter((r) => r.label.startsWith('code-account:'));
  assert.deepEqual(labels(sent), ['code-account:1', 'code-account:2', 'code-account:3', 'code-account:4']);
  const shown = sent.map((r) => accountItemsShown(r.prompt).map((i) => i.key));
  assert.deepEqual(shown.map((keys) => keys.length), [30, 30, 30, 30]);
  assert.equal(new Set(shown.flat()).size, 120, 'each item in one batch');
  assert.deepEqual(shown.flat(), result.codePass.account.entries.slice(0, 120).map((e) => e.key), 'your asks first');
  const over = result.codePass.account.entries.slice(120);
  assert.deepEqual(over.map((e) => [e.scope, e.fate, e.cause]), [...Array.from({ length: 10 }, () =>
    ['ask', 'missing', 'over_review_limit']), ['written_claim', 'missing', 'over_review_limit'],
  ['not_acting', 'missing', 'over_review_limit']]);
  assert.deepEqual(result.codePass.account.batches.map((b) => [b.n, b.keys.length, b.state]),
    [[1, 30, 'ok'], [2, 30, 'ok'], [3, 30, 'ok'], [4, 30, 'ok']]);
  // The cap hides nothing: the footer counts those past it, by scope.
  assert.deepEqual(result.codePass.footer, [{ kind: 'unaccounted', scope: 'ask', count: 10 },
    { kind: 'unaccounted', scope: 'written_claim', count: 1 }, { kind: 'unaccounted', scope: 'not_acting', count: 1 }]);
  assert.equal(result.codePass.calls.account, 4);
  // A batch request puts the shared part first: the requests differ only after the change and the review's items.
  const prefix = (r) => r.prompt.split('# The items to account for')[0];
  assert.ok(sent.every((r) => prefix(r) === prefix(sent[0])), 'one shared prefix');
});

test('D111: a review with no item in scope sends no accounting call and records an empty accounting', async () => {
  const seen = [];
  const result = await run(agents({ seen }), { report: { ...reportOf({ asks: 0, written: 0 }), decisions: [] } });
  assert.deepEqual(labels(seen), ['code-review:agent']);
  assert.deepEqual(result.codePass.account, { batches: [], entries: [], reviewCoverage: 'complete' });
  assert.equal(result.codePass.coverage, 'complete');
});

// ---- I1, I2: one fate each, grounded or not counted --------------------------------------------------------------------

test('D111 (I1, I2): every item ends with one fate — an entry that gives no receipt for an examined outcome, or one that does not ground, is re-asked once, then missing; a key left out is missing, never re-asked', async () => {
  const seen = [];
  const account = (prompt, request) => {
    const reask = request.label.endsWith(':reask');
    return answerWith((key) => ({
      [ASK1]: { outcome: 'holds', receipts: reask ? [LINE_2] : [NOWHERE] },
      [ASK2]: { outcome: 'outside', receipts: [] },
      [WRITTEN]: { outcome: 'not_examined', receipts: [] },
    })[key] ?? {})(prompt).entries.filter((e) => e.key !== NOT_ACTING)
      .reduce((answer, e) => ({ ...answer, entries: [...answer.entries, e] }), { entries: [], findings: [] });
  };
  const result = await run(agents({ seen, account }));
  const sent = seen.filter((r) => r.label.startsWith('code-account:'));
  assert.deepEqual(labels(sent), ['code-account:1', 'code-account:1:reask']);
  // The re-ask names each void entry with its closed cause; the key left out is named nowhere.
  const note = sent[1].prompt.slice(sent[0].prompt.length);
  assert.match(note, /^- S1: receipt_ungrounded \([^)]*\) at S1 src\/parse\.js:2$/m);
  assert.match(note, /^- S2: shape \(the answer broke its contract\) at entries S2\.receipts$/m);
  assert.doesNotMatch(note, /S4|S5/);
  assert.deepEqual(fates(result), [[ASK1, 'ask', 'holds', null], [ASK2, 'ask', 'missing', 'malformed'],
    [WRITTEN, 'written_claim', 'not_examined', null], [NOT_ACTING, 'not_acting', 'missing', 'not_returned']]);
  // The entry mended by the re-ask is recorded with its grounded receipt, as code stored it.
  const [mended] = result.codePass.account.entries;
  assert.deepEqual([mended.reasked, mended.receipts[0].quote, mended.receipts[0].span.includes(PARSE_QUOTE)],
    [true, PARSE_QUOTE, true]);
  assert.equal(result.codePass.calls.accountRepeat, 1);
  assert.equal(result.codePass.coverage, 'partial');
  // Still ungrounded after the re-ask: missing, `evidence_grounding_failed`.
  const stuck = await run(agents({ account: answerWith((key) => (key === ASK1 ? { receipts: [NOWHERE] } : {})) }));
  assert.deepEqual(fates(stuck)[0], [ASK1, 'ask', 'missing', 'evidence_grounding_failed']);
  // I1 is checked on every review: a lost, repeated or out-of-list entry throws.
  const scope = [ASK1, ASK2].map((key) => ({ item: { key }, scope: 'ask' }));
  const ok = [{ key: ASK1, fate: 'holds' }, { key: ASK2, fate: 'missing', cause: 'not_returned' }];
  assert.equal(checkedAccount(ok, scope), ok);
  for (const broken of [[ok[0]], [ok[0], ok[0]], [ok[0], { ...ok[1], cause: 'lost' }], [ok[0], { ...ok[1], fate: 'gone' }],
    [{ ...ok[0], cause: 'not_returned' }, ok[1]], [{ ...ok[0], cause: 'lost' }, ok[1]], [ok[1], ok[0]]])
    assert.throws(() => checkedAccount(broken, scope), /code_pass_account_unconserved/);
});

test('D111 (I1): over generated answers — entries left out, repeated, out of their shape, ungrounded, examined, not examined — every item ends with exactly one fate of the closed list', async () => {
  let seed = 7;
  const next = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const shapes = [
    () => null,
    (key) => [{ key, outcome: 'holds', receipts: [LINE_2], by: null, finding: null },
      { key, outcome: 'holds', receipts: [LINE_2], by: null, finding: null }],
    (key) => [{ key, outcome: 'holds', receipts: [NOWHERE], by: null, finding: null }],
    (key) => [{ key, outcome: 'maybe', receipts: [], by: null, finding: null }],
    (key) => [{ key, outcome: 'outside', receipts: [LINE_2], by: null, finding: null }],
    (key) => [{ key, outcome: 'not_examined', receipts: [], by: null, finding: null }],
    (key) => [{ key, outcome: 'breaks', receipts: [LINE_2], by: null, finding: null }],
    (key) => [{ key, outcome: 'holds', receipts: [LINE_2], by: 'F9', finding: null }],
  ];
  for (let round = 0; round < 40; round++) {
    const asks = 1 + next(6), written = next(3);
    const account = (prompt) => ({ entries: accountItemsShown(prompt).flatMap(({ key }) => shapes[next(shapes.length)](key)
      ?? []), findings: [] });
    const result = await run(agents({ account }), { report: reportOf({ asks, written }) });
    const entries = result.codePass.account.entries;
    assert.equal(entries.length, asks + written + 1, `round ${round}`);
    for (const e of entries) {
      assert.ok(CODE_ACCOUNT_FATES.includes(e.fate), e.fate);
      assert.equal(e.fate === 'missing', CODE_ACCOUNT_MISSING.includes(e.cause), JSON.stringify(e));
      if (CODE_ACCOUNT_OUTCOMES.slice(0, 3).includes(e.fate))
        assert.ok(e.receipts.length > 0 && e.receipts.every((r) => r.span.includes(r.quote)), 'examined, grounded');
    }
    const unaccounted = entries.filter((e) => ['not_examined', 'missing'].includes(e.fate)).length;
    assert.equal(result.codePass.coverage === 'partial', unaccounted > 0, `round ${round}: I10`);
  }
});

// ---- I3, I6: the joins and the accounting's own findings -----------------------------------------------------------------

test('D111 (I3): a `breaks` entry names a finding or question of the code review, or carries a finding that goes to its checker; with neither it is missing, and code never turns it into an item', async () => {
  const question = { question: 'SYNTHETIC should an empty input throw?', key: ASK1, quote: 'add a parse function' };
  const own = reviewFinding({ kind: 'ask_not_met', lens: 'ask', title: 'SYNTHETIC the empty case is not handled',
    leadsFrom: [ASK2] });
  const seen = [];
  const result = await run(agents({ seen, findings: [reviewFinding()], questions: [question],
    account: answerWith((key) => ({ [ASK1]: { outcome: 'breaks', by: 'Q1' }, [ASK2]: { outcome: 'breaks', finding: 0 },
      [WRITTEN]: { outcome: 'breaks' }, [NOT_ACTING]: { outcome: 'breaks', by: 'F1' } })[key], [own]) }));
  // The accounting's finding faces its checker like any finding, numbered after the review's.
  assert.ok(labels(seen).includes('code-verify:F2'));
  assert.deepEqual(result.codePass.findings.map((f) => f.title).sort(), [own.title, reviewFinding().title].sort());
  const e = Object.fromEntries(result.codePass.account.entries.map((x) => [x.key, x]));
  assert.deepEqual([e[ASK1].fate, e[ASK1].by, e[ASK2].fate, e[ASK2].finding, e[NOT_ACTING].fate, e[NOT_ACTING].by],
    ['breaks', 'Q1', 'breaks', 0, 'breaks', 'F1']);
  assert.deepEqual([e[WRITTEN].fate, e[WRITTEN].cause, e[WRITTEN].outcome], ['missing', 'unreported', 'breaks']);
  // Code turned no entry into a question.
  assert.deepEqual(result.codePass.questions.map((q) => q.question), [question.question]);
  // A `by` that names no finding or question the request listed is out of the entry's shape.
  const unknown = await run(agents({ account: answerWith((key) => (key === ASK1 ? { outcome: 'breaks', by: 'F7' } : {})) }));
  assert.deepEqual(fates(unknown)[0], [ASK1, 'ask', 'missing', 'malformed']);
  // `by` or `finding` on an outcome that is not `breaks` is too.
  const stray = await run(agents({ findings: [reviewFinding()],
    account: answerWith((key) => (key === ASK1 ? { outcome: 'holds', by: 'F1' } : {})) }));
  assert.deepEqual(fates(stray)[0], [ASK1, 'ask', 'missing', 'malformed']);
});

test('D111 (I3): a `holds` entry for an item a published finding follows from is voided (`inconsistent`); the finding stands as its check left it', async () => {
  const breaksAsk = reviewFinding({ kind: 'ask_not_met', lens: 'ask', leadsFrom: [ASK1] });
  const result = await run(agents({ findings: [breaksAsk] }));
  assert.deepEqual(result.codePass.findings.map((f) => f.title), [breaksAsk.title]);
  const [ask] = result.codePass.account.entries;
  assert.deepEqual([ask.fate, ask.cause, ask.outcome], ['missing', 'inconsistent', 'holds']);
  // A finding its check refuted is published nowhere: the entry stands.
  const refuted = await run(agents({ findings: [breaksAsk], verify: () => ({ verdict: 'refuted', reason: 'incorrect',
    claims: [{ claim: 1, verdict: 'false' }], premises: [{ premise: 'SYNTHETIC.', source: 'repository', receipts: [LINE_2] }],
    receipts: [LINE_2], explanation: 'SYNTHETIC.' }) }));
  assert.deepEqual([refuted.codePass.findings, refuted.codePass.account.entries[0].fate], [[], 'holds']);
});

test('D111 (I3, I7): no accounting entry changes a finding\'s or a question\'s fate — with every accounting call failed, the review\'s items end as they do with it answered', async () => {
  const question = { question: 'SYNTHETIC should an empty input throw?', key: ASK1, quote: 'add a parse function' };
  const findings = [reviewFinding(), reviewFinding({ title: 'SYNTHETIC refuted', trace: [{ step: 'SYNTHETIC.',
    path: 'src/parse.js', side: 'new', startLine: 1, endLine: 1, quote: 'export function parse(input) {' }],
  anchor: { path: 'src/parse.js', side: 'new', startLine: 1, endLine: 1 } })];
  const verify = (f) => (f.title === 'SYNTHETIC refuted' ? { verdict: 'refuted', reason: 'incorrect',
    claims: f.claims.map(({ claim }) => ({ claim, verdict: 'false' })), premises: [{ premise: 'SYNTHETIC.',
      source: 'repository', receipts: [LINE_2] }], receipts: [LINE_2], explanation: 'SYNTHETIC.' } : holds(f));
  const items = ({ codePass: p }) => ({ findings: p.findings, unconfirmed: p.unconfirmed, questions: p.questions,
    withheld: p.withheld, fates: p.fates, triage: p.triage });
  const seenOk = [], seenFailed = [];
  const answered = await run(agents({ findings, questions: [question], verify, seen: seenOk,
    account: answerWith(() => ({ outcome: 'breaks', by: 'F2' })) }));
  const failed = await run(agents({ findings, questions: [question], verify, seen: seenFailed,
    account: () => { throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' }); } }));
  assert.deepEqual(items(failed), items(answered));
  // The review's request and its checks' are byte for byte the same either way.
  const notAccount = (seen) => seen.filter((r) => !r.label.startsWith('code-account:'))
    .map((r) => JSON.stringify([r.label, r.system, r.prompt, r.schema]));
  assert.deepEqual(notAccount(seenFailed), notAccount(seenOk));
  // Only what was not accounted for moved: every item missing, the call named as one that did not answer.
  assert.deepEqual(failed.codePass.account.entries.map((e) => [e.fate, e.cause]), Array.from({ length: 4 },
    () => ['missing', 'batch_failed']));
  assert.deepEqual(failed.codePass.footer, [{ kind: 'failed', part: 'account', count: 1 },
    { kind: 'unaccounted', scope: 'ask', count: 2 }, { kind: 'unaccounted', scope: 'written_claim', count: 1 },
    { kind: 'unaccounted', scope: 'not_acting', count: 1 }]);
});

test('D111 (I7): a batch too large to send is not sent, and is never a call that did not answer — its items are missing `too_large`, the footer names it so, and the review\'s items are untouched', async () => {
  // Twenty long questions: the accounting's request lists them, the review's request does not.
  const questions = Array.from({ length: 20 }, (_, i) => ({ question: `SYNTHETIC question ${i + 1}: `.padEnd(990, 'q'),
    key: ASK1, quote: 'add a parse function' }));
  const seen = [];
  await run(agents({ questions, seen }));
  const review = seen.find((r) => r.label === 'code-review:agent');
  const account = seen.find((r) => r.label === 'code-account:1');
  assert.ok(reviewInputBytes(account) > reviewInputBytes(review));
  const atBound = [];
  const large = await run(agents({ questions, seen: atBound }), { bound: reviewInputBytes(review) });
  assert.ok(!labels(atBound).some((l) => l.startsWith('code-account:')), 'not sent');
  assert.deepEqual([large.codePass.calls.account, large.codePass.account.batches[0].state], [0, 'too_large']);
  assert.deepEqual(large.codePass.account.entries.map((e) => e.cause), Array(4).fill('too_large'));
  assert.ok(large.codePass.footer.some((e) => e.kind === 'too_large' && e.part === 'account'));
  assert.ok(!large.codePass.footer.some((e) => e.kind === 'failed' && e.part === 'account'));
  assert.equal(large.codePass.questions.length, 20, 'no question lost');
});

test('D111 (I5, I6): every finding of the review, its repair and the accounting has one fate; an accounting finding of one identity with one that stands is folded into it and checked by no one; one that fails is withheld with no repair asked', async () => {
  const same = reviewFinding({ title: 'SYNTHETIC the same problem, in other words' });
  const broken = reviewFinding({ title: 'SYNTHETIC a quote on no line', trace: [{ step: 'SYNTHETIC.', path: 'src/parse.js',
    side: 'new', startLine: 3, endLine: 3, quote: NOWHERE.quote }],
  anchor: { path: 'src/parse.js', side: 'new', startLine: 3, endLine: 3 } });
  const fresh = reviewFinding({ title: 'SYNTHETIC a new place', trace: [{ step: 'SYNTHETIC.', path: 'src/parse.js',
    side: 'new', startLine: 3, endLine: 3, quote: 'return parts.map((part) => part.trim());' }],
  anchor: { path: 'src/parse.js', side: 'new', startLine: 3, endLine: 3 } });
  const seen = [];
  const result = await run(agents({ seen, findings: [reviewFinding()],
    account: answerWith((key) => ({ [ASK1]: { outcome: 'breaks', finding: 0 }, [ASK2]: { outcome: 'breaks', finding: 1 },
      [WRITTEN]: { outcome: 'breaks', finding: 2 } })[key] ?? {}, [same, broken, fresh]) }));
  const p = result.codePass;
  const account = p.fates.filter((r) => r.from === 'account');
  assert.deepEqual(account.map((r) => [r.index, r.fate]), [[0, 'folded'], [1, 'withheld'], [2, 'added']]);
  assert.deepEqual(account[0].into, [{ from: 'answer', index: 0 }]);
  assert.ok(account.every((r) => CODE_REPAIR_FATES.includes(r.fate)));
  // The folded one is checked by no one; the added one by its own checker.
  assert.deepEqual(labels(seen).filter((l) => l.startsWith('code-verify:F')), ['code-verify:F1', 'code-verify:F2']);
  assert.deepEqual(p.findings.map((f) => f.title), [reviewFinding().title, fresh.title]);
  // The withheld one says that no repair was asked for it, never that one failed.
  const withheld = p.withheld.find((w) => w.text === broken.title);
  assert.deepEqual([withheld.reason, withheld.cause, withheld.repair], ['evidence_grounding_failed', 'quote_ungrounded',
    'accounted']);
  assert.equal(CODE_REPORT_WORDS.unrepaired.accounted, 'Sonah did not ask for its repair, because it came with the code '
    + 'review\'s item-by-item check of the session review\'s asks, of the statements that the agent wrote into a file and '
    + 'of the agent\'s decisions not to act');
  // The entries' joins: a folded finding stands in the one it is folded into; a withheld one leaves its entry unreported.
  assert.deepEqual(fates(result).slice(0, 3), [[ASK1, 'ask', 'breaks', null], [ASK2, 'ask', 'missing', 'unreported'],
    [WRITTEN, 'written_claim', 'breaks', null]]);
  // Past its list's limit an accounting finding is unchecked: withheld `unasked`, or folded where it matches.
  const six = Array.from({ length: 6 }, (_, i) => reviewFinding({ title: `SYNTHETIC ${i}`, trace: [{ step: 'SYNTHETIC.',
    path: 'src/parse.js', side: 'new', startLine: 1 + (i % 3), endLine: 1 + (i % 3),
    quote: CODE_FILES['src/parse.js'].split('\n')[i % 3].trim() }],
  anchor: { path: 'src/parse.js', side: 'new', startLine: 1 + (i % 3), endLine: 1 + (i % 3) }, kind: ['bug',
    'missed_case', 'weak_test', 'contract_break', 'rule_break', 'bug'][i] }));
  const over = await run(agents({ account: (prompt) => ({ ...ALL_HOLD(prompt), findings: six }) }));
  const last = over.codePass.fates.filter((r) => r.from === 'account').at(-1);
  assert.equal(last.index, 5);
  assert.ok(last.fate === 'folded' || (last.fate === 'withheld'
    && over.codePass.withheld.find((w) => w.text === 'SYNTHETIC 5').repair === 'unasked'), JSON.stringify(last));
});

// ---- I9, I10: what the reader sees -------------------------------------------------------------------------------------

test('D111 (I9, I10): the page and the report .md show only the counts of items not examined or missing, by kind; the words, receipts and outcomes of examined entries change no byte, and no line says what was examined', async () => {
  const f = setup();
  const render = (result) => {
    const joined = withCodePass(f.report, result);
    return [renderSessionPage(f.session, joined), renderReportMarkdown(f.session, joined)];
  };
  const mixed = (outcomeOf) => run(agents({ account: answerWith((key) => (key === WRITTEN ? { outcome: 'not_examined',
    receipts: [] } : { outcome: outcomeOf(key) })) }));
  const holdsAll = await mixed(() => 'holds');
  const outsideAll = await mixed(() => 'outside');
  assert.deepEqual(render(outsideAll), render(holdsAll), 'an examined outcome renders no byte');
  // Other receipts on the examined entries: no byte moves.
  const other = await run(agents({ account: answerWith((key) => (key === WRITTEN ? { outcome: 'not_examined',
    receipts: [] } : { receipts: [{ path: 'src/parse.js', side: 'new', startLine: 1, endLine: 1,
    quote: 'export function parse(input) {' }] })) }));
  assert.deepEqual(render(other), render(holdsAll));
  // The one count shows, in its fixed words, and the coverage is partial.
  const [page, md] = render(holdsAll);
  const line = CODE_REPORT_WORDS.unaccounted.written_claim(1);
  assert.equal(line, '1 statement that the agent wrote into a file, which the code review\'s item-by-item check did not '
    + 'examine in a way that Sonah could use');
  assert.ok(page.includes(escapeHtml(line)) && md.includes(line), 'the count on both readers');
  assert.equal(holdsAll.codePass.coverage, 'partial');
  assert.deepEqual(codeFooterLines({ codePass: holdsAll.codePass }).filter((l) => /item-by-item check/.test(l)), [line]);
  // Every item examined: no line of the accounting at all, and the coverage complete.
  const examined = await run(agents());
  assert.equal(examined.codePass.coverage, 'complete');
  const [page2, md2] = render(examined);
  for (const text of [page2, md2]) {
    assert.doesNotMatch(text, /item-by-item check/);
    assert.doesNotMatch(text, /examined|accounted for/i, 'no positive line');
  }
  // The counts by kind, in CODE_ACCOUNT_SCOPE's order, each its own line.
  const none = await run(agents({ account: answerWith(() => ({ outcome: 'not_examined', receipts: [] })) }));
  // D111 amended: the asks rest on your own words (the fixture's root instruction recorded with human authority), so
  // with the session they are yours; with no session Sonah cannot read whose words they are, and never calls them yours.
  assert.deepEqual(codeFooterLines({ ...reportOf(), codePass: none.codePass }, { session: codeSession() }),
    [CODE_REPORT_WORDS.unaccounted.ask.person(2), CODE_REPORT_WORDS.unaccounted.written_claim(1),
      CODE_REPORT_WORDS.unaccounted.not_acting(1)]);
  assert.deepEqual(codeFooterLines({ codePass: none.codePass }), [CODE_REPORT_WORDS.unaccounted.ask.other(2),
    CODE_REPORT_WORDS.unaccounted.written_claim(1), CODE_REPORT_WORDS.unaccounted.not_acting(1)]);
  // A report before the accounting (no `unaccounted` footer entry) shows no such line.
  const { account: _a, ...before } = none.codePass;
  assert.deepEqual(codeFooterLines({ codePass: { ...before, footer: [] } }), []);
});

test('D111 (I11): the session run profile binds the accounting\'s version, closed lists and bounds', () => {
  assert.deepEqual(CODE_PASS_PROFILE.account, { version: CODE_ACCOUNT_VERSION, scope: CODE_ACCOUNT_SCOPE,
    outcomes: CODE_ACCOUNT_OUTCOMES, fates: CODE_ACCOUNT_FATES, missing: CODE_ACCOUNT_MISSING, limits: CODE_ACCOUNT_LIMITS });
  assert.ok(CODE_PASS_PROFILE.parts.includes('account') && CODE_PASS_PROFILE.footer.includes('unaccounted'));
  assert.ok(CODE_PASS_PROFILE.repairMerge.sources.includes('account'));
  assert.deepEqual(CODE_PASS_PROFILE.agents.account, CODE_AGENT_LIMITS.account);
});

// ---- D111's review: each guard of the rule pinned by a test that fails without it ---------------------------------------

/** The accounting requests among `seen`, and the note a re-ask added to its batch's first request. */
const accountSent = (seen) => seen.filter((r) => r.label.startsWith('code-account:'));
const reaskNoteOf = (seen, n = 1) => {
  const first = seen.find((r) => r.label === `code-account:${n}`);
  const again = seen.find((r) => r.label === `code-account:${n}:reask`);
  return again ? again.prompt.slice(first.prompt.length) : null;
};
/** One entry of S1 from `entry`, the other items holding (`answerWith`), and `findings` of the answer's own. */
const askOne = (entry, findings = []) => answerWith((key) => (key === ASK1 ? entry : {}), findings);

test('D111 review (I2): an entry counts as examined only when every receipt grounds — a later receipt that does not ground voids it as a first one does', async () => {
  const seen = [];
  const result = await run(agents({ seen, account: askOne({ receipts: [LINE_2, NOWHERE] }) }));
  assert.deepEqual(labels(accountSent(seen)), ['code-account:1', 'code-account:1:reask']);
  assert.match(reaskNoteOf(seen), /^- S1: receipt_ungrounded \([^)]*\) at S1 src\/parse\.js:2$/m);
  assert.deepEqual(fates(result)[0], [ASK1, 'ask', 'missing', 'evidence_grounding_failed']);
  // Every receipt grounded: examined, each stored grounded.
  const both = await run(agents({ account: askOne({ receipts: [LINE_2, LINE_2] }) }));
  assert.deepEqual([fates(both)[0], both.codePass.account.entries[0].receipts.length], [[ASK1, 'ask', 'holds', null], 2]);
});

test('D111 review (I1): two entries for one key void it (`shape`); the re-ask names it; still twice, it is missing `malformed`, once again, it counts', async () => {
  const twice = (prompt) => {
    const answer = ALL_HOLD(prompt);
    return { ...answer, entries: [...answer.entries, answer.entries[0]] };
  };
  const seen = [];
  const result = await run(agents({ seen, account: twice }));
  assert.match(reaskNoteOf(seen), /^- S1: shape \(the answer broke its contract\) at entries S1$/m);
  assert.deepEqual(fates(result)[0], [ASK1, 'ask', 'missing', 'malformed']);
  assert.equal(result.codePass.account.entries[0].reasked, true);
  const mended = await run(agents({ account: (prompt, request) => (request.label.endsWith(':reask') ? ALL_HOLD(prompt)
    : twice(prompt)) }));
  assert.deepEqual(fates(mended)[0], [ASK1, 'ask', 'holds', null]);
});

test('D111 review (I1, I2): an entry out of its closed shape is missing `malformed`, named in the re-ask by where it breaks — not_examined with a receipt, more than 4 receipts, a path over 300 characters, a `finding` on an outcome that is not breaks', async () => {
  const long = { ...LINE_2, path: `${'a/'.repeat(150)}b.js` };
  assert.ok(long.path.length > CODE_ACCOUNT_LIMITS.pathChars);
  const cases = [
    [{ outcome: 'not_examined', receipts: [LINE_2] }, 'entries S1.receipts', []],
    [{ receipts: Array(CODE_ACCOUNT_LIMITS.receipts + 1).fill(LINE_2) }, 'entries S1.receipts', []],
    // Over the path bound: out of its shape, never a receipt that does not ground (which it would be without the bound).
    [{ receipts: [long] }, 'entries S1.receipts[0].path', []],
    [{ outcome: 'holds', finding: 0 }, 'entries S1.finding', [reviewFinding()]],
    [{ outcome: 'outside', finding: 0 }, 'entries S1.finding', [reviewFinding()]],
  ];
  for (const [entry, at, findings] of cases) {
    const seen = [];
    const result = await run(agents({ seen, account: askOne(entry, findings) }));
    const why = JSON.stringify(entry).slice(0, 80);
    assert.equal(reaskNoteOf(seen).split('\n').find((l) => l.startsWith('- S1:')),
      `- S1: shape (the answer broke its contract) at ${at}`, why);
    assert.deepEqual(fates(result)[0], [ASK1, 'ask', 'missing', 'malformed'], why);
  }
  // Exactly 4 grounded receipts, and a path of 300 characters that grounds nowhere: in their shape.
  const four = await run(agents({ account: askOne({ receipts: Array(CODE_ACCOUNT_LIMITS.receipts).fill(LINE_2) }) }));
  assert.deepEqual(fates(four)[0], [ASK1, 'ask', 'holds', null]);
  const atBound = { ...LINE_2, path: long.path.slice(long.path.length - CODE_ACCOUNT_LIMITS.pathChars) };
  const bounded = await run(agents({ account: askOne({ receipts: [atBound] }) }));
  assert.deepEqual(fates(bounded)[0], [ASK1, 'ask', 'missing', 'evidence_grounding_failed']);
});

test('D111 review: an answer that could not be read — no `entries` list, or no `findings` list — is re-asked whole, and the re-ask\'s entries count', async () => {
  for (const unreadable of [{ entries: 'none', findings: [] }, null]) {
    const seen = [];
    const account = (prompt, request) => {
      if (request.label.endsWith(':reask')) return ALL_HOLD(prompt);
      // No findings list: every entry is in its shape, but the answer is out of its contract.
      return unreadable ?? { entries: ALL_HOLD(prompt).entries };
    };
    const result = await run(agents({ seen, account }));
    const why = JSON.stringify(unreadable);
    assert.deepEqual(labels(accountSent(seen)), ['code-account:1', 'code-account:1:reask'], why);
    assert.match(reaskNoteOf(seen), /your answer:\n- shape \(the answer broke its contract\) at answer\n/, why);
    assert.deepEqual(fates(result).map(([, , fate]) => fate), ['holds', 'holds', 'holds', 'holds'], why);
    assert.deepEqual(result.codePass.account.batches, [{ n: 1, keys: [ASK1, ASK2, WRITTEN, NOT_ACTING], state: 'ok',
      answers: 1 }], why);
    assert.equal(result.codePass.coverage, 'complete', why);
    // The re-ask was sent for every key: each entry says so, as an entry its batch's re-ask mended does.
    assert.ok(result.codePass.account.entries.every((e) => e.reasked === true), why);
  }
  // An entry the whole re-ask leaves out is missing after it.
  const out = await run(agents({ account: (prompt, request) => (request.label.endsWith(':reask')
    ? { ...ALL_HOLD(prompt), entries: ALL_HOLD(prompt).entries.slice(1) } : { entries: 'none', findings: [] }) }));
  assert.deepEqual(out.codePass.account.entries[0], { ...out.codePass.account.entries[0], fate: 'missing',
    cause: 'not_returned', reasked: true });
});

test('D111 review: an answer that could not be read whose whole re-ask is too large to send — its call is named as one that did not answer, the re-ask as one Sonah did not make, and its items are missing `batch_failed`', async () => {
  // Twenty long questions: the accounting's request lists them, the review's request does not; the bound admits the
  // accounting's request and not its re-ask, which adds a note.
  const questions = Array.from({ length: 20 }, (_, i) => ({ question: `SYNTHETIC question ${i + 1}: `.padEnd(990, 'q'),
    key: ASK1, quote: 'add a parse function' }));
  const seen = [];
  await run(agents({ questions, seen }));
  const bound = reviewInputBytes(seen.find((r) => r.label === 'code-account:1'));
  assert.ok(bound > reviewInputBytes(seen.find((r) => r.label === 'code-review:agent')));
  const atBound = [];
  const result = await run(agents({ questions, seen: atBound, account: () => ({ entries: 'none', findings: [] }) }),
    { bound });
  assert.deepEqual(labels(accountSent(atBound)), ['code-account:1'], 'the re-ask is not sent');
  assert.deepEqual(result.codePass.account.batches.map((b) => b.state), ['failed']);
  assert.deepEqual(result.codePass.account.entries.map((e) => e.cause), Array(4).fill('batch_failed'));
  assert.deepEqual(result.codePass.footer.filter((e) => e.part === 'account'), [{ kind: 'failed', part: 'account',
    count: 1 }, { kind: 'too_large', part: 'account', count: 1 }]);
  assert.deepEqual([result.codePass.calls.account, result.codePass.calls.accountRepeat], [1, 0]);
});

test('D111 review: when the re-ask does not answer, its call is named as one that did not answer, and the void entries stay missing', async () => {
  const account = (prompt, request) => {
    if (request.label.endsWith(':reask')) throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' });
    return askOne({ receipts: [NOWHERE] })(prompt);
  };
  const result = await run(agents({ account }));
  assert.deepEqual(result.codePass.account.entries[0], { ...result.codePass.account.entries[0], fate: 'missing',
    cause: 'evidence_grounding_failed', reasked: true });
  assert.deepEqual(fates(result).slice(1).map(([, , fate]) => fate), ['holds', 'holds', 'holds']);
  assert.deepEqual(result.codePass.footer.filter((e) => e.part === 'account'), [{ kind: 'failed', part: 'account',
    count: 1 }]);
  assert.deepEqual([result.codePass.calls.account, result.codePass.calls.accountRepeat], [1, 1]);
});

test('D111 review (I3, judgment call 5): a `holds` entry for an item that a finding to verify follows from is voided too (`inconsistent`); the finding stays one to verify', async () => {
  const breaksAsk = reviewFinding({ kind: 'ask_not_met', lens: 'ask', leadsFrom: [ASK1] });
  const outside = (f) => holdsWith(f, [{ premise: 'SYNTHETIC: rests on what no file shows.', source: 'outside',
    receipts: [] }]);
  const result = await run(agents({ findings: [breaksAsk], verify: outside }));
  assert.deepEqual([result.codePass.findings, result.codePass.unconfirmed.map((f) => f.title)], [[], [breaksAsk.title]]);
  const [ask] = result.codePass.account.entries;
  assert.deepEqual([ask.fate, ask.cause, ask.outcome], ['missing', 'inconsistent', 'holds']);
});

test('D111 review (I5, I6): the accounting\'s findings are numbered across every answer of every batch; a later one of one identity with an earlier one that stands folds into it and is checked by no one', async () => {
  const at = (line, over = {}) => reviewFinding({ title: `SYNTHETIC line ${line}`, trace: [{ step: 'SYNTHETIC.',
    path: 'src/parse.js', side: 'new', startLine: line, endLine: line,
    quote: CODE_FILES['src/parse.js'].split('\n')[line - 1].trim() }],
  anchor: { path: 'src/parse.js', side: 'new', startLine: line, endLine: line }, ...over });
  // 31 asks: two batches. The first carries a finding on line 3, the second one on line 1 and, in other words, the one
  // on line 3 again.
  const seen = [];
  const account = (prompt, request) => {
    const n = Number(/^code-account:(\d+)/.exec(request.label)[1]);
    const findings = n === 1 ? [at(3)] : [at(1), at(3, { title: 'SYNTHETIC line 3, in other words' })];
    return answerWith((key, k) => (k === 0 ? { outcome: 'breaks', finding: 0 } : {}), findings)(prompt);
  };
  const result = await run(agents({ seen, account }), { report: reportOf({ asks: 31 }) });
  const p = result.codePass;
  assert.deepEqual(p.fates.filter((r) => r.from === 'account').map((r) => [r.index, r.fate, r.into ?? null]),
    [[0, 'added', null], [1, 'added', null], [2, 'folded', [{ from: 'account', index: 0 }]]]);
  // One checker each for the two that stand, numbered after the review's (none here).
  assert.deepEqual(labels(seen).filter((l) => l.startsWith('code-verify:F')), ['code-verify:F1', 'code-verify:F2']);
  assert.deepEqual(p.findings.map((f) => f.title), ['SYNTHETIC line 3', 'SYNTHETIC line 1']);
  // Each batch's first entry names its answer's first finding by its index across answers.
  const byKey = Object.fromEntries(p.account.entries.map((e) => [e.key, e]));
  const first2 = accountItemsShown(seen.find((r) => r.label === 'code-account:2').prompt)[0].key;
  assert.deepEqual([byKey[ASK1].fate, byKey[ASK1].finding, byKey[first2].fate, byKey[first2].finding],
    ['breaks', 0, 'breaks', 1]);
  // A re-ask's findings come after its batch's first answer's.
  const reasked = await run(agents({ account: (prompt, request) => (request.label.endsWith(':reask')
    ? answerWith((key) => (key === ASK1 ? { outcome: 'breaks', finding: 0 } : {}), [at(1)])(prompt)
    : askOne({ outcome: 'breaks', finding: 0, receipts: [NOWHERE] }, [at(3)])(prompt)) }));
  assert.deepEqual(reasked.codePass.fates.filter((r) => r.from === 'account').map((r) => [r.index, r.fate]),
    [[0, 'added'], [1, 'added']]);
  assert.deepEqual([reasked.codePass.account.entries[0].fate, reasked.codePass.account.entries[0].finding], ['breaks', 1]);
});

test('D111 review: the agents\' reading records are in one order — the review, each finding\'s checker, the batch checker and its re-ask, then each accounting batch with its re-ask after it', async () => {
  const question = { question: 'SYNTHETIC should an empty input throw?', key: ASK1, quote: 'add a parse function' };
  const judge = async (request) => {
    const { label } = request;
    if (label === 'code-review:agent') return withRun({ findings: [reviewFinding()], questions: [question] },
      readsEveryFile(request));
    if (/^code-verify:F\d+$/.test(label)) return holds(verifiedFinding(request.prompt));
    // The batch checker's first answer leaves its question out: one re-ask.
    if (label === 'code-verify:batch') return { questions: [] };
    if (label === 'code-verify:batch:reask') return allSound(batchItems(request.prompt));
    if (/^code-account:\d+(:reask)?$/.test(label)) return (label === 'code-account:1'
      ? askOne({ receipts: [NOWHERE] }) : ALL_HOLD)(request.prompt);
    throw new Error(`unexpected ${label}`);
  };
  const result = await run(judge, { report: reportOf({ asks: 31 }) });
  assert.deepEqual(result.codePass.agents.map((a) => a.label), ['code-review:agent', 'code-verify:F1', 'code-verify:batch',
    'code-verify:batch:reask', 'code-account:1', 'code-account:1:reask', 'code-account:2']);
});

test('D111 review: an item counted beside a published finding that follows from it — the footer says only that the item-by-item check did not examine it in a way Sonah could use, never that the code review has no check of it', async () => {
  // One ask; the code review's finding breaks it and is published; the item-by-item check says it holds, so its entry is
  // voided (`inconsistent`) and counted. The finding is a check that Sonah used: no line may say the ask has none.
  const breaksAsk = reviewFinding({ kind: 'ask_not_met', lens: 'ask', leadsFrom: [ASK1] });
  const report = { ...reportOf({ asks: 1, written: 0 }), decisions: [] };
  const f = setup(report);
  const result = await run(agents({ findings: [breaksAsk] }), { report });
  assert.deepEqual(result.codePass.findings.map((x) => x.title), [breaksAsk.title]);
  assert.deepEqual(fates(result), [[ASK1, 'ask', 'missing', 'inconsistent']]);
  const joined = withCodePass(f.report, result);
  const [page, md] = [renderSessionPage(f.session, joined), renderReportMarkdown(f.session, joined)];
  const line = CODE_REPORT_WORDS.unaccounted.ask.person(1);
  // The finding is a Must act item on ask 1, and the count is shown below it.
  assert.ok(md.includes('Must act 1 ·') && md.includes('Where: `src/parse.js:2` · ask 1'), 'the finding, on ask 1');
  assert.ok(page.includes('Must act 1') && page.includes(escapeHtml(line)) && md.includes(line), 'the count is shown');
  // Each count's line names the check whose entries it counts by the name a call of that check takes when it does not
  // answer (CODE_REPORT_WORDS.parts.account): what the counted fates prove, for every fate, and no more.
  const check = CODE_REPORT_WORDS.parts.account.replace(/^its /, '');
  for (const scope of CODE_ACCOUNT_SCOPE) for (const n of [1, 2]) {
    const line = CODE_REPORT_WORDS.unaccounted[scope];
    for (const words of typeof line === 'function' ? [line(n)] : Object.values(line).map((by) => by(n)))
      assert.ok(words.includes(`the code review's ${check} did not examine`), words);
  }
});

test('D111 review (I5): a finding that fails its checks is withheld once — its repeat in a re-ask, in another batch, or of the review\'s own, is folded into it', async () => {
  const bad = reviewFinding({ title: 'SYNTHETIC a quote on no line', trace: [{ step: 'SYNTHETIC.', path: 'src/parse.js',
    side: 'new', startLine: 3, endLine: 3, quote: NOWHERE.quote }],
  anchor: { path: 'src/parse.js', side: 'new', startLine: 3, endLine: 3 } });
  const withheldOnce = (p) => p.withheld.filter((w) => w.text === bad.title).length;
  // The first answer has a void entry, so a re-ask is sent; both answers carry the same finding.
  const reask = await run(agents({ account: (prompt, request) => ({ ...(request.label.endsWith(':reask')
    ? ALL_HOLD(prompt) : askOne({ receipts: [NOWHERE] })(prompt)), findings: [bad] }) }));
  assert.deepEqual(reask.codePass.fates.filter((r) => r.from === 'account').map((r) => [r.index, r.fate, r.into ?? null]),
    [[0, 'withheld', null], [1, 'folded', [{ from: 'account', index: 0 }]]]);
  assert.equal(withheldOnce(reask.codePass), 1);
  // Two batches each carry it.
  const batches = await run(agents({ account: (prompt) => ({ ...ALL_HOLD(prompt), findings: [bad] }) }),
    { report: reportOf({ asks: 31 }) });
  assert.deepEqual(batches.codePass.fates.filter((r) => r.from === 'account').map((r) => [r.fate, r.into ?? null]),
    [['withheld', null], ['folded', [{ from: 'account', index: 0 }]]]);
  assert.equal(withheldOnce(batches.codePass), 1);
  // The review proposed it too (its repair the same): the accounting's copy folds into both, and is withheld no more.
  const review = await run(agents({ findings: [bad], account: (prompt) => ({ ...ALL_HOLD(prompt), findings: [bad] }) }));
  assert.deepEqual(review.codePass.fates.filter((r) => r.from === 'account').map((r) => [r.fate, r.into]),
    [['folded', [{ from: 'answer', index: 0 }, { from: 'repair', index: 0 }]]]);
  assert.equal(withheldOnce(review.codePass), 1);
  // A finding that fails folds by its value only: another that fails at another place is withheld on its own.
  const other = { ...bad, title: 'SYNTHETIC another quote on no line', anchor: { ...bad.anchor, startLine: 1, endLine: 1 },
    trace: [{ ...bad.trace[0], startLine: 1, endLine: 1 }] };
  const two = await run(agents({ account: (prompt) => ({ ...ALL_HOLD(prompt), findings: [bad, other] }) }));
  assert.deepEqual(two.codePass.fates.filter((r) => r.from === 'account').map((r) => r.fate), ['withheld', 'withheld']);
});

test('D111 review (I5): the run counts the accounting\'s findings from its answers, never from the fate records — a finding that got no record throws, so no report is written that lost it', async () => {
  const fresh = (line) => reviewFinding({ title: `SYNTHETIC line ${line}`, trace: [{ step: 'SYNTHETIC.',
    path: 'src/parse.js', side: 'new', startLine: line, endLine: line,
    quote: CODE_FILES['src/parse.js'].split('\n')[line - 1].trim() }],
  anchor: { path: 'src/parse.js', side: 'new', startLine: line, endLine: line } });
  // Every finding of every answer read, of every batch: the first answers' and a re-ask's.
  const batches = [{ answers: [{ answer: { findings: [fresh(1), fresh(3)] } }, { answer: { findings: [fresh(1)] } }] },
    { answers: [] }, { answers: [{ answer: { findings: [] } }] }, { answers: [{ answer: { findings: [fresh(3)] } }] }];
  assert.equal(accountFindingCount(batches), 4);
  // Over the same answers, the records `accountItems` gives conserve against that count; with one record lost, the check
  // throws, though the records' own count would not see it.
  const carried = accountItems(batches, { check: () => ({ ok: false, error: 'value_outside_list' }),
    ctx: { context: { source: () => null } }, withhold: () => 'malformed' });
  assert.equal(carried.fates.length, 4);
  const counts = { answer: { findings: 0, questions: 0 }, repair: { findings: 0, questions: 0 } };
  assert.equal(checkedFates(carried.fates, { ...counts, account: { findings: accountFindingCount(batches), questions: 0 } }),
    carried.fates);
  const lost = carried.fates.slice(0, -1);
  assert.throws(() => checkedFates(lost, { ...counts, account: { findings: accountFindingCount(batches), questions: 0 } }),
    /code_pass_fates_unconserved/);
  assert.doesNotThrow(() => checkedFates(lost, { ...counts, account: { findings: lost.length, questions: 0 } }));
  // On a run: an answer's finding that no record names (a hole in its list, which a list's walk skips) throws.
  const holed = [];
  holed[1] = fresh(1);
  await assert.rejects(run(agents({ account: (prompt) => ({ ...ALL_HOLD(prompt), findings: holed }) })),
    /code_pass_fates_unconserved/);
});

// ---- D111's second review: what every reader says beside the accounting, in every combination ------------------------
//
// An item's entry can end examined (breaks, holds, outside), not examined, missing by each cause (inconsistent among
// them: a `holds` entry beside a published finding) or past the cap, each with or without a published finding that
// follows from the item. Whatever the combination, the readers say of the accounting only what its record shows: the
// count of items that the item-by-item check did not examine in a way that Sonah could use. They never say that the code
// review did not finish its work, or did not cover the change and its checks, when only those items keep the coverage
// short of complete (I10): every call can have answered, and a published finding can follow from a counted item.

const W = CODE_REPORT_WORDS;
/** The finding of the builder's case: an ask not met, following from ask 1 (published, checked, a Must act item). */
const ASK_FINDING = reviewFinding({ kind: 'ask_not_met', lens: 'ask', leadsFrom: [ASK1] });
/** One ask, no written statement, no decision not to act: the accounting's one item is ask 1. */
const ONE_ASK = { ...reportOf({ asks: 1, written: 0 }), decisions: [] };
const throwing = () => { throw Object.assign(new Error('model_unavailable'), { code: 'model_unavailable' }); };
/** `n` findings of the review that follow from no item, on lines 1 to 3 of parse.js, each with a title of the most
 *  characters a title may hold: they make the accounting's request, which lists them all, larger than the review's. */
const longFindings = (n) => Array.from({ length: n }, (_, i) => {
  const line = 1 + (i % 3);
  const kind = ['bug', 'missed_case', 'contract_break', 'rule_break', 'weak_test', 'bug', 'missed_case'][Math.floor(i / 3)];
  return reviewFinding({ kind, lens: { weak_test: 'tests', contract_break: 'contracts', rule_break: 'rules' }[kind]
    ?? 'behaviour', title: `SYNTHETIC ${i} `.padEnd(160, 't'), trace: [{ step: 'SYNTHETIC.', path: 'src/parse.js',
    side: 'new', startLine: line, endLine: line, quote: CODE_FILES['src/parse.js'].split('\n')[line - 1].trim() }],
  anchor: { path: 'src/parse.js', side: 'new', startLine: line, endLine: line } });
});
// (Joined with D108, which shows the review each changed file whole by default: the questions are long enough that the
// accounting's request is still the larger, so the review fits its one bound and the accounting's request does not.)
const longQuestions = Array.from({ length: 3 }, (_, i) => ({ question: `SYNTHETIC question ${i + 1}: `.padEnd(990, 'q'),
  key: ASK1, quote: 'add a parse function' }));

/**
 * Every combination of the entry's end and a published finding on its item, each `{ name, fate, finding, key?, report?,
 * findings?, questions?, account?, bound?, calls? }`: `fate` the entry's `[fate, cause]`; `finding` whether a published
 * finding follows from its item. `calls`: the footer's lines of an accounting call that did not answer or was not made.
 * `holds` beside a published finding is the voided entry (`inconsistent`); `breaks` needs a finding or a question to
 * name, so without a finding it names a question.
 */
const COMBINATIONS = [
  { name: 'breaks by the finding', fate: ['breaks', null], finding: true, account: askOne({ outcome: 'breaks', by: 'F1' }) },
  { name: 'breaks by a question', fate: ['breaks', null], finding: false, questions: [{ question: 'SYNTHETIC an empty '
    + 'input?', key: ASK1, quote: 'add a parse function' }], account: askOne({ outcome: 'breaks', by: 'Q1' }) },
  { name: 'holds', fate: ['holds', null], finding: false, account: ALL_HOLD },
  { name: 'holds beside the finding: voided', fate: ['missing', 'inconsistent'], finding: true, account: ALL_HOLD },
  ...[true, false].flatMap((finding) => [
    { name: 'outside', fate: ['outside', null], finding, account: askOne({ outcome: 'outside' }) },
    { name: 'not examined', fate: ['not_examined', null], finding, account: askOne({ outcome: 'not_examined',
      receipts: [] }) },
    { name: 'left out', fate: ['missing', 'not_returned'], finding, account: () => ({ entries: [], findings: [] }) },
    { name: 'out of its shape twice', fate: ['missing', 'malformed'], finding, account: askOne({
      outcome: 'not_examined', receipts: [LINE_2] }) },
    { name: 'ungrounded twice', fate: ['missing', 'evidence_grounding_failed'], finding,
      account: askOne({ receipts: [NOWHERE] }) },
    { name: 'breaks, naming nothing', fate: ['missing', 'unreported'], finding, account: askOne({ outcome: 'breaks' }) },
    { name: 'its call failed', fate: ['missing', 'batch_failed'], finding, account: throwing,
      calls: [W.footerKinds.failed({ count: 1, parts: [W.parts.account] })] },
    { name: 'its call too large to send', fate: ['missing', 'too_large'], finding, bound: 'review',
      findings: [...(finding ? [ASK_FINDING] : []), ...longFindings(finding ? 19 : 20)], questions: longQuestions,
      calls: [W.footerKinds.too_large({ count: 1, parts: [W.parts.account] })] },
    { name: 'past the cap', fate: ['missing', 'over_review_limit'], finding, key: 'S121',
      report: { ...reportOf({ asks: 121, written: 0 }), decisions: [] },
      findings: finding ? [{ ...ASK_FINDING, leadsFrom: ['S121'] }] : [] },
  ]),
];

/** The run of a combination, and every reader of it: the story's code section block by block (from its heading to the
 *  end of What Sonah could not check), the page's (from its heading on), the facts the page lists, and the terminal's
 *  line of Sonah's review. */
async function readersOf(c) {
  const report = c.report ?? ONE_ASK;
  const findings = c.findings ?? (c.finding ? [ASK_FINDING] : []);
  const judge = (seen = []) => agents({ findings, questions: c.questions ?? [], account: c.account ?? ALL_HOLD, seen });
  let bound = Infinity;
  if (c.bound === 'review') {
    const seen = [];
    await run(judge(seen), { report });
    bound = reviewInputBytes(seen.find((r) => r.label === 'code-review:agent'));
    assert.ok(reviewInputBytes(seen.find((r) => r.label === 'code-account:1')) > bound, c.name);
    assert.ok(seen.filter((r) => !r.label.startsWith('code-account:')).every((r) => reviewInputBytes(r) <= bound), c.name);
  }
  const result = await run(judge(), { report, bound });
  const f = setup(report);
  const joined = withCodePass(f.report, result);
  const md = renderReportMarkdown(f.session, joined);
  const page = renderSessionPage(f.session, joined);
  const heading = `#### ${REPORT_NOT_CHECKED_WORDS.codeReview}`;
  const from = md.indexOf(heading);
  const story = md.slice(from, md.indexOf('\n\n</details>', from)).split('\n\n');
  const h3 = `<h3 class="sub-h">${escapeHtml(REPORT_NOT_CHECKED_WORDS.codeReview)}</h3>`;
  const at = page.indexOf(h3);
  return { p: result.codePass, nc: reportModel(f.session, joined).notChecked, story, page,
    pageCode: page.slice(at, page.indexOf('</div></details>', at)),
    terminal: runStateLine({ ...joined, codePass: { ...joined.codePass, required: false } }) };
}

test('D111 second review: in every combination of an entry\'s end and a published finding on its item, the readers say of the accounting only the count of what its item-by-item check did not examine in a way that Sonah could use — never that the code review did not finish or did not cover', async () => {
  assert.equal(COMBINATIONS.length, 4 + 2 * 9);
  for (const c of COMBINATIONS) {
    const why = `${c.name}, ${c.finding ? 'with' : 'without'} a published finding on its item`;
    const { p, nc, story, page, pageCode, terminal } = await readersOf(c);
    // The record: the entry's end, the finding published or not, the review's own coverage complete (the fixture's review
    // reads every file and every check answers), and the coverage partial exactly when the item is counted (I10).
    const entry = p.account.entries.find((e) => e.key === (c.key ?? ASK1));
    assert.deepEqual([entry.fate, entry.cause ?? null], c.fate, why);
    const published = p.findings.some((x) => x.title === ASK_FINDING.title);
    assert.equal(published, c.finding, why);
    const counted = ['not_examined', 'missing'].includes(entry.fate);
    assert.deepEqual([p.account.reviewCoverage, p.coverage], ['complete', counted ? 'partial' : 'complete'], why);
    // The story's code section, whole: the fixed paragraphs (no coverage line: the review's own coverage is complete;
    // the line with no finding when none is published; D109's line of the open questions' checks when one is published),
    // then one list — the accounting's calls that did not answer or were not made, then the count — then the session
    // review's rows that no reader reads.
    const paragraphs = [W.how, W.howConfirm, ...(p.questions.length ? [codeQuestionsLine(p)] : []), W.base(null),
      W.files(1, [['whole', 1]], 0), ...(p.findings.length ? [] : [W.proposedNone])];
    const bullets = [...(c.calls ?? []), ...(counted ? [W.unaccounted.ask.person(1)] : [])].map((line) => `${line}.`);
    assert.deepEqual(story, [`#### ${REPORT_NOT_CHECKED_WORDS.codeReview}`, ...paragraphs,
      ...(bullets.length ? [bullets.map((line) => `- ${line}`).join('\n')] : []), ...nc.unreadAsks, ...nc.unreadRows], why);
    // The page's code section, whole: the same paragraphs; its facts list the same lines.
    assert.equal(pageCode, `<h3 class="sub-h">${escapeHtml(REPORT_NOT_CHECKED_WORDS.codeReview)}</h3>${paragraphs
      .map((line) => `<p class="note">${escapeHtml(line)}</p>`).join('')}${[...nc.unreadAsks, ...nc.unreadRows]
      .map((line) => `<p class="note">${escapeHtml(line)}</p>`).join('')}`, why);
    for (const line of bullets) assert.ok(page.includes(`<li>${escapeHtml(line)}</li>`), `${why}: ${line}`);
    assert.equal(page.includes(escapeHtml(W.unaccounted.ask.person(1))), counted, why);
    // The terminal: the whole change covered; and, when the item is counted, that its item-by-item check did not examine
    // every item in a way that Sonah could use — never that the code review did not cover the change and its checks.
    assert.ok(terminal.includes(`code review ${RUN_STATE_WORDS.codePass[counted ? 'unaccounted' : 'complete']}`),
      `${why}: ${terminal}`);
    assert.ok(!terminal.includes(RUN_STATE_WORDS.codePass.partial), `${why}: ${terminal}`);
  }
});

test('D111 second review: the coverage line names no list and says only what the code review\'s own work left — beside the accounting\'s count when both are short, and again when the repository changed while it ran', async () => {
  assert.equal(W.coverage.partial, 'The code review did not finish every part of its work.');
  // The review's own work short (a finding's check did not answer) and the item not examined: the coverage line once,
  // and the count in the list after the call that did not answer; the terminal says the review did not cover it all.
  const report = ONE_ASK;
  const f = setup(report);
  const both = await run(agents({ findings: [ASK_FINDING], verify: throwing, account: askOne({ outcome: 'not_examined',
    receipts: [] }) }), { report });
  assert.deepEqual([both.codePass.coverage, both.codePass.account.reviewCoverage], ['partial', 'partial']);
  const nc = reportModel(f.session, withCodePass(f.report, both)).notChecked;
  const said = (parts) => parts.map((part) => part.text).join('');
  assert.deepEqual(nc.code.map(said).filter((line) => line === W.coverage.partial), [W.coverage.partial]);
  assert.deepEqual(nc.facts.filter((x) => x.group === 'code').map((x) => said(x.parts)),
    [`${W.footerKinds.failed({ count: 1, parts: [W.parts.verify] })}.`, `${W.unaccounted.ask.person(1)}.`]);
  const terminal = runStateLine({ ...withCodePass(f.report, both), codePass: { ...both.codePass, required: true } });
  assert.ok(terminal.includes(`code review ${RUN_STATE_WORDS.codePass.partial})`), terminal);
  // The review's own work short and every item examined: the coverage line, no count.
  const own = await run(agents({ findings: [ASK_FINDING], verify: throwing, account: askOne({ outcome: 'breaks',
    by: 'F1' }) }), { report });
  assert.deepEqual([own.codePass.coverage, own.codePass.account.reviewCoverage], ['partial', 'partial']);
  assert.equal(codeCoverageLines(own.codePass).at(-1), W.coverage.partial);
  assert.ok(!codeFooterLines({ codePass: own.codePass }).some((line) => Object.values(W.unaccounted.ask)
    .some((by) => line === by(1))));
  // Only the accounting short: no coverage line; the repository changed while the code step ran: the review's own
  // coverage is short too, and the coverage line is back, as it is without the accounting.
  const alone = await run(agents({ account: askOne({ outcome: 'not_examined', receipts: [] }) }), { report });
  assert.ok(!codeCoverageLines(alone.codePass).includes(W.coverage.partial));
  const changed = markSourceChanged(alone.codePass);
  assert.deepEqual([changed.coverage, changed.account.reviewCoverage, alone.codePass.account.reviewCoverage],
    ['partial', 'partial', 'complete']);
  assert.equal(codeCoverageLines(changed).at(-1), W.coverage.partial);
  assert.ok(runStateLine({ ...withCodePass(f.report, alone), codePass: { ...changed, required: true } })
    .includes(`code review ${RUN_STATE_WORDS.codePass.partial})`));
  const examined = await run(agents(), { report });
  assert.equal(markSourceChanged(examined.codePass).account.reviewCoverage, 'partial');
});

test('D111 second review: the review\'s own coverage is read from the record only when the accounting\'s counts are there — else the record\'s coverage, as before the accounting', () => {
  const count = { kind: 'unaccounted', scope: 'ask', count: 1 };
  assert.equal(codeReviewCoverage({ coverage: 'partial', account: { reviewCoverage: 'complete' }, footer: [count] }),
    'complete');
  // No count of the accounting (a record that lost it): the record's coverage, and the coverage line with it.
  assert.equal(codeReviewCoverage({ coverage: 'partial', account: { reviewCoverage: 'complete' }, footer: [] }), 'partial');
  assert.equal(codeReviewCoverage({ coverage: 'partial', account: { reviewCoverage: 'complete' },
    footer: [{ ...count, count: 0 }] }), 'partial');
  // A record before the accounting, or one whose review's own coverage is short: the record's.
  assert.equal(codeReviewCoverage({ coverage: 'partial', footer: [count] }), 'partial');
  assert.equal(codeReviewCoverage({ coverage: 'partial', account: { reviewCoverage: 'partial' }, footer: [count] }),
    'partial');
  for (const coverage of ['complete', 'missing'])
    assert.equal(codeReviewCoverage({ coverage, account: { reviewCoverage: 'complete' }, footer: [count] }), coverage);
});
