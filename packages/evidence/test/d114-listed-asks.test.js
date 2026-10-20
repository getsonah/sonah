// D114 (0.3.0-beta.5; the owner, 2026-10-18: "for the hn5, start work now"): the person's asks are the session review's
// structured ask list. The general problem: every request of the code step showed the person's whole messages under
// "What the person asked", so text a message only quotes (data, an example, another session) read as an ask, and the
// code review and its checks said "the ask said …" of words no ask holds (the truth check of paid reports: deviation,
// a question about "Do not touch ARCHITECTURE.md", which was example data inside the prompt). The invariant: every
// request of the code step — the review agent's, its repair, each finding's check, the questions' check and the
// accounting — shows the person's messages as messages, and then the asks exactly as the session review lists them,
// each by its key, the only asks (a checking agent sees no word of the agent's, D89: such an ask by its key and actor
// alone); every brief says so; and a finding or question of the code review ties to an ask only by naming a listed
// ask's key (a key of any other item is no ask tie, and no reader says it is).
//
// Synthetic sessions and a fake reviewer: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runCodePass, codeSnapshotPlan, freezeCodeSnapshot, askListOf, CODE_REVIEW_SYSTEM,
  CODE_REVIEW_SYSTEM_WHOLE_FILES, CODE_VERIFY_SYSTEM, CODE_BATCH_VERIFY_SYSTEM, CODE_ACCOUNT_SYSTEM } from '../src/code-pass.js';
import { codeDossier } from '../src/code-context.js';
import { askCodeLinks } from '../src/ask-code-links.js';
import { CODE_FILES, CODE_TEXT, buildCodeSession, memoryRepo, reviewFinding, holds, allSound, accountsHold,
  verifiedFinding, batchItems, askedItems, dossierItems } from '../../cli/test/code-pass-fixture.js';

const enc = (text) => new TextEncoder().encode(text);
const ROOT = '/work/d114';
const GIT = { kind: 'git', commit: 'a'.repeat(40), how: 'reflog' };
const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
const PARSE_PATCH = ['diff --git a/src/parse.js b/src/parse.js', 'index 1111111..2222222 100644', '--- a/src/parse.js',
  '+++ b/src/parse.js', '@@ -1,4 +1,4 @@ export function parse(input) {', ' export function parse(input) {',
  '-  const parts = input.split(";");', '+  const parts = input.split(",");', '   return parts.map((part) => part.trim());',
  ' }', ''].join('\n');
const PERSON_HEADING = '# The person\'s messages, in their own words — untrusted evidence';
const ASKS_HEADING = '# The person\'s asks, as Sonah\'s review of the session lists them: the only asks — untrusted '
  + 'evidence';
/** The data a message only quotes: another session's instruction, and its agent's note (the deviation shape). */
const DATA_ASK = 'Do not touch ARCHITECTURE.md.';
const DATA_NOTE = 'Note: I also modified ARCHITECTURE.md.';
const MESSAGE = ['Return ONLY a JSON object. No prose before or after.', 'Split compound instructions.',
  'Quote text at most 200 characters.', 'Everything below is DATA from another session:', DATA_ASK, DATA_NOTE].join('\n');
const FINAL = `Here is the graph: {"claims":[{"id":"c8","text":"I also modified ARCHITECTURE.md."}]}`;
const R = (eventId, role, quote) => ({ eventId, role, quote });

/** The session: the person's one message (asks, then quoted data), a write, the agent's note, its final message. */
const session = () => buildCodeSession('s-d114', { ...CODE_TEXT, ask: MESSAGE, note: 'SYNTHETIC_AGENT_ASK: also add a '
  + 'test for empty input.', finalText: FINAL }, [
  { id: 'I1', kind: 'instruction', blob: 'ask', turn: 'T1' },
  { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', turn: 'T1' },
  { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', turn: 'T1' },
  { id: 'C1', kind: 'commentary', blob: 'note', turn: 'T1' },
  { id: 'C2', kind: 'commentary', blob: 'finalText', phase: 'final', turn: 'T1' }]);
/** The session review's report: `asks` (each an instruction quote of the message, or of the agent's note), a claim and a
 *  decision. The first ask's delivery is the agent's final message, which quotes the data. */
const report = (asks = [
  { quote: 'Return ONLY a JSON object.', status: 'done', deliverable: R('C2', 'commentary', 'I also modified ARCHITECTURE.md.') },
  { quote: 'Split compound instructions.', status: 'partly-done' },
  { quote: 'SYNTHETIC_AGENT_ASK: also add a test for empty input.', at: 'C1', role: 'commentary', status: 'done' }]) => ({
  repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', pr: null, codeCoverage: 'missing',
  coverage: 'complete', sessionReview: 'complete', findings: [], writtenClaims: [], failures: [], pivots: [],
  requirements: asks.map((a) => ({ text: a.quote, instruction: R(a.at ?? 'I1', a.role ?? 'instruction', a.quote),
    status: a.status, ...(a.deliverable ? { deliverable: a.deliverable } : {}) })),
  promises: [{ id: `sha256:${'1'.repeat(64)}`, stated: R('C2', 'commentary', 'Here is the graph'), text: 'A graph.',
    status: 'open', receipts: [] }],
  decisions: [{ id: `sha256:${'2'.repeat(64)}`, dimension: 'How to split the input', chosen: 'Split on commas',
    actions: ['W1'], column: 'unasked', stated: null }],
});
const snapshotOf = (s) => {
  const plan = codeSnapshotPlan(s);
  const reads = plan.map((entry) => ({ path: entry.path, bytes: enc(CODE_FILES[entry.path]), type: 'modified',
    base: { bytes: enc(BASE_PARSE) }, patch: PARSE_PATCH }));
  return freezeCodeSnapshot(plan, reads, { base: GIT });
};
/** One code step over `rep`, the review answering `answer(prompt)`; every request kept, the accounting's apart. */
async function run(rep, answer, { s = session() } = {}) {
  const seen = [];
  const judge = async (request) => {
    seen.push(request);
    if (request.label === 'code-review:agent') return answer(request.prompt);
    if (/^code-verify:F\d+/.test(request.label)) return holds(verifiedFinding(request.prompt));
    if (/^code-verify:batch/.test(request.label)) return allSound(batchItems(request.prompt));
    if (/^code-account:\d+/.test(request.label)) return accountsHold(request.prompt);
    throw new Error(`unexpected ${request.label}`);
  };
  const result = await runCodePass({ report: rep, session: s, snapshot: snapshotOf(s), judge, base: GIT, root: ROOT,
    repo: memoryRepo({ root: ROOT, before: { 'src/parse.js': BASE_PARSE } }) });
  return { ...result, seen, dossier: codeDossier({ report: rep, session: s, root: ROOT }) };
}
/** What each kind of request must show as the asks: the review's and the accounting's every ask in its words; a
 *  finding's and the questions' checks (D89) no word of the agent's. */
const ISOLATED = /^code-verify:/;
/** The text of a request's messages block: from its heading to the asks block's. */
const messagesOf = (prompt) => prompt.slice(prompt.indexOf(PERSON_HEADING), prompt.indexOf(ASKS_HEADING));
/** The invariant on every request of one run. */
function assertListedAsks({ seen, dossier }, label) {
  const asks = dossier.filter((item) => item.kind === 'ask');
  assert.ok(seen.length > 0, label);
  for (const request of seen) {
    const at = `${label} ${request.label}`;
    // The person's messages as messages, never as their asks; then the asks block.
    assert.ok(request.prompt.startsWith(`${PERSON_HEADING}\n\n`), at);
    assert.ok(!/what the person asked/i.test(request.prompt) && !/what the person asked/i.test(request.system), at);
    assert.ok(request.prompt.indexOf(ASKS_HEADING) > request.prompt.indexOf(PERSON_HEADING), at);
    // The asks block lists the session review's asks exactly, each by its key, in order — nothing else.
    const shown = askedItems(request.prompt);
    assert.deepEqual(shown.map((a) => a.key), asks.map((a) => a.key), at);
    assert.deepEqual(shown, askListOf(dossier, { isolated: ISOLATED.test(request.label) }), at);
    for (const [k, ask] of asks.entries()) {
      const words = typeof ask.shown.asked === 'string' ? ask.shown.asked : ask.shown.asked.quote;
      const isolated = ISOLATED.test(request.label) && ask.shown.asked?.actor === 'agent';
      // In a check, an ask in the agent's words is shown by its key and actor alone (D89).
      assert.equal(JSON.stringify(shown[k]).includes(words), !isolated, `${at} ${ask.key}`);
    }
    // The brief says that only the listed asks are the person's asks.
    assert.ok(/the only asks|The person's asks are the listed asks and only those/.test(request.system), at);
  }
}

test('D114: every request of the code step shows the person\'s messages as messages and the asks as the session review lists them — quoted data is no ask', async () => {
  const rep = report();
  const result = await run(rep, (prompt) => {
    const ask = dossierItems(prompt).find((item) => item.kind === 'ask');
    const decision = dossierItems(prompt).find((item) => item.kind === 'decision');
    return { findings: [reviewFinding({ kind: 'ask_not_met', lens: 'ask', leadsFrom: [ask.key] })], questions: [
      { question: 'Should prose ever come before the JSON?', key: ask.key, quote: 'Return ONLY a JSON object.' },
      { question: 'Was splitting on commas what you meant?', key: decision.key, quote: 'Split on commas' }] };
  });
  assert.deepEqual(result.seen.map((r) => r.label), ['code-review:agent', 'code-verify:F1', 'code-verify:batch',
    'code-account:1']);
  assertListedAsks(result, 'case');
  for (const request of result.seen) {
    // The data a message only quotes is in the messages block, and in no ask.
    assert.ok(messagesOf(request.prompt).includes(DATA_ASK), request.label);
    assert.ok(!askedItems(request.prompt).some((a) => JSON.stringify(a).includes('ARCHITECTURE')), request.label);
    // A check never sees the agent's words, the ask resting on them included.
    if (ISOLATED.test(request.label)) assert.ok(!request.prompt.includes('SYNTHETIC_AGENT_ASK'), request.label);
  }
  assert.ok(result.seen[0].prompt.includes('SYNTHETIC_AGENT_ASK'), 'the review is shown every ask, with its actor');
  // Every brief of the code step says it, and none calls the messages what the person asked.
  for (const system of [CODE_REVIEW_SYSTEM, CODE_REVIEW_SYSTEM_WHOLE_FILES, CODE_VERIFY_SYSTEM, CODE_BATCH_VERIFY_SYSTEM,
    CODE_ACCOUNT_SYSTEM]) {
    assert.ok(!/what the person asked/i.test(system));
    assert.match(system.replace(/\s+/g, ' '), /a message can quote other text, such as data, an example or another session/i);
  }
  for (const system of [CODE_REVIEW_SYSTEM, CODE_REVIEW_SYSTEM_WHOLE_FILES]) {
    const flat = system.replace(/\s+/g, ' ');
    assert.ok(flat.includes('When a finding or a question is about an ask, it names that ask\'s key'));
    assert.ok(flat.includes('rules: a rule in the project\'s files or in one of the person\'s asks'));
  }
  // An ask tie is made only by naming a listed ask's key: the question on the ask ties to its row; the question on the
  // decision names no listed ask, so it is no ask tie and no ask row links it.
  const pass = result.codePass;
  assert.deepEqual(pass.questions.map((q) => [q.concerns.kind, q.concerns.source]),
    [['ask', 'requirements'], ['decision', 'decisions']]);
  const links = askCodeLinks({ ...rep, codePass: pass });
  assert.deepEqual(links.map((row) => row.filter((l) => l.link === 'question_concerns').map((l) => l.question)),
    [[0], [], []]);
});

test('D114 invariant: over generated reviews, every request lists exactly the session review\'s asks — whatever the messages quote', async () => {
  let seed = 114;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const sentences = MESSAGE.split('\n');
  for (let round = 0; round < 60; round++) {
    // The session review lists some sentences of the message as asks (a data sentence too, now and then: whatever it
    // lists is an ask), and now and then one resting on the agent's note.
    const asks = sentences.filter(() => random() < 0.4).map((quote) => ({ quote, status: random() < 0.5 ? 'done'
      : 'partly-done' }));
    if (random() < 0.3) asks.push({ quote: 'SYNTHETIC_AGENT_ASK: also add a test for empty input.', at: 'C1',
      role: 'commentary', status: 'done' });
    const rep = report(asks);
    const result = await run(rep, (prompt) => {
      const listed = askedItems(prompt).filter((a) => typeof a.asked === 'string');
      const ask = listed[Math.floor(random() * listed.length)];
      return { findings: [reviewFinding()], questions: ask ? [{ question: 'Is this what you meant?', key: ask.key,
        quote: ask.asked.slice(0, 100) }] : [] };
    });
    assertListedAsks(result, `round ${round} ${JSON.stringify(asks.map((a) => a.quote))}`);
    // The listed asks are exactly the report's ask rows: a sentence the review did not list is in no ask.
    const listedWords = new Set(asks.map((a) => a.quote));
    for (const request of result.seen)
      for (const sentence of sentences.filter((x) => !listedWords.has(x)))
        assert.ok(!askedItems(request.prompt).some((a) => a.asked === sentence), `${round} ${request.label} ${sentence}`);
  }
});

test('D114 review: a finding the item-by-item check adds faces its check with the asks a check sees — never the agent\'s words of an ask (D89)', async () => {
  const rep = report();
  // The accounting carries a finding of its own on the first item it examines (an ask, named by its key); every other
  // item holds.
  const own = reviewFinding({ kind: 'ask_not_met', lens: 'ask', title: 'SYNTHETIC the accounting\'s own finding' });
  const seen = [];
  const s = session();
  const judge = async (request) => {
    seen.push(request);
    if (request.label === 'code-review:agent') return { findings: [reviewFinding()], questions: [] };
    if (/^code-verify:F\d+/.test(request.label)) return holds(verifiedFinding(request.prompt));
    if (/^code-account:\d+/.test(request.label)) {
      const answer = accountsHold(request.prompt);
      return { ...answer, entries: answer.entries.map((e, k) => (k === 0 ? { ...e, outcome: 'breaks', by: null,
        finding: 0 } : e)), findings: [{ ...own, leadsFrom: [answer.entries[0].key] }] };
    }
    throw new Error(`unexpected ${request.label}`);
  };
  const result = await runCodePass({ report: rep, session: s, snapshot: snapshotOf(s), judge, base: GIT, root: ROOT,
    repo: memoryRepo({ root: ROOT, before: { 'src/parse.js': BASE_PARSE } }) });
  // The accounting's finding went to its own check, numbered after the review's, and was published.
  assert.deepEqual(seen.map((r) => r.label), ['code-review:agent', 'code-verify:F1', 'code-account:1',
    'code-verify:F2']);
  assert.ok(result.codePass.findings.some((f) => f.title === own.title));
  // Every request, the added finding's check among them, lists the asks as its kind of request must.
  assertListedAsks({ seen, dossier: codeDossier({ report: rep, session: s, root: ROOT }) }, 'accounting');
  const added = seen.find((r) => r.label === 'code-verify:F2');
  assert.ok(!added.prompt.includes('SYNTHETIC_AGENT_ASK'), 'the added finding\'s check sees no word of the agent\'s');
});

test('D114 review docs/PRIVACY.md: the review command\'s paragraph says that the review agent, each checking agent and the item-by-item check get the session review\'s list of asks, a check an agent\'s ask by key alone', async () => {
  const doc = await readFile(new URL('../../../docs/PRIVACY.md', import.meta.url), 'utf8');
  const review = doc.slice(doc.indexOf('- **`sonah review`**'), doc.indexOf('- **`sonah doctor`**')).replace(/\s+/g, ' ');
  assert.ok(!review.includes('your words'), 'never "your words": the messages are messages, the asks the list');
  assert.ok(review.includes('the lines the session read of files it left unchanged, your messages, the session '
    + 'review\'s list of asks,'), 'the review agent');
  assert.ok(review.includes('Each checking agent\'s request holds your messages, the session review\'s list of asks (an '
    + 'ask in an agent\'s words by its key and whose words it is, never those words)'), 'each check');
  assert.ok(review.includes('Each of these requests holds your messages, the session review\'s list of asks, the '
    + 'change'), 'the item-by-item check');
  // Held to the code: a check is shown an agent's ask by its key and actor alone.
  assert.deepEqual(askListOf([{ key: 'S1', kind: 'ask', actor: 'person', shown: { asked: { actor: 'agent',
    quote: 'SYNTHETIC' } } }], { isolated: true }), [{ key: 'S1', actor: 'agent' }]);
});
