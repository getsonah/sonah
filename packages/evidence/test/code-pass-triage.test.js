// D96 (code-pass/10): the code step's triage — the level, impact, action, label and place the review agent may give for
// a finding, a question or a dossier item the report shows as an item. Its contract holds types only, so a slip in it
// never fails the answer the transport checks; code checks every entry after the answer returns, names a failing one
// only in the repair a failing finding or question asks for (never in a call of its own), drops what still fails with
// its closed cause, and never withholds a finding or a question, adds a call or lowers the coverage for it. The
// checking agents never see it.
//
// Synthetic sessions and files, an in-memory repository reader and deterministic fake agents: no recording, no model, no
// network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CODE_REVIEW_SYSTEM, CODE_REVIEW_SCHEMA, CODE_PASS_PROFILE, TRIAGE_ERROR_WORDS, codeSnapshotPlan,
  freezeCodeSnapshot, runCodePass, triageShape, triageFieldFaults } from '../src/code-pass.js';
import { TRIAGE_ERRORS, CODE_ITEM_ERRORS, REPORT_ITEM_KINDS, CODE_DOSSIER_MOVES } from '../src/ledger.js';
import { ITEM_KIND_TABLE, TIER_TABLE_VERSION, TRIAGE_LIMITS } from '../src/triage.js';
import { steWordCount } from '../src/ste-count.js';
import { reviewInputBytes } from '../src/challenge.js';
import { runProfile } from '../src/run-review.js';
import { canonicalJson } from '../contracts/canonical.js';
import { CODE_FILES, codeSession, dossierItems, reviewFinding, holds, allSound, verifiedFinding, batchItems,
  itemsEnded, PARSE_QUOTE } from '../../cli/test/code-pass-fixture.js';

const enc = (text) => new TextEncoder().encode(text);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const GIT = { kind: 'git', commit: 'a'.repeat(40), how: 'reflog' };
const ROOT = '/work/repo';
const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
const PARSE_PATCH = ['diff --git a/src/parse.js b/src/parse.js', 'index 1111111..2222222 100644', '--- a/src/parse.js',
  '+++ b/src/parse.js', '@@ -1,4 +1,4 @@ export function parse(input) {', ' export function parse(input) {',
  '-  const parts = input.split(";");', '+  const parts = input.split(",");', '   return parts.map((part) => part.trim());',
  ' }', ''].join('\n');

/** The fixture's change from its start commit: parse.js modified (git's patch). */
function snapshotOf(session = codeSession()) {
  const plan = codeSnapshotPlan(session);
  const reads = plan.map((entry) => (Object.hasOwn(CODE_FILES, entry.path)
    ? { path: entry.path, bytes: enc(CODE_FILES[entry.path]) } : { path: entry.path, state: 'deleted' }))
    .map((read) => (read.path === 'src/parse.js' ? { ...read, type: 'modified', base: { bytes: enc(BASE_PARSE) },
      patch: PARSE_PATCH } : read));
  return freezeCodeSnapshot(plan, reads, { base: GIT });
}
const named = (path) => String(path).replace(/^\.\//, '').replace(`${ROOT}/`, '');
const fileOf = (files, path) => (Object.hasOwn(files, named(path)) ? { path: named(path), text: files[named(path)],
  sha256: sha(enc(files[named(path)])) } : null);
const repo = { root: ROOT, top: ROOT, read: (path) => fileOf(CODE_FILES, path),
  base: (path) => fileOf({ 'src/parse.js': BASE_PARSE }, path) };

const R = (eventId, role, quote) => ({ eventId, role, quote });
const CLAIM_QUOTE = 'parse now returns an empty list for empty input.';
/** A session review's report over `codeSession` (decisions with the columns the ledger derived): S1 an ask partly done,
 *  S2 a claim not checked, S3 a claim confirmed, S4 a decision made without asking, S5 a decision you settled. */
function sessionReport() {
  return {
    repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', pr: null, codeCoverage: 'missing',
    coverage: 'complete', sessionReview: 'complete', findings: [],
    promises: [{ id: `sha256:${'1'.repeat(64)}`, stated: R('C1', 'commentary', CLAIM_QUOTE), text: 'SYNTHETIC claim',
      status: 'open', receipts: [] },
    { id: `sha256:${'5'.repeat(64)}`, stated: R('C2', 'commentary', 'the tests pass'), text: 'SYNTHETIC confirmed claim',
      status: 'verified', receipts: [] }],
    requirements: [{ text: 'Return [] for empty input.', instruction: R('I1', 'instruction', 'add a parse function'),
      status: 'partly-done', deliverable: R('W1', 'code', 'export function parse(input) {'),
      shortfall: R('C1', 'commentary', CLAIM_QUOTE) }],
    decisions: [
      { id: `sha256:${'2'.repeat(64)}`, dimension: 'How to split the input', chosen: 'Split on commas', actions: ['W1'],
        column: 'unasked', columnState: 'grounded', stated: null },
      { id: `sha256:${'3'.repeat(64)}`, dimension: 'Which file to write', chosen: 'src/parse.js', actions: ['W1'],
        column: 'asked-settled', columnState: 'grounded', stated: null },
    ],
    failures: [], writtenClaims: [],
  };
}
const ASK = 'S1', CLAIM = 'S2', CONFIRMED = 'S3', UNASKED = 'S4', SETTLED = 'S5';

/** The fake agents (as code-pass.test.js): the review agent answers `review(prompt)`; its repair `repair(request)` (default:
 *  the review's answer again); a finding's checker `verify(finding)`; the batch checker `batch(items)`. */
function agents({ review, repair = null, verify = holds, batch = allSound, seen = [] }) {
  return async (request) => {
    seen.push(request);
    if (request.label === 'code-review:agent') return review(request.prompt, request);
    if (request.label === 'code-review:repair') return repair ? repair(request) : review(request.prompt, request);
    if (/^code-verify:F\d+(:reask)?$/.test(request.label)) return verify(verifiedFinding(request.prompt), request);
    if (/^code-verify:batch(:reask)?$/.test(request.label)) return batch(batchItems(request.prompt), request);
    throw new Error(`unexpected request ${request.label}`);
  };
}
const run = (judge, { report = sessionReport(), session = codeSession(), bound = 1_620_000 } = {}) => runCodePass({
  report, session, snapshot: snapshotOf(session), repo, bound, judge, base: GIT, root: ROOT });
const labels = (seen) => seen.map((r) => r.label);
const entry = (key, over = {}) => ({ key, level: 'high', impact: 'An empty input gives you one empty part.',
  action: 'Return an empty list for empty input.', label: 'fix empty input', where: null, ...over });
const QUESTION = { question: 'Should an empty input be an error?', key: ASK, quote: 'add a parse function' };
const answerWith = (over = {}) => () => ({ findings: [reviewFinding()], questions: [QUESTION], ...over });
/** A question whose quote is in no item's words: it fails its grounding, so the answer asks for the one repair. */
const UNGROUNDED_QUESTION = { question: 'SYNTHETIC is the split right?', key: ASK,
  quote: 'SYNTHETIC words no item shows' };
/** `answerWith`, with a second question that asks for the one repair (`UNGROUNDED_QUESTION`). */
const repairing = (over = {}) => () => ({ ...answerWith()(), questions: [QUESTION, UNGROUNDED_QUESTION], ...over });
/** The one repair of a `repairing` answer that mends its second question (`Q2`): the same dossier key, its quote now in
 *  the ask's words, so the step takes it, and only the triage entry for `Q2` may come with it. */
const MENDED_QUESTION = { ...UNGROUNDED_QUESTION, quote: 'add a parse function' };
const mending = (over = {}) => () => ({ ...answerWith()(), questions: [QUESTION, MENDED_QUESTION], ...over });
/** A place whose quote is not on the lines it names. */
const OFF_PLACE = { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2,
  quote: 'const parts = input.split("|");' };
const refuse = () => { throw new Error('SYNTHETIC the repair call failed'); };

/** A JSON Schema check of the keywords the contracts use, as a transport that enforces `--json-schema` applies it: the
 *  first violation's path, or null. */
function violation(value, schema, path = '$') {
  const types = schema.type === undefined ? null : [].concat(schema.type);
  const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
  if (types && !types.some((t) => t === typeOf(value) || (t === 'number' && typeof value === 'number'))) return path;
  if (schema.enum && !schema.enum.includes(value)) return path;
  if (typeof value === 'string' && ((schema.minLength ?? 0) > value.length || value.length > (schema.maxLength ?? Infinity)))
    return path;
  if (Array.isArray(value)) {
    if ((schema.minItems ?? 0) > value.length || value.length > (schema.maxItems ?? Infinity)) return path;
    for (const [i, v] of value.entries()) { const at = schema.items && violation(v, schema.items, `${path}[${i}]`); if (at) return at; }
  } else if (value !== null && typeof value === 'object') {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) return `${path}.${key}`;
    for (const [key, v] of Object.entries(value)) {
      if (schema.properties && Object.hasOwn(schema.properties, key)) {
        const at = violation(v, schema.properties[key], `${path}.${key}`);
        if (at) return at;
      } else if (schema.additionalProperties === false) return `${path}.${key}`;
    }
  }
  return null;
}
/** A transport that refuses an answer failing the request's schema, as the CLI's `--json-schema` does: the call fails
 *  with `model_structured_output_failed`. */
const enforcing = (judge) => async (request) => {
  const answer = await judge(request);
  if (request.schema && violation(answer, request.schema)) {
    throw Object.assign(new Error('model_structured_output_failed'), { code: 'model_structured_output_failed' });
  }
  return answer;
};
/** The keys of `schema` and every schema under it that limit a value. */
const LIMIT_KEYS = ['required', 'additionalProperties', 'minLength', 'maxLength', 'minItems', 'maxItems', 'enum'];
function limitsIn(schema, path = '') {
  if (schema === null || typeof schema !== 'object') return [];
  return Object.entries(schema).flatMap(([key, value]) => [...(LIMIT_KEYS.includes(key) ? [`${path}.${key}`] : []),
    ...limitsIn(value, `${path}.${key}`)]);
}

// ---- the contract and the brief -----------------------------------------------------------------------------------------

test('triage contract: `triage` and `files` are optional and hold types only; the brief asks for them and gives no rating', () => {
  assert.deepEqual(CODE_REVIEW_SCHEMA.required, ['findings', 'questions']);
  assert.deepEqual(Object.keys(CODE_REVIEW_SCHEMA.properties), ['findings', 'questions', 'triage', 'files']);
  for (const name of ['triage', 'files']) assert.deepEqual(limitsIn(CODE_REVIEW_SCHEMA.properties[name]), [], name);
  assert.deepEqual(CODE_REVIEW_SCHEMA.properties.triage, { type: 'array', items: { type: 'object', properties: {
    key: { type: 'string' }, level: { type: 'string' }, impact: { type: 'string' }, action: { type: 'string' },
    label: { type: 'string' }, where: { type: ['object', 'null'] } } } });
  assert.deepEqual(CODE_REVIEW_SCHEMA.properties.files, { type: 'array', items: { type: 'object', properties: {
    path: { type: 'string' }, what: { type: 'string' }, asks: { type: 'array', items: { type: 'string' } } } } });
  // The walk finds a limit wherever one is put: a label with a length limit would fail the whole answer.
  const mutated = structuredClone(CODE_REVIEW_SCHEMA);
  mutated.properties.triage.items.properties.label.maxLength = TRIAGE_LIMITS.labelChars;
  assert.deepEqual(limitsIn(mutated.properties.triage), ['.items.properties.label.maxLength']);
  const flat = CODE_REVIEW_SYSTEM.replace(/\s+/g, ' ');
  for (const words of ['Importance, impact and action ("triage").', 'You may propose a level: "high" (must act), "medium" '
    + '(must know) or "low" (good to know).', 'Code keeps your level only inside the item\'s floor and ceiling.',
  'Each dossier line shows the item\'s kind ("item").', 'Each entry is {key, level, impact, action, label, where}',
  'label: the item\'s name in at most 6 words', '"files": for each file of the change, {path, what, asks}',
  'at most 20 words a sentence, the active voice, no semicolons, no idioms', 'Do not hedge.',
  'Give no rating, score, rank or confidence, and no approval or verdict on the change as a whole. The level in "triage" '
    + 'is the only importance you give.'])
    assert.ok(flat.includes(words), words);
  // It names no tier per kind: the default would anchor the proposal. Of the item kinds it names only the listed ones,
  // for what they need to become items, beside the dossier's moves it named before.
  assert.deepEqual(REPORT_ITEM_KINDS.filter((kind) => flat.includes(kind) && !CODE_DOSSIER_MOVES.includes(kind)),
    ['claim_not_checked', 'claim_incomplete', 'written_not_checked']);
  assert.doesNotMatch(flat, /must_act|must_know|good_to_know|default tier/);
  assert.ok(flat.endsWith('The level in "triage" is the only importance you give.'));
  // The profile binds the tier table: a change of one entry is a new profile digest, so no old answer replays.
  assert.deepEqual(CODE_PASS_PROFILE.triage, { levels: ['high', 'medium', 'low'], limits: TRIAGE_LIMITS,
    errors: TRIAGE_ERRORS, table: TIER_TABLE_VERSION, kinds: ITEM_KIND_TABLE });
  assert.equal(CODE_PASS_PROFILE.triage.kinds, ITEM_KIND_TABLE);
  const profile = runProfile('session-only');
  assert.deepEqual(profile.codePass.triage.kinds, JSON.parse(JSON.stringify(ITEM_KIND_TABLE)));
  const moved = structuredClone(profile);
  moved.codePass.triage.kinds.pivot.tier = 'must_know';
  assert.notEqual(sha(canonicalJson(moved)), sha(canonicalJson(profile)));
  // Every error a dropped entry may carry has fixed words in the repair note, or is the shape check's.
  assert.deepEqual(Object.keys(TRIAGE_ERROR_WORDS), [...TRIAGE_ERRORS]);
});

test('triage contract: a transport that enforces the schema still passes an answer with a long label, a 121st entry and an entry with no place; code drops only those', async () => {
  const many = Array.from({ length: TRIAGE_LIMITS.entries + 1 }, () => entry('F1'));
  const answer = () => ({ findings: [reviewFinding()], questions: [], triage: [
    entry('F1', { label: 'x'.repeat(TRIAGE_LIMITS.labelChars + 1) }), (({ where: _w, ...rest }) => rest)(entry('S1')),
    entry(UNASKED, { level: 'low' }), ...many.slice(3)] });
  assert.equal(answer().triage.length, TRIAGE_LIMITS.entries + 1);
  assert.equal(violation(answer(), CODE_REVIEW_SCHEMA), null, 'the transport accepts it');
  // With a length limit in the contract, the same answer would fail whole: findings and questions with it.
  const limited = structuredClone(CODE_REVIEW_SCHEMA);
  limited.properties.triage.items.properties.label.maxLength = TRIAGE_LIMITS.labelChars;
  assert.ok(violation(answer(), limited));
  const seen = [];
  const result = await run(enforcing(agents({ seen, review: answer })));
  // Every finding and question passed: the slips ask for no repair.
  assert.deepEqual(labels(seen), ['code-review:agent', 'code-verify:F1']);
  assert.equal(result.codePass.agent.terminal, 'answered');
  assert.equal(result.codePass.findings.length, 1, 'the finding is checked and published');
  assert.deepEqual(result.codePass.withheld, []);
  // The first F1 that passes whole (index 3) stands before the one at 0, which passes only without its long label; every
  // other one repeats its key.
  assert.deepEqual(result.codePass.triageDropped.map(({ index, cause }) => [index, cause]), [[0, 'triage_key_repeated'],
    [1, 'key_missing'], ...Array.from({ length: TRIAGE_LIMITS.entries - 4 }, (_, k) => [k + 4, 'triage_key_repeated']),
    [TRIAGE_LIMITS.entries, 'text_over_limit']]);
  assert.deepEqual(result.codePass.triage.map((t) => [Object.keys(t.ref)[0], t.level]), [['source', 'low'],
    ['finding', 'high']]);
  // When a question asks for the repair, the others are named in it; the entries past the cap are never sent back.
  const asked = [];
  await run(enforcing(agents({ seen: asked, review: () => ({ ...answer(), questions: [UNGROUNDED_QUESTION] }) })));
  const repair = asked.find((r) => r.label === 'code-review:repair');
  assert.match(repair.prompt, /^- questions\[0\]: quote_ungrounded /m);
  assert.match(repair.prompt, /^- triage\[0\]: text_over_limit .* at triage\[0\]\.label$/m);
  assert.match(repair.prompt, /^- triage\[1\]: key_missing .* at triage\[1\]\.where$/m);
  assert.doesNotMatch(repair.prompt, new RegExp(`triage\\[${TRIAGE_LIMITS.entries}\\]`));
});

// ---- keys, the record, the repair ----------------------------------------------------------------------------------------

test('triage: F, Q and S keys are kept against the published finding, the published question and the row they name', async () => {
  const seen = [];
  const result = await run(agents({ seen, review: answerWith({ triage: [entry('F1'),
    entry('Q1', { level: 'medium', label: 'decide on empty input' }), entry(UNASKED, { level: 'low', label: 'the split' }),
    entry(CLAIM, { level: 'medium', label: 'the empty list claim' })] }) }));
  assert.deepEqual(labels(seen), ['code-review:agent', 'code-verify:F1', 'code-verify:batch'], 'no repair: nothing failed');
  const [finding] = result.codePass.findings;
  const [question] = result.codePass.questions;
  assert.deepEqual(result.codePass.triage, [
    { ref: { finding: finding.id }, level: 'high', impact: 'An empty input gives you one empty part.',
      action: 'Return an empty list for empty input.', label: 'fix empty input', where: null },
    { ref: { question: question.id }, level: 'medium', impact: 'An empty input gives you one empty part.',
      action: 'Return an empty list for empty input.', label: 'decide on empty input', where: null },
    { ref: { source: 'decisions', index: 0, id: `sha256:${'2'.repeat(64)}` }, level: 'low',
      impact: 'An empty input gives you one empty part.', action: 'Return an empty list for empty input.',
      label: 'the split', where: null },
    { ref: { source: 'promises', index: 0, id: `sha256:${'1'.repeat(64)}` }, level: 'medium',
      impact: 'An empty input gives you one empty part.', action: 'Return an empty list for empty input.',
      label: 'the empty list claim', where: null }]);
  assert.equal(question.id, 'Q1');
  // The `files` list was absent: counted empty with one cause; nothing of the triage was dropped.
  assert.deepEqual([result.codePass.triageDropped, result.codePass.filesDropped], [[],
    [{ key: null, index: null, cause: 'key_missing' }]]);
  // No word of the triage reaches a finding, a question or a check.
  for (const f of result.codePass.findings) assert.ok(!JSON.stringify(f).includes('fix empty input'));
});

test('triage: an unknown, a repeated and a not-an-item key are named in the one repair and dropped with their cause; the finding is published unchanged', async () => {
  const bad = [entry('F1'), entry('F9'), entry('F1', { label: 'again' }), entry(SETTLED), entry(CONFIRMED),
    entry('S99'), entry('X1'), entry('Q1')];
  const seen = [];
  // The second question fails its grounding and asks for the one repair; the triage's faults ride on it.
  const result = await run(agents({ seen, review: repairing({ triage: bad }) }));
  const plain = await run(agents({ review: repairing() }));
  assert.deepEqual(result.codePass.findings, plain.codePass.findings, 'published as with no triage');
  assert.deepEqual(result.codePass.questions, plain.codePass.questions);
  assert.deepEqual(result.codePass.withheld, plain.codePass.withheld);
  assert.deepEqual(labels(seen), ['code-review:agent', 'code-review:repair', 'code-verify:F1', 'code-verify:batch']);
  const repair = seen[1].prompt;
  for (const [index, error] of [[1, 'triage_key_unknown'], [2, 'triage_key_repeated'], [3, 'triage_not_item'],
    [4, 'triage_not_item'], [5, 'triage_key_unknown'], [6, 'triage_key_unknown']])
    assert.match(repair, new RegExp(`^- triage\\[${index}\\]: ${error} \\(${TRIAGE_ERROR_WORDS[error]
      .replace(/[()]/g, '\\$&')}\\) at triage\\[${index}\\]`, 'm'), `${index} ${error}`);
  assert.doesNotMatch(repair, /^- triage\[(0|7)\]/m);
  assert.deepEqual(result.codePass.triageDropped, [{ key: 'F9', index: 1, cause: 'triage_key_unknown' },
    { key: 'F1', index: 2, cause: 'triage_key_repeated' }, { key: SETTLED, index: 3, cause: 'triage_not_item' },
    { key: CONFIRMED, index: 4, cause: 'triage_not_item' }, { key: 'S99', index: 5, cause: 'triage_key_unknown' },
    { key: 'X1', index: 6, cause: 'triage_key_unknown' }]);
  assert.deepEqual(result.codePass.triage.map((t) => Object.keys(t.ref)[0]), ['finding', 'question']);
  // The repair mends the question and corrects the entry at its index, but the corrected entry names no item taken from
  // the repair: Sonah does not take it, and the answer's entry is dropped with its own cause.
  const fixed = await run(agents({ review: repairing({ triage: [entry('F9')] }),
    repair: mending({ triage: [entry(UNASKED)] }) }));
  assert.deepEqual(fixed.codePass.questions.map((q) => q.question), [QUESTION.question, MENDED_QUESTION.question]);
  assert.deepEqual([fixed.codePass.triage, fixed.codePass.triageDropped],
    [[], [{ key: 'F9', index: 0, cause: 'triage_key_unknown' }]]);
  // The answer gave no entry for the question the repair mended: the repair's entry for it is not taken either.
  const none = await run(agents({ review: repairing({ triage: [entry('F9')] }),
    repair: mending({ triage: [entry('Q2')] }) }));
  assert.deepEqual([none.codePass.triage, none.codePass.triageDropped],
    [[], [{ key: 'F9', index: 0, cause: 'triage_key_unknown' }]]);
  assert.equal(none.codePass.findings.length, 1);
  // With no finding or question to repair, the same entries ask for no call: each is dropped with its cause.
  const alone = [];
  const unasked = await run(agents({ seen: alone, review: answerWith({ triage: bad }) }));
  assert.deepEqual(labels(alone), ['code-review:agent', 'code-verify:F1', 'code-verify:batch']);
  assert.deepEqual(unasked.codePass.triageDropped, result.codePass.triageDropped);
});

test('triage: a place that does not ground is dropped alone; the entry stays, and a place that grounds is kept with its span and hash', async () => {
  const ok = { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2, quote: PARSE_QUOTE };
  const off = OFF_PLACE;
  const seen = [];
  const result = await run(agents({ seen, review: repairing({ triage: [entry('F1', { where: ok }),
    entry(UNASKED, { where: off })] }) }));
  const repair = seen.find((r) => r.label === 'code-review:repair');
  assert.match(repair.prompt,
    /^- triage\[1\]: quote_ungrounded .* at triage\[1\]\.where "const parts = input\.split\(\\"\|\\"\);"$/m);
  assert.deepEqual(result.codePass.triage.map((t) => [Object.keys(t.ref)[0], t.where?.quote ?? null]),
    [['finding', PARSE_QUOTE], ['source', null]]);
  const [{ where }] = result.codePass.triage;
  assert.deepEqual(where, { eventId: where.eventId, role: 'code', side: 'new', quote: PARSE_QUOTE, path: 'src/parse.js',
    startLine: 2, endLine: 2, sha256: sha(enc(CODE_FILES['src/parse.js'])), span: '  const parts = input.split(",");' });
  assert.deepEqual(result.codePass.triageDropped, [{ key: UNASKED, index: 1, cause: 'where_ungrounded' }]);
  // A place that is not a receipt's shape is dropped alone the same way; one that is not an object is the entry's fault.
  const shaped = await run(agents({ review: answerWith({ triage: [entry(UNASKED, { where: { path: 'src/parse.js' } })] }) }));
  assert.deepEqual([shaped.codePass.triage.length, shaped.codePass.triage[0].where, shaped.codePass.triageDropped],
    [1, null, [{ key: UNASKED, index: 0, cause: 'where_ungrounded' }]]);
  assert.equal(triageShape(entry(UNASKED, { where: 'src/parse.js:2' }), { dossier: new Map() }).error, 'value_outside_list');
  // The repair mends the question: its entry for that question, its place now grounded, replaces the answer's.
  const mended = await run(agents({ review: repairing({ triage: [entry('Q2', { where: off })] }),
    repair: mending({ triage: [entry('Q2', { where: ok })] }) }));
  assert.deepEqual([mended.codePass.triage[0].ref, mended.codePass.triage[0].where.quote, mended.codePass.triageDropped],
    [{ question: 'Q2' }, PARSE_QUOTE, []]);
  // Its entry for a key that names no item taken from it is not taken: the answer's entry stands, its place dropped.
  const other = await run(agents({ review: repairing({ triage: [entry(UNASKED, { where: off })] }),
    repair: mending({ triage: [entry(UNASKED, { where: ok })] }) }));
  assert.deepEqual([other.codePass.triage[0].where, other.codePass.triageDropped],
    [null, [{ key: UNASKED, index: 0, cause: 'where_ungrounded' }]]);
  // The repair's entry for the question fails, or the repair gives none for it: the answer's entry stands, its place
  // dropped.
  for (const offered of [entry('Q2', { level: 'urgent' }), entry('F1', { where: ok })]) {
    const kept = await run(agents({ review: repairing({ triage: [entry('F1'), entry('Q2', { where: off })] }),
      repair: mending({ triage: [entry('F1'), offered] }) }));
    assert.deepEqual(kept.codePass.triage.map((t) => [Object.keys(t.ref)[0], t.where]), [['finding', null],
      ['question', null]], JSON.stringify(offered));
    assert.deepEqual(kept.codePass.triageDropped, [{ key: 'Q2', index: 1, cause: 'where_ungrounded' }]);
  }
});

test('triage: a slip in the triage or the files alone asks for no repair — no call, the coverage complete, the footer empty — and is dropped with its cause', async () => {
  // A label of 7 words, a place that does not ground, a note for a path outside the change; every finding and question
  // passes. A repair call would fail.
  const seven = 'fix the empty input case right now';
  const slips = { triage: [entry('F1', { label: seven }), entry(UNASKED, { where: OFF_PLACE })],
    files: [{ path: 'src/other.js', what: 'SYNTHETIC', asks: [] }] };
  const seen = [];
  const result = await run(agents({ seen, review: answerWith(slips), repair: refuse }));
  assert.deepEqual(labels(seen), ['code-review:agent', 'code-verify:F1', 'code-verify:batch']);
  assert.deepEqual([result.codePass.calls.repair, result.codePass.coverage, result.codePass.footer],
    [0, 'complete', []]);
  // The 7-word label alone is dropped, by name: the entry keeps its level, impact and action.
  assert.deepEqual(result.codePass.triageDropped, [{ key: 'F1', index: 0, cause: 'text_over_limit', field: 'label' },
    { key: UNASKED, index: 1, cause: 'where_ungrounded' }]);
  assert.deepEqual(result.codePass.filesDropped, [{ key: 'src/other.js', index: 0, cause: 'file_not_in_change' }]);
  assert.deepEqual(result.codePass.triage.map((t) => [Object.keys(t.ref)[0], t.label, t.where]),
    [['finding', null, null], ['source', 'fix empty input', null]]);
  // The findings, questions, coverage, footer and calls are those of the same answer with no triage at all.
  const pick = ({ codePass: p }) => [p.findings, p.questions, p.withheld, p.coverage, p.footer, p.calls];
  assert.deepEqual(pick(result), pick(await run(agents({ review: answerWith(), repair: refuse }))));
  // A question that fails asks for the repair: the slips ride on it, and when that call fails the coverage and the
  // footer are what the question's repair alone gives.
  const asked = [];
  const both = await run(agents({ seen: asked, review: repairing(slips), repair: refuse }));
  assert.deepEqual(labels(asked), ['code-review:agent', 'code-review:repair', 'code-verify:F1', 'code-verify:batch']);
  for (const line of [/^- questions\[1\]: /m, /^- triage\[0\]: text_over_limit .* at triage\[0\]\.label$/m,
    /^- triage\[1\]: quote_ungrounded .* at triage\[1\]\.where /m, /^- files\[0\]: file_not_in_change /m])
    assert.match(asked[1].prompt, line);
  assert.deepEqual(pick(both), pick(await run(agents({ review: repairing(), repair: refuse }))));
  assert.deepEqual(both.codePass.triageDropped, result.codePass.triageDropped);
});

test('triage: the slips ride on the repair only while they keep it within the request bound; else it names the finding or question alone', async () => {
  // Every entry's label is over its limit: a repair note of some 12 KB.
  const slips = { triage: Array.from({ length: TRIAGE_LIMITS.entries }, () => entry('F1',
    { label: 'x'.repeat(TRIAGE_LIMITS.labelChars + 1) })) };
  const probe = [];
  await run(agents({ seen: probe, review: repairing(slips) }));
  const review = reviewInputBytes(probe[0]);
  const full = reviewInputBytes(probe.find((r) => r.label === 'code-review:repair'));
  // A bound the question's repair fits in, and the repair that also names the slips does not.
  const bound = review + 2_000;
  assert.ok(full > bound, `${full} > ${bound}`);
  const seen = [];
  const result = await run(agents({ seen, review: repairing(slips) }), { bound });
  const repair = seen.find((r) => r.label === 'code-review:repair');
  assert.ok(repair, 'the question\'s repair is sent');
  assert.match(repair.prompt, /^- questions\[1\]: /m);
  assert.doesNotMatch(repair.prompt, /^- triage\[/m);
  // The first entry is kept without its label; every other one repeats its key.
  assert.equal(result.codePass.triageDropped.length, TRIAGE_LIMITS.entries);
  assert.deepEqual(result.codePass.triageDropped[0], { key: 'F1', index: 0, cause: 'text_over_limit', field: 'label' });
  assert.ok(result.codePass.triageDropped.slice(1).every(({ cause }) => cause === 'triage_key_repeated'));
  const pick = ({ codePass: p }) => [p.findings, p.questions, p.withheld, p.coverage, p.footer, p.calls];
  assert.deepEqual(pick(result), pick(await run(agents({ review: repairing() }), { bound })));
  assert.deepEqual([result.codePass.coverage, result.codePass.footer], ['complete', []]);
});

test('triage shape: every text limit and the label\'s word count, entry by entry', () => {
  const dossier = new Map([[UNASKED, { itemKind: 'decision_unasked' }]]);
  const shape = (over) => triageShape(entry(UNASKED, over), { dossier });
  assert.deepEqual(shape({}), { ok: true });
  // A label of 7 words within its characters: over the word limit.
  const seven = 'fix the empty input case right now';
  assert.ok(seven.length <= TRIAGE_LIMITS.labelChars);
  assert.equal(steWordCount(seven), TRIAGE_LIMITS.labelWords + 1);
  assert.deepEqual(shape({ label: seven }), { ok: false, error: 'text_over_limit', at: 'triage.label' });
  assert.deepEqual(shape({ label: 'fix the empty input case now' }), { ok: true });
  // Each text at its limit passes; one character more is over it.
  for (const [field, limit] of [['impact', TRIAGE_LIMITS.impactChars], ['action', TRIAGE_LIMITS.actionChars],
    ['label', TRIAGE_LIMITS.labelChars]]) {
    assert.deepEqual(shape({ [field]: 'x'.repeat(limit) }), { ok: true }, field);
    assert.deepEqual(shape({ [field]: 'x'.repeat(limit + 1) }), { ok: false, error: 'text_over_limit',
      at: `triage.${field}` }, field);
    assert.deepEqual(shape({ [field]: '  ' }), { ok: false, error: 'text_over_limit', at: `triage.${field}` }, field);
  }
  assert.deepEqual([TRIAGE_LIMITS.impactChars, TRIAGE_LIMITS.actionChars, TRIAGE_LIMITS.labelChars], [200, 160, 48]);
});

test('triage: an answer with no triage list stays usable, asks for no repair, and is checked and published as before', async () => {
  const seen = [];
  const result = await run(agents({ seen, review: answerWith() }));
  assert.deepEqual(labels(seen), ['code-review:agent', 'code-verify:F1', 'code-verify:batch']);
  assert.equal(result.codePass.agent.terminal, 'answered');
  assert.deepEqual([result.codePass.findings.length, result.codePass.questions.length, result.codePass.coverage],
    [1, 1, 'complete']);
  assert.deepEqual(result.codePass.triage, []);
  assert.deepEqual(result.codePass.triageDropped, [{ key: null, index: null, cause: 'key_missing' }]);
  // A list that is not a list: empty, one cause, no repair.
  const odd = await run(agents({ review: answerWith({ triage: 'none', files: { path: 'src/parse.js' } }) }));
  assert.deepEqual([odd.codePass.triageDropped, odd.codePass.filesDropped], [[{ key: null, index: null,
    cause: 'value_outside_list' }], [{ key: null, index: null, cause: 'value_outside_list' }]]);
  assert.equal(odd.codePass.findings.length, 1);
});

test('triage: a withheld finding or question drops its entry (`item_withheld`); a finding sent to you as a question carries its entry there', async () => {
  // F1 refuted, F2 not against your goal (a question for you), Q1 a false premise.
  const second = reviewFinding({ title: 'SYNTHETIC trailing spaces are kept' });
  const verify = (finding) => (finding.title === second.title
    ? { verdict: 'refuted', reason: 'not_against_goal', claims: finding.claims.map(({ claim }) => ({ claim, verdict: 'holds' })),
      receipts: [], explanation: 'SYNTHETIC as stated.' }
    : { verdict: 'refuted', reason: 'step_unsupported', claims: finding.claims.map(({ claim }) => ({ claim,
      verdict: 'holds' })), receipts: [], explanation: 'SYNTHETIC refuted.' });
  const batch = (items) => ({ questions: items.map(({ key }) => ({ key, verdict: 'false_premise', receipts: [{
    path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2, quote: PARSE_QUOTE }], explanation: 'SYNTHETIC.' })) });
  // F1's place does not ground either: its entry is still one record, `item_withheld`.
  const result = await run(agents({ verify, batch, review: () => ({ findings: [reviewFinding(), second],
    questions: [QUESTION], triage: [entry('F1', { where: OFF_PLACE }), entry('F2', { label: 'trailing spaces' }),
      entry('Q1')] }) }));
  assert.deepEqual(result.codePass.findings, []);
  assert.deepEqual(result.codePass.questions.map((q) => [q.id, q.from]), [['Q1', 'finding']]);
  assert.deepEqual(result.codePass.triage.map((t) => [t.ref, t.label]), [[{ question: 'Q1' }, 'trailing spaces']]);
  assert.deepEqual(result.codePass.triageDropped, [{ key: 'F1', index: 0, cause: 'item_withheld' },
    { key: 'Q1', index: 2, cause: 'item_withheld' }]);
  // A finding past the answer's item limit is withheld unchecked: its entry too.
  const past = Array.from({ length: 21 }, (_, k) => reviewFinding({ title: `SYNTHETIC finding ${k + 1}` }));
  const capped = await run(agents({ review: () => ({ findings: past, questions: [], triage: [entry('F21')] }) }));
  assert.deepEqual(capped.codePass.triageDropped, [{ key: 'F21', index: 0, cause: 'item_withheld' }]);
});

test('triage: two keys naming one published finding keep the first entry', async () => {
  const result = await run(agents({ review: () => ({ findings: [reviewFinding(), reviewFinding()], questions: [],
    triage: [entry('F1'), entry('F2', { label: 'the same finding' })] }) }));
  assert.equal(result.codePass.findings.length, 1, 'one id, one finding');
  assert.deepEqual(result.codePass.triage.map((t) => t.label), ['fix empty input']);
  assert.deepEqual(result.codePass.triageDropped, [{ key: 'F2', index: 1, cause: 'triage_key_repeated' }]);
});

test('triage: the checking agents never see it — a finding\'s and the batch checker\'s requests are byte for byte the same', async () => {
  const withTriage = [], without = [];
  await run(agents({ seen: withTriage, review: answerWith({ triage: [entry('F1'), entry('Q1')] }) }));
  await run(agents({ seen: without, review: answerWith() }));
  const checks = (seen) => seen.filter((r) => r.label.startsWith('code-verify:'));
  assert.deepEqual(labels(checks(withTriage)), ['code-verify:F1', 'code-verify:batch']);
  assert.deepEqual(checks(withTriage), checks(without));
  for (const request of checks(withTriage)) assert.ok(!request.prompt.includes('fix empty input'));
});

test('triage dossier: a triageable item names its kind, never a tier; a done ask, a settled decision and a confirmed claim name none', async () => {
  const seen = [];
  const report = sessionReport();
  report.requirements.push({ text: 'SYNTHETIC done ask', instruction: R('I1', 'instruction', 'returns [] for empty input'),
    status: 'done', deliverable: R('W1', 'code', 'export function parse(input) {') });
  await run(agents({ seen, review: answerWith() }), { report });
  const lines = dossierItems(seen[0].prompt);
  const line = (kind, field, value) => lines.find((l) => l.kind === kind && l[field] === value);
  assert.deepEqual(lines.map((l) => [l.key, l.item ?? null]), [['S1', 'ask_partly_done'], ['S2', null],
    ['S3', 'claim_not_checked'], ['S4', null], ['S5', 'decision_unasked'], ['S6', null]]);
  assert.equal(line('decision', 'question', 'How to split the input').item, 'decision_unasked');
  assert.equal(line('ask', 'status', 'partly-done').item, 'ask_partly_done');
  assert.equal(line('claim', 'status', 'open').item, 'claim_not_checked');
  for (const [kind, field, value] of [['decision', 'question', 'Which file to write'], ['claim', 'status', 'verified'],
    ['ask', 'status', 'done']]) assert.equal(Object.hasOwn(line(kind, field, value), 'item'), false, value);
  assert.ok(lines.every((line) => !Object.hasOwn(line, 'tier')));
  assert.doesNotMatch(seen[0].prompt, /"tier"|must_act|must_know|good_to_know/);
  // Every closed error a triage entry may be dropped with is either the shape check's or the triage's own.
  assert.deepEqual(TRIAGE_ERRORS.filter((e) => CODE_ITEM_ERRORS.includes(e)), []);
});

/** A kept triage entry's fields, its place by its quote. */
const keptFields = (result) => result.codePass.triage.map((t) => ({ level: t.level, impact: t.impact, action: t.action,
  label: t.label, where: t.where?.quote ?? null }));
const PLACE = { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2, quote: PARSE_QUOTE };

test('triage: a text field that fails its own check is dropped alone — the entry keeps its level, its other texts and its place', async () => {
  const base = entry('F1', { level: 'medium', where: PLACE });
  // A label of 7 words: the impact, the action, the level and the place are kept; the label alone is dropped, by name.
  const seven = await run(agents({ review: answerWith({ triage: [{ ...base, label: 'fix the empty input case right now' }] }) }));
  assert.deepEqual(keptFields(seven), [{ level: 'medium', impact: base.impact, action: base.action, label: null,
    where: PARSE_QUOTE }]);
  assert.deepEqual(seven.codePass.triageDropped, [{ key: 'F1', index: 0, cause: 'text_over_limit', field: 'label' }]);
  // An impact over its limit: the label, the action, the level and the place are kept.
  const long = await run(agents({ review: answerWith({ triage: [{ ...base, impact: 'x'.repeat(TRIAGE_LIMITS.impactChars + 1) }] }) }));
  assert.deepEqual(keptFields(long), [{ level: 'medium', impact: null, action: base.action, label: base.label,
    where: PARSE_QUOTE }]);
  assert.deepEqual(long.codePass.triageDropped, [{ key: 'F1', index: 0, cause: 'text_over_limit', field: 'impact' }]);
  // An action that is not text and a blank label: each dropped alone, with its own closed cause, in the contract's order.
  const both = await run(agents({ review: answerWith({ triage: [{ ...base, action: 7, label: ' ' }] }) }));
  assert.deepEqual(keptFields(both), [{ level: 'medium', impact: base.impact, action: null, label: null, where: PARSE_QUOTE }]);
  assert.deepEqual(both.codePass.triageDropped, [{ key: 'F1', index: 0, cause: 'value_outside_list', field: 'action' },
    { key: 'F1', index: 0, cause: 'text_over_limit', field: 'label' }]);
  // What still drops an entry whole: its key, its level, its place's type, or a key another entry holds.
  for (const [over, cause] of [[{ level: 'urgent' }, 'value_outside_list'], [{ key: 'F9' }, 'triage_key_unknown'],
    [{ where: 'src/parse.js:2' }, 'value_outside_list']]) {
    const dropped = await run(agents({ review: answerWith({ triage: [{ ...base, label: 'one two three four five six seven',
      ...over }] }) }));
    assert.deepEqual(dropped.codePass.triage, [], JSON.stringify(over));
    assert.deepEqual(dropped.codePass.triageDropped.map((d) => d.cause), [cause], JSON.stringify(over));
  }
  assert.deepEqual(triageFieldFaults({ ...base, label: 'fix the empty input case right now' }, 'triage[0]'),
    [{ field: 'label', ok: false, error: 'text_over_limit', at: 'triage[0].label' }]);
});

test('triage (a paid run, 2026-10-16): a valid entry whose label has one word too many keeps its level, impact, action and place', async () => {
  // The shape of the entry that lost every field: a 7-word label, an impact of 156 characters, an action of 82, level
  // medium and a place that grounds. Synthetic words of the same lengths; the label as the review agent wrote it.
  const t6 = { key: 'F1', level: 'medium', impact: `A ${'y'.repeat(153)}.`, action: `Do ${'z'.repeat(78)}.`,
    label: 'make prefix and suffix dot rules agree', where: PLACE };
  assert.deepEqual([t6.impact.length, t6.action.length, steWordCount(t6.label)], [156, 82, 7]);
  const seen = [];
  const result = await run(agents({ seen, review: answerWith({ triage: [t6] }) }));
  assert.deepEqual(keptFields(result), [{ level: 'medium', impact: t6.impact, action: t6.action, label: null,
    where: PARSE_QUOTE }]);
  assert.deepEqual(result.codePass.triageDropped, [{ key: 'F1', index: 0, cause: 'text_over_limit', field: 'label' }]);
  // No call of its own: the review agent's request and the checks, as with no triage at all.
  assert.deepEqual(labels(seen), ['code-review:agent', 'code-verify:F1', 'code-verify:batch']);
});

test('triage: keeping a field apart moves no request byte — a repair names a triage entry by its whole shape\'s first error, as before', async () => {
  // The requests a run with triage slips sends (the review agent's, its repair and the checks), as a digest of each
  // request's label, system prompt and prompt: the same bytes as before the text fields were kept apart (computed with
  // the code of 6430357, where a failing field dropped the whole entry).
  const slips = { triage: [entry('F1', { label: 'fix the empty input case right now' }), entry(UNASKED, { where: OFF_PLACE }),
    entry(CLAIM, { impact: 'x'.repeat(TRIAGE_LIMITS.impactChars + 1), level: 'medium' })],
  files: [{ path: 'src/other.js', what: 'SYNTHETIC', asks: [] }] };
  const seen = [];
  await run(agents({ seen, review: repairing(slips), repair: refuse }));
  const digest = sha(enc(JSON.stringify(seen.map((r) => [r.label, r.system ?? null, r.prompt ?? null]))));
  assert.deepEqual(labels(seen), ['code-review:agent', 'code-review:repair', 'code-verify:F1', 'code-verify:batch']);
  assert.equal(digest, REQUESTS_BEFORE_FIELDS_APART);
});
const REQUESTS_BEFORE_FIELDS_APART = '59f931bb090d8686e2d07cfa185160c7cb235ee390a969d4ebc4be9795db62b0';

// ---- the one repair: the same item at its place ----------------------------------------------------------------------

/** The paid s3 case's shape (2026-10-16), in synthetic words: the answer's F2, an unmet ask the review proposed high,
 *  fails its check (its anchor is on no line its trace quotes) and asks for the one repair. */
function s3Shape() {
  const tests = reviewFinding({ kind: 'weak_test', lens: 'tests', title: 'SYNTHETIC the new parse tests never run in CI' });
  const ask = reviewFinding({ kind: 'ask_not_met', lens: 'ask', title: 'SYNTHETIC the empty-input ask is not met',
    leadsFrom: [ASK], anchor: { path: 'src/parse.js', side: 'new', startLine: 3, endLine: 3 } });
  const claim = reviewFinding({ kind: 'claim_false', lens: 'claims', title: 'SYNTHETIC the empty list claim is false',
    leadsFrom: [CLAIM] });
  const second = { question: 'SYNTHETIC should the parse tests run in CI?', key: ASK, quote: 'add a parse function' };
  const note = { path: 'src/parse.js', what: 'SYNTHETIC splits the input on commas', asks: [ASK] };
  const answer = { findings: [tests, ask, claim], questions: [QUESTION, second],
    triage: [entry('F1', { level: 'medium', label: 'tests skipped in CI' }),
      entry('F2', { level: 'high', impact: 'SYNTHETIC you cannot tell whether the ask is met.',
        action: 'SYNTHETIC run the empty-input case on both versions.', label: 'redo the comparison' }),
      entry('F3', { level: 'medium', label: 'discard the claim' }), entry('Q1', { level: 'medium', label: 'decide' }),
      entry('Q2', { level: 'low', label: 'tests in CI' })],
    files: [note] };
  // The repair, as the review agent returned it: its findings in another order and fewer (F1 the unmet ask, its anchor
  // now on its trace; F2 a near-copy of the answer's F1), one question of two, three triage entries of five.
  const reordered = { findings: [{ ...ask, title: 'SYNTHETIC no check shows the empty-input ask is met',
    anchor: { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2 } },
  { ...tests, title: 'SYNTHETIC the parse tests never run in CI' }],
  questions: [second],
  triage: [entry('F1', { level: 'medium', label: 'redo the comparison' }), entry('F2', { level: 'medium',
    label: 'tests skipped in CI' }), entry('Q1', { level: 'low', label: 'tests in CI' })],
  files: [note] };
  return { tests, ask, claim, answer, reordered };
}

test('triage (a paid run, 2026-10-16): a repair that puts another finding at the failing finding\'s place gives nothing for it — withheld with its cause, and its entry lands on no other finding', async () => {
  const { tests, ask, claim, answer, reordered } = s3Shape();
  const seen = [];
  const result = await run(agents({ seen, review: () => answer, repair: () => reordered }));
  assert.deepEqual(labels(seen), ['code-review:agent', 'code-review:repair', 'code-verify:F1', 'code-verify:F2',
    'code-verify:batch']);
  assert.match(seen[1].prompt, /^- findings\[1\]: anchor_off_quote /m);
  const { codePass } = result;
  // Nothing of the repair is published: the answer's F1 and F3, its two questions; F2 withheld with its own cause.
  assert.deepEqual(codePass.findings.map((f) => f.title), [tests.title, claim.title]);
  assert.deepEqual(codePass.questions.map((q) => q.question), [QUESTION.question, answer.questions[1].question]);
  // Its record says that Sonah checked no repaired version of it: at its place the repair returned a weak test, not an
  // unmet ask.
  assert.deepEqual(codePass.withheld.map(({ what, reason, cause, repair, text, kind }) => ({ what, reason, cause, repair,
    text, kind })), [{ what: 'finding', reason: 'evidence_grounding_failed', cause: 'anchor_off_quote',
    repair: 'different', text: ask.title, kind: 'ask_not_met' }]);
  // F2's level, impact and action stay with F2: dropped with it, never on another finding.
  const [t1, t3] = codePass.findings;
  assert.deepEqual(codePass.triage.map((t) => [t.ref, t.level, t.label]), [[{ finding: t1.id }, 'medium',
    'tests skipped in CI'], [{ finding: t3.id }, 'medium', 'discard the claim'], [{ question: 'Q1' }, 'medium', 'decide'],
  [{ question: 'Q2' }, 'low', 'tests in CI']]);
  assert.deepEqual(codePass.triageDropped, [{ key: 'F2', index: 1, cause: 'item_withheld' }]);
  assert.ok(!codePass.triage.some((t) => t.level === 'high'));
  assert.equal(codePass.files.find((f) => f.path === 'src/parse.js').what, 'SYNTHETIC splits the input on commas');
  // What the record shows is what a repair that corrected nothing gives: no call more, the coverage and footer the same.
  // Only the withheld record differs: of a repair that corrected nothing, Sonah checked F2's repaired version.
  const none = await run(agents({ review: () => answer, repair: () => answer }));
  const pick = ({ codePass: p }) => [p.findings, p.questions, p.withheld.map(({ repair: _repair, ...w }) => w), p.triage,
    p.triageDropped, p.filesDropped, p.coverage, p.footer, p.calls];
  assert.deepEqual(pick(result), pick(none));
  assert.deepEqual(none.codePass.withheld.map((w) => Object.hasOwn(w, 'repair')), [false]);
  // The same repair with the unmet ask at its place mends F2, and F2's entry stays with it.
  const aligned = { ...answer, findings: [tests, reordered.findings[0], claim] };
  const mended = await run(agents({ review: () => answer, repair: () => aligned }));
  assert.deepEqual(mended.codePass.findings.map((f) => f.title), [tests.title, reordered.findings[0].title, claim.title]);
  // Each run: every item of the answer ends published, or withheld with its own record.
  for (const ran of [result, none, mended]) assert.deepEqual(itemsEnded(ran), [3, 2]);
  assert.deepEqual(mended.codePass.withheld, []);
  assert.deepEqual(mended.codePass.triage.map((t) => [t.ref, t.level]), mended.codePass.findings.map((f, at) => [
    { finding: f.id }, at === 1 ? 'high' : 'medium']).concat([[{ question: 'Q1' }, 'medium'], [{ question: 'Q2' }, 'low']]));
});

/** The paid p4, r1 and u06 cases' shape (2026-10-16), in synthetic words: the answer's F1 fails its shape for one
 *  session step whose `path` is '' where it must be null. The repair corrects that step and returns F1 as the same
 *  finding (the same kind, its anchor on the same file and side, its own title), but rewrites every item it was not
 *  asked to correct, puts a new finding second, and drops a question. */
function p4Shape() {
  const said = { step: 'SYNTHETIC the person asked for a parse function.', path: null, side: 'session', startLine: null,
    endLine: null, quote: 'add a parse function' };
  const code = reviewFinding().trace[0];
  const rule = reviewFinding({ kind: 'rule_break', lens: 'rules', title: 'SYNTHETIC parse gains a positional parameter',
    trace: [{ ...said, path: '' }, code] });
  const missed = reviewFinding({ kind: 'missed_case', lens: 'tests', title: 'SYNTHETIC only the false case is tested' });
  const note = { path: 'src/parse.js', what: 'SYNTHETIC splits the input on commas', asks: [ASK] };
  const answer = { findings: [rule, missed], questions: [QUESTION, { ...QUESTION, question: 'SYNTHETIC lint?' }],
    triage: [entry('F1', { label: 'signature rule broken' }), entry('F2', { level: 'low', label: 'test other values' }),
      entry('Q1', { level: 'medium', label: 'decide' })],
    files: [note] };
  const fixed = { ...rule, title: 'SYNTHETIC parse takes a second positional argument', trace: [said, code] };
  const reply = { findings: [fixed, reviewFinding({ kind: 'contract_break', lens: 'contracts',
    title: 'SYNTHETIC the README promises more' }), { ...missed, title: 'SYNTHETIC rewritten by the repair' }],
  questions: [{ ...QUESTION, question: 'SYNTHETIC a question the repair rewrote?' }],
  triage: [entry('F1', { impact: 'SYNTHETIC the impact the repair wrote.', label: 'avoid the new argument' }),
    entry('F2', { level: 'medium', label: 'fix the README claim' }), entry('Q1', { level: 'low', label: 'rewritten' }),
    entry(UNASKED, { level: 'low', label: 'the split' })],
  files: [{ ...note, what: 'SYNTHETIC a note the repair rewrote' }] };
  return { rule, missed, fixed, answer, reply };
}

test('triage (a paid run, 2026-10-16): a repair that returns the failing finding at its place mends it, though it rewrote the rest — every other item and note keeps the answer\'s version', async () => {
  const { rule, missed, fixed, answer, reply } = p4Shape();
  const seen = [];
  const result = await run(agents({ seen, review: () => answer, repair: () => reply }));
  assert.deepEqual(labels(seen), ['code-review:agent', 'code-review:repair', 'code-verify:F1', 'code-verify:F2',
    'code-verify:batch']);
  assert.match(seen[1].prompt, /^- findings\[0\]: value_outside_list .* at findings\[0\]\.trace\[0\]\.path$/m);
  assert.doesNotMatch(seen[1].prompt.slice(seen[0].prompt.length), /^- (findings\[1\]|questions|triage|files)/m);
  const { codePass } = result;
  // F1 is the repair's version; F2 and both questions are the answer's, whatever the repair did with them.
  assert.deepEqual(codePass.findings.map((f) => [f.kind, f.title]), [['rule_break', fixed.title],
    ['missed_case', missed.title]]);
  assert.deepEqual(codePass.questions.map((q) => q.question), answer.questions.map((q) => q.question));
  assert.deepEqual(codePass.withheld, []);
  // F1's entry is the repair's, written for the finding now published; every other entry and the file note are the
  // answer's. The repair's entry for a key the answer gave no entry for is not taken.
  const [f1, f2] = codePass.findings;
  assert.deepEqual(codePass.triage.map((t) => [t.ref, t.level, t.impact, t.label]), [
    [{ finding: f1.id }, 'high', 'SYNTHETIC the impact the repair wrote.', 'avoid the new argument'],
    [{ finding: f2.id }, 'low', entry('F2').impact, 'test other values'],
    [{ question: 'Q1' }, 'medium', entry('Q1').impact, 'decide']]);
  assert.deepEqual([codePass.triageDropped, codePass.filesDropped], [[], []]);
  assert.equal(codePass.files.find((f) => f.path === 'src/parse.js').what, answer.files[0].what);
  // Without the repair's entry for F1, the answer's stays with F1: the same finding, by its kind, file and side.
  const kept = await run(agents({ review: () => answer, repair: () => ({ ...reply, triage: reply.triage.slice(1) }) }));
  assert.deepEqual(kept.codePass.triage[0].label, 'signature rule broken');
  // Its entry for F1 fails whole: the answer's stays.
  const failed = await run(agents({ review: () => answer, repair: () => ({ ...reply,
    triage: [entry('F1', { level: 'urgent' }), ...reply.triage.slice(1)] }) }));
  assert.deepEqual([failed.codePass.triage[0].label, failed.codePass.triageDropped], ['signature rule broken', []]);
  // The step's outcome is the same as a repair that returned only F1 corrected and every other item as it was.
  const exact = await run(agents({ review: () => answer, repair: () => ({ ...answer,
    findings: [fixed, missed], triage: [reply.triage[0], ...answer.triage.slice(1)] }) }));
  const pick = ({ codePass: p }) => [p.findings, p.questions, p.withheld, p.triage, p.triageDropped, p.files,
    p.filesDropped, p.coverage, p.footer, p.calls];
  assert.deepEqual(pick(result), pick(exact));
  // F1's own words would have stayed withheld with its cause had the repair returned another finding at its place.
  const other = await run(agents({ review: () => answer, repair: () => ({ ...reply,
    findings: [reply.findings[1], fixed, missed] }) }));
  assert.deepEqual(other.codePass.withheld.map(({ text, cause, repair }) => [text, cause, repair]),
    [[rule.title, 'value_outside_list', 'different']]);
  assert.deepEqual(other.codePass.findings.map((f) => f.title), [missed.title]);
  assert.deepEqual(other.codePass.triageDropped, [{ key: 'F1', index: 0, cause: 'item_withheld' }]);
  // Each run: every item of the answer ends published, or withheld with its own record.
  for (const ran of [result, kept, failed, exact, other]) assert.deepEqual(itemsEnded(ran), [2, 2]);
});

test('triage: of the repair\'s notes, only the triage entry for an item taken from it is used, whatever the repair did with the others', async () => {
  const note = { path: 'src/parse.js', what: 'SYNTHETIC splits the input on commas', asks: [ASK] };
  const notes = { triage: [entry('F1'), entry('Q1', { level: 'low', label: 'decide' }),
    entry('Q2', { level: 'low', label: 'the split question' })], files: [note] };
  // The answer's second question fails its grounding and asks for the one repair; the repair mends it.
  const answer = repairing(notes)();
  const seen = [];
  const same = await run(agents({ seen, review: () => answer, repair: mending(notes) }));
  assert.match(seen[1].prompt, /^- questions\[1\]: /m);
  assert.deepEqual(same.codePass.questions.map((q) => q.question), [QUESTION.question, MENDED_QUESTION.question]);
  assert.deepEqual(same.codePass.withheld, []);
  const pick = ({ codePass: p }) => [p.findings, p.questions, p.withheld, p.triage, p.triageDropped, p.files,
    p.filesDropped, p.coverage, p.footer, p.calls];
  // The triage moved or rewritten, a file note changed or dropped, an entry added: the question is mended all the
  // same, and every note but Q2's entry is the answer's.
  for (const [what, over] of [['triage moved', { triage: [...notes.triage].reverse() }],
    ['F1 and Q1 rewritten', { triage: [entry('F1', { label: 'SYNTHETIC rewritten' }), entry('Q1', { level: 'high' }),
      notes.triage[2]] }],
    ['an entry added', { triage: [...notes.triage, entry(UNASKED)] }],
    ['a file note changed', { files: [{ ...note, what: 'SYNTHETIC splits the input on commas and trims' }] }],
    ['a file note dropped', { files: [] }], ['no triage list', { triage: undefined }]]) {
    const result = await run(agents({ review: () => answer, repair: mending(over) }));
    assert.deepEqual(pick(result), pick(same), what);
  }
  // Q2's entry is the repair's when it passes.
  const rewritten = await run(agents({ review: () => answer, repair: mending({ ...notes,
    triage: [notes.triage[0], notes.triage[1], entry('Q2', { level: 'medium', label: 'decide the split' })] }) }));
  assert.deepEqual(rewritten.codePass.triage.map((t) => [t.ref, t.level, t.label]).at(-1),
    [{ question: 'Q2' }, 'medium', 'decide the split']);
  // An answer that gave no triage list: a repair that brings one gives nothing of it, and still mends the question.
  const bare = { ...answer };
  delete bare.triage;
  const brought = await run(agents({ review: () => bare, repair: mending(notes) }));
  assert.deepEqual([brought.codePass.withheld, brought.codePass.triage], [[], []]);
  assert.deepEqual(brought.codePass.triageDropped, [{ key: null, index: null, cause: 'key_missing' }]);
});

test('triage: on the repair too, an entry that passes whole stands before one kept without a field for the same key', async () => {
  const seven = 'fix the empty input case right now';
  // The answer: Q2, the question the repair mends, with a 7-word label (kept without it), and Q2 again with a level
  // outside the list (dropped). The repair's entry for Q2 passes whole: it takes the place of the one kept in part.
  const review = repairing({ triage: [entry('Q2', { label: seven }), entry('Q2', { level: 'urgent' })] });
  const seen = [];
  const result = await run(agents({ seen, review, repair: mending({ triage: [entry('Q2')] }) }));
  assert.match(seen[1].prompt, /^- triage\[1\]: value_outside_list /m);
  assert.deepEqual(keptFields(result), [{ level: 'high', impact: entry('Q2').impact, action: entry('Q2').action,
    label: 'fix empty input', where: null }]);
  assert.deepEqual(result.codePass.triageDropped, [{ key: 'Q2', index: 1, cause: 'value_outside_list' }]);
  // The repair's entry kept without a field: the answer's entry stands, whole or kept in part.
  for (const first of [entry('Q2'), entry('Q2', { label: seven })]) {
    const stood = await run(agents({ review: repairing({ triage: [first] }), repair: mending({ triage: [entry('Q2',
      { label: 'decide the split', action: 'x'.repeat(TRIAGE_LIMITS.actionChars + 1) })] }) }));
    assert.deepEqual(stood.codePass.triage.map((t) => [t.label, t.action]), [[first.label === seven ? null : first.label,
      entry('Q2').action]]);
  }
  // Both whole: the repair's entry, written for the question now published, takes the answer's place.
  const both = await run(agents({ review: repairing({ triage: [entry('Q2')] }),
    repair: mending({ triage: [entry('Q2', { label: 'decide the split' })] }) }));
  assert.deepEqual([both.codePass.triage.map((t) => t.label), both.codePass.triageDropped], [['decide the split'], []]);
});

test('triage: an entry that fails whole is named once in the repair, by its whole shape, even when its place does not ground either — no request byte moves', async () => {
  // F1: a 7-word label and a place that does not ground (kept without both, so its place is grounded and fails); S4:
  // only the place. The repair names F1 by its label alone, as before the text fields were kept apart, and S4 by its
  // place.
  const seen = [];
  await run(agents({ seen, review: repairing({ triage: [entry('F1', { label: 'fix the empty input case right now',
    where: OFF_PLACE }), entry(UNASKED, { where: OFF_PLACE })] }), repair: refuse }));
  const note = seen[1].prompt.slice(seen[0].prompt.length).split('\n').filter((line) => line.startsWith('- triage['));
  assert.deepEqual(note.map((line) => line.split(' (')[0]), ['- triage[0]: text_over_limit',
    '- triage[1]: quote_ungrounded']);
  assert.match(note[0], / at triage\[0\]\.label$/);
  // The requests' digest, computed with the code of 6430357 (before the text fields were kept apart).
  const digest = sha(enc(JSON.stringify(seen.map((r) => [r.label, r.system ?? null, r.prompt ?? null]))));
  assert.equal(digest, 'e88705a78311b62a1d52c2e1ee8df133c650ba91755e63d05e55f862cd505e9a');
});

test('triage: a repair\'s entry kept without a field, in place of a dropped one, has its place grounded and its key checked', async () => {
  const seven = 'fix the empty input case right now';
  // The answer's entry for Q2, the question the repair mends, is dropped whole (a level outside the list); the repair's
  // has a 7-word label.
  const review = repairing({ triage: [entry('Q2', { level: 'urgent' })] });
  const grounded = await run(agents({ review, repair: mending({ triage: [entry('Q2', { label: seven, where: PLACE })] }) }));
  assert.deepEqual(keptFields(grounded), [{ level: 'high', impact: entry('Q2').impact, action: entry('Q2').action,
    label: null, where: PARSE_QUOTE }]);
  assert.deepEqual(grounded.codePass.triageDropped, [{ key: 'Q2', index: 0, cause: 'text_over_limit', field: 'label' }]);
  // Its place does not ground: kept without it, and recorded so.
  const off = await run(agents({ review, repair: mending({ triage: [entry('Q2', { label: seven, where: OFF_PLACE })] }) }));
  assert.deepEqual(keptFields(off).map((t) => [t.label, t.where]), [[null, null]]);
  assert.deepEqual(off.codePass.triageDropped, [{ key: 'Q2', index: 0, cause: 'text_over_limit', field: 'label' },
    { key: 'Q2', index: 0, cause: 'where_ungrounded' }]);
  // A later entry that stood whole holds the key: the repair's entry kept in part does not take its place, and the
  // first entry is dropped with its own cause.
  const held = await run(agents({ review: repairing({ triage: [entry('Q2', { level: 'urgent' }), entry('Q2')] }),
    repair: mending({ triage: [entry('Q2', { label: seven }), entry('Q2')] }) }));
  assert.deepEqual(keptFields(held).map((t) => t.label), ['fix empty input']);
  assert.deepEqual(held.codePass.triageDropped, [{ key: 'Q2', index: 0, cause: 'value_outside_list' }]);
});
