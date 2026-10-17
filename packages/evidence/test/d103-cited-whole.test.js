// D103 (owner pick 2026-10-17; F5 part 2): every challenge request of a session-only review — the whole-window run and
// the single-pass dossier — shows each result its items cite whole. When whole it would put the request over its bound
// (`requestBoundOf`), the request shows the window's head and tail of it and declares the closed gap
// `result_over_bound`: from the least it can show (each cited result whose whole view is the longer cut), in recorded
// order each one whole that still fits, the rest cut. The rule rests on the cited event ids alone. A batch that cites no
// result the skim cuts is shown the window's evidence as it was, byte for byte. Batches hold fewer items where cited
// results are whole, so calls are added only where a window's bound binds.
//
// Invariants, as tests: cited results whole (whole-window run, dossier, carried and riding-back results) and votes
// verified against what each batch showed; the over-bound fallback, in recorded order, never over the bound, a result
// whose whole view is the shorter never cut; an item that does not fit even so is oversize, never clipped; an item is
// asked alone only when alone it shows a cited result whole, and one that shows none whole shares a batch as before part
// 2, its cut results declared, never beside an item that shows one of them whole (the review of D2); an item asked alone
// never closes the batch being formed, wherever it sits in the order, and a batch keeps every result it shows whole (the
// review of D2's fix); a re-ask joins items by the first ask's start and join rule; a batch's counted bytes are its
// rendered bytes, and only a batch that is sent is rendered; every result a challenge request shows in part is declared
// in that request with its lines and bytes, served lines or not; no batch's bytes move unless it cites a result the skim cuts; through a whole review, an item citing a
// result too large to show whole is still asked and publishes.
//
// Synthetic sessions and judges only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { eventView, byteLength, CITED_VIEWS, SHOWN_GAPS, windowSettingsOf } from '../src/windows.js';
import { planWindowRequests, runReview } from '../src/run-review.js';
import { buildChallengeDossier, challengeEvidenceOf, citedEventIds } from '../src/prompt.js';
import { challengeItems, reviewInputBytes, CHALLENGE_PROFILE, CHALLENGE_DOSSIER_VERSION } from '../src/challenge.js';
import { serveEvidence } from '../src/evidence-requests.js';
import { forbiddenChallengeItem } from '../src/forbidden.js';
import { requestBoundOf, reviewSpeedProfile } from '../src/review-profiles.js';

const blobs = {};
let counter = 0;
const ref = (text) => {
  const key = `d103c${++counter}`;
  blobs[key] = text;
  return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
};
const T1 = { turn: 'T1' };
const ask = (id, text) => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(text), ...T1 });
const said = (id, text) => ({ id, kind: 'commentary', phase: 'final', beforeInvocation: null, text: ref(text), ...T1 });
const run = (id, command) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
  command: ref(command), input: [], changes: [], ...T1 });
const out = (id, invocation, text, over = {}) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result: 'succeeded', exitCode: 0, terminalStatusProven: true, sourceOfResult: 'native',
  output: ref(text), ...T1, ...over });
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const OK = `ok ${'.'.repeat(40)}`;
/** `n` lines of about 53 bytes, `odd` at line `at` (1-based): over twice a Claude Code recording's 12,000-byte skim. */
const long = (n, at, odd, tag = 'line') => Array.from({ length: n }, (_, k) => `${tag} ${k + 1}: ${k + 1 === at ? odd : OK}`)
  .join('\n');
const MIDDLE = 'not ok 7 - FAILS in the middle';
const SUITE = long(1_000, 500, MIDDLE);
const LINT = long(1_000, 500, 'lint warning in the middle', 'lint');
const BUILD = long(600, 300, 'error TS2304 in the middle', 'build');

/** One window: a long suite result whose failure sits in its cut middle, a long lint result no item cites, a failed long
 *  build, and the agent's closing claim. */
function suiteSession(adapter = 'claude') {
  return sessionOf([ask('I1', 'Run the suite, the lint and the build, and tell me.'), run('A1', 'npm test'),
    out('A1-r', 'A1', SUITE), run('A2', 'npm run lint'), out('A2-r', 'A2', LINT), run('A3', 'npm run build'),
    out('A3-r', 'A3', BUILD, { result: 'failed', exitCode: 2 }), said('C1', 'The whole suite passes.')], adapter);
}
/** A session of `events` (built first, so the blobs they wrote are copied). */
const sessionOf = (events, adapter = 'claude') => new Session({ sessionKey: `d103c-${adapter}`, adapter,
  blobs: { ...blobs }, events: events.map((event, sequence) => ({ ...event, sequence })) });
/** The claim: contradicted by the suite's first line, a span the window shows. */
const CLAIM = { text: 'The agent said the suite passes.', stated: receipt('C1', 'commentary', 'The whole suite passes.'),
  contradictedBy: receipt('A1-r', 'observation', `line 1: ${OK}`) };
/** A reply that votes on every item, uncertain: no re-ask follows it. */
const uncertain = (request) => ({ votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'uncertain',
  explanation: 'Synthetic.', receipts: [] })) });
const narrative = (over = {}) => ({ decisions: [], pivots: [], requirements: [], claims: [], ...structuredClone(over) });
/** A challenger that upholds every item, quoting `quote` of the cited result when given, else the item's own receipt. */
const challenger = (seen, quote = null) => async (request) => {
  seen.push(request);
  if (!request.challenge) return narrative({ claims: [CLAIM] });
  return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
    explanation: 'Synthetic.', receipts: [quote ?? item.candidate.contradictedBy ?? item.candidate.stated] })) };
};

/** A window's whole-window challenge evidence as a run takes it (`batchEvidence`): counted by `measure`, rendered by
 *  `shown` only for a batch that is sent, each render recorded in `rendered` (its keys and its cut). */
function providerOf(s, built, { served = null, rendered = [] } = {}) {
  const of = challengeEvidenceOf({ session: s, window: built.window, context: built.context, settings: built.settings,
    aliases: built.aliases, served });
  return { of, rendered, batchEvidence: { measure: of.measure, shown: (list, cut) => {
    rendered.push({ keys: list.map((item) => item.key).join(','), cut: cut ? [...cut].join(',') : '' });
    return { evidence: of.shown(list, cut).evidencePrompt, verifyReceipt: () => ({ ok: false }) };
  } } };
}
/** One run of `items` (one pass) with `batchEvidence` at `maxInputBytes`, every request recorded; `judge` answers each. */
async function askOnce(items, built, batchEvidence, maxInputBytes, judge = uncertain) {
  const sent = [];
  const result = await challengeItems({ items, evidence: built.request.evidencePrompt, batchEvidence,
    verifyReceipt: () => ({ ok: false }), checklist: true, aliases: built.aliases, maxInputBytes, passes: 1,
    requiredSurvivals: 1, judge: async (request) => { sent.push(request); return judge(request); } });
  return { sent, result };
}
/** How many results a request declares cut over its bound. */
const GAP = `(${SHOWN_GAPS.resultOverBound}: `;
const gapsIn = (request) => request.prompt.split(GAP).length - 1;
/** A pivot item whose receipts cite `ids`, in the order given. */
const pivot = (k, ...ids) => ({ key: `pivots:${k}`, type: 'pivot', candidate: { abandoned: `old ${k}`, adopted: `new ${k}`,
  whyAbandoned: 'it failed', receipts: ids.map((id) => receipt(id, 'observation', 'line 1')) } });
/** The planned window of a session (one window). */
const builtOf = (s, options = {}) => {
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only', ...options });
  assert.equal(plan.requests.length, 1, 'premise: one window');
  return { plan, built: plan.requests[0] };
};
/** About 2.2 MB: whole, it is over a session-only request's bound (1,620,000 bytes); its window shows 24,000. */
const HUGE = long(40_000, 20_000, MIDDLE, 'huge');
const BOUND = requestBoundOf(reviewSpeedProfile('m33-lean'), 'session-only', 'claude-cli');

// ---- the whole-window run --------------------------------------------------------------------------------------------

test('D103 the whole-window run shows a cited result whole, and a vote quoting its middle grounds', async () => {
  const s = suiteSession();
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const [built] = plan.requests;
  assert.ok(!built.request.prompt.includes(MIDDLE), 'premise: the window cuts the failing line');
  const seen = [];
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan,
    judge: challenger(seen, receipt(built.aliases.of('A1-r'), 'observation', MIDDLE)) });
  const challenges = seen.filter((request) => request.challenge);
  assert.ok(challenges.length > 0);
  for (const request of challenges) {
    // The cited result whole, in one fence; the uncited lint result still by the skim, its omission line as before.
    assert.ok(request.prompt.includes(`<<<\n${SUITE}\n>>>`), request.label);
    assert.ok(request.prompt.includes(MIDDLE));
    assert.ok(!request.prompt.includes('lint warning in the middle'), 'an uncited result keeps its cut');
    assert.match(request.prompt, /omitted: lines [\d,]+–[\d,]+ of this output, [\d,]+ UTF-8 bytes, are not shown\. Quote/);
    assert.ok(!request.prompt.includes(SHOWN_GAPS.resultOverBound));
  }
  // The vote quotes the middle the batch showed: it counts, and the contradiction is published.
  assert.deepEqual(report.findings.map((f) => [f.kind, f.status]), [['claim_contradicted', 'DECIDE']]);
});

test('D103 a batch that cites no result the skim cuts is shown the window\'s evidence, byte for byte', () => {
  const s = suiteSession();
  const { built } = builtOf(s);
  const { of } = providerOf(s, built);
  assert.equal(of.evidencePrompt, built.request.evidencePrompt);
  // A decision cites its actions, not their results: by the cited event ids, it shows no result whole.
  for (const items of [[], [{ key: 'a', type: 'claim', candidate: { stated: CLAIM.stated } }],
    [{ key: 'b', type: 'decision', candidate: { actions: ['A1', 'A2'] } }]]) {
    const shown = of.shown(items);
    assert.equal(shown.evidencePrompt, built.request.evidencePrompt);
    assert.deepEqual(of.measure(items), { evidenceBytes: byteLength(built.request.evidencePrompt), cited: [] });
    assert.deepEqual(Object.keys(shown.sourceMap).sort(), Object.keys(built.sourceMap).sort());
    for (const id of Object.keys(built.sourceMap)) assert.deepEqual(shown.sourceMap[id], built.sourceMap[id], id);
  }
  // A result at or under twice the skim is whole in the window already: citing it moves nothing.
  const short = sessionOf([ask('I1', 'Run it.'), run('A1', 'npm test'), out('A1-r', 'A1', long(300, 150, MIDDLE)),
    said('C1', 'Done.')]);
  const { built: one } = builtOf(short);
  const cited = providerOf(short, one).of;
  assert.equal(cited.shown([{ key: 'c', type: 'claim', candidate: CLAIM }]).evidencePrompt, one.request.evidencePrompt);
  assert.deepEqual(cited.measure([{ key: 'c', type: 'claim', candidate: CLAIM }]).cited, []);
});

test('D103 a batch\'s counted bytes are its rendered bytes, whole or with any of its cited results cut', () => {
  const s = suiteSession();
  const { built } = builtOf(s);
  const { of } = providerOf(s, built);
  const item = pivot(0, 'A1-r', 'A3-r');
  const counted = of.measure([item]);
  assert.deepEqual(counted.cited.map((r) => r.id), ['A1-r', 'A3-r']);
  for (const cut of [null, ['A1-r'], ['A3-r'], ['A1-r', 'A3-r']]) {
    const set = cut && new Set(cut);
    const less = counted.cited.filter((r) => set?.has(r.id)).reduce((n, r) => n + r.added, 0);
    assert.equal(byteLength(of.shown([item], set).evidencePrompt), counted.evidenceBytes - less, String(cut));
  }
});

// ---- the dossier -----------------------------------------------------------------------------------------------------

test('D103 a single-pass dossier shows the result its item cites whole', async () => {
  const s = suiteSession();
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only', speedProfile: 'm33-lean' });
  const [built] = plan.requests;
  const seen = [];
  const failure = { eventId: built.aliases.of('A3-r'), handling: 'told-human',
    response: receipt(built.aliases.of('C1'), 'commentary', 'The whole suite passes.') };
  await runReview({ session: s, pr: null, reviewScope: 'session-only', plan, speedProfile: 'm33-lean',
    judge: async (request) => {
      seen.push(request);
      if (!request.challenge) return narrative({ failures: [failure] });
      return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
        explanation: 'Synthetic.', receipts: [receipt(item.candidate.eventId ?? 'A3-r', 'observation',
          'error TS2304 in the middle')] })) };
    } });
  const dossiers = seen.filter((request) => request.challenge && request.label.includes(':t1'));
  assert.ok(dossiers.length > 0, 'premise: the failure row is asked in the single-pass run');
  for (const request of dossiers) {
    assert.ok(request.prompt.includes(`<<<\n${BUILD}\n>>>`), 'the cited result whole');
    assert.ok(!request.prompt.includes(MIDDLE), 'an uncited result is not shown in a dossier');
  }
});

test('D103 a dossier\'s cited result: whole, or cut with its gap declared; the bytes it adds are what the request gains', () => {
  const s = suiteSession();
  const [built] = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests;
  const items = [{ key: 'claims:0', type: 'claim', candidate: CLAIM }];
  const args = { session: s, window: built.window, context: built.context, settings: built.settings,
    aliases: built.aliases, items, checklist: true };
  const whole = buildChallengeDossier(args);
  const cut = buildChallengeDossier({ ...args, cut: new Set(['A1-r']) });
  assert.ok(whole.evidencePrompt.includes(`<<<\n${SUITE}\n>>>`));
  assert.deepEqual(whole.sourceMap['A1-r'].map((x) => x.text), [SUITE]);
  assert.deepEqual(whole.cited.map((r) => r.id), ['A1-r']);
  assert.equal(byteLength(whole.evidencePrompt) - byteLength(cut.evidencePrompt), whole.cited[0].added);
  assert.deepEqual(cut.cited, whole.cited);
  // Cut: the window's head and tail, the gap declared between them in its fixed words, nothing quotable across it.
  const view = eventView(s, s.event('A1-r'), built.settings, CITED_VIEWS.overBound);
  const [field] = view.fields;
  assert.equal(field.gap, SHOWN_GAPS.resultOverBound);
  assert.deepEqual(cut.sourceMap['A1-r'].map((x) => x.text), field.spans);
  const omitted = `of this output, ${field.omittedBytes.toLocaleString('en-US')} UTF-8 bytes, are not shown `
    + '(result_over_bound: shown whole, it would put this request over its size bound)';
  assert.ok(cut.evidencePrompt.includes(omitted));
  const head = field.spans.slice(0, field.headCount).join(''), tail = field.spans.slice(field.headCount).join('');
  assert.ok(cut.evidencePrompt.indexOf(head) < cut.evidencePrompt.indexOf(omitted)
    && cut.evidencePrompt.indexOf(omitted) < cut.evidencePrompt.indexOf(tail));
  assert.equal(head + SUITE.slice(head.length, SUITE.length - tail.length) + tail, SUITE, 'partition');
  // A combined (non-checklist) dossier is as it was: no cited result whole.
  const combined = buildChallengeDossier({ ...args, checklist: false });
  assert.ok(!combined.evidencePrompt.includes(MIDDLE));
});

// ---- over the bound ------------------------------------------------------------------------------------------------------

test('D103 over the bound: in recorded order each cited result whole that fits, the rest cut and declared; never over', async () => {
  const s = suiteSession();
  const { built } = builtOf(s);
  const { batchEvidence, of } = providerOf(s, built);
  // One item citing the suite (60 KB) and the build (35 KB) results.
  const item = { key: 'pivots:0', type: 'pivot', candidate: { abandoned: 'the old runner', adopted: 'the new runner',
    whyAbandoned: 'it failed', receipts: [receipt('A1-r', 'observation', `line 1: ${OK}`),
      receipt('A3-r', 'observation', `build 1: ${OK}`)] } };
  const { cited } = of.measure([item]);
  assert.deepEqual(cited.map((r) => r.id), ['A1-r', 'A3-r'], 'in recorded order');
  const [suite, build] = cited;
  assert.ok(suite.added > build.added, 'premise: the suite adds more than the build');
  const base = await askOnce([item], built, batchEvidence, 10_000_000);
  const full = reviewInputBytes(base.sent[0]);
  assert.ok(base.sent[0].prompt.includes(SUITE) && base.sent[0].prompt.includes(BUILD), 'premise: both whole');
  const allCut = full - suite.added - build.added;
  // Room for the suite, not for both: the suite whole, the build cut and declared.
  const first = await askOnce([item], built, batchEvidence, allCut + suite.added + 10);
  assert.equal(first.sent.length, 1);
  assert.ok(reviewInputBytes(first.sent[0]) <= allCut + suite.added + 10);
  assert.ok(first.sent[0].prompt.includes(SUITE));
  assert.ok(!first.sent[0].prompt.includes(BUILD) && gapsIn(first.sent[0]) === 1);
  // Room for the build only: the suite cut (it comes first, and does not fit), the build whole.
  const second = await askOnce([item], built, batchEvidence, allCut + build.added + 10);
  assert.ok(second.sent[0].prompt.includes(BUILD) && !second.sent[0].prompt.includes(SUITE));
  assert.equal(gapsIn(second.sent[0]), 1, 'one gap, the suite\'s');
  // Room for neither: both cut and declared, the request at the bound or under.
  const neither = await askOnce([item], built, batchEvidence, allCut + 10);
  assert.ok(!neither.sent[0].prompt.includes(SUITE) && !neither.sent[0].prompt.includes(BUILD));
  assert.equal(gapsIn(neither.sent[0]), 2);
  assert.ok(reviewInputBytes(neither.sent[0]) <= allCut + 10);
  // Not even cut: oversize, never clipped and never sent; its slot is a check that did not run.
  const none = await askOnce([item], built, batchEvidence, allCut - 1);
  assert.equal(none.sent.length, 0);
  assert.equal(none.result.budgetExhausted, true);
  assert.deepEqual(none.result.rejected.map((r) => r.reason), ['unreviewed_scope']);
});

test('D103 over the bound, the order is the recording\'s, never the order an item lists its receipts in', async () => {
  const s = suiteSession();
  const { built } = builtOf(s);
  const { batchEvidence, of } = providerOf(s, built);
  // The build listed first, the suite second: the suite is still the first recorded.
  const item = pivot(0, 'A3-r', 'A1-r');
  const { cited } = of.measure([item]);
  assert.deepEqual(cited.map((r) => r.id), ['A1-r', 'A3-r']);
  const [suite, build] = cited;
  const full = reviewInputBytes((await askOnce([item], built, batchEvidence, 10_000_000)).sent[0]);
  const bound = full - build.added + 10;
  assert.ok(build.added + 10 < suite.added, 'premise: listed order would show the build whole and cut the suite');
  const { sent } = await askOnce([item], built, batchEvidence, bound);
  assert.ok(sent[0].prompt.includes(SUITE) && !sent[0].prompt.includes(BUILD) && gapsIn(sent[0]) === 1);
});

test('D103 over the bound, a result whose whole view is the shorter is shown whole first, never declared over the bound', async () => {
  // 241 lines of 100 bytes (the last 99): over 24,000 bytes, so the 12,000-byte skim cuts line 121 alone — its omission
  // line is longer than the line, so shown whole the result is the shorter.
  const SMALL = Array.from({ length: 241 }, (_, k) => `s${String(k + 1).padStart(3, '0')} ${'x'.repeat(94)}`).join('\n');
  const s = sessionOf([ask('I1', 'Run both.'), run('A1', 'npm test'), out('A1-r', 'A1', SUITE), run('A4', 'npm run small'),
    out('A4-r', 'A4', SMALL), said('C1', 'Done.')]);
  const { built } = builtOf(s);
  const { batchEvidence, of } = providerOf(s, built);
  assert.ok(!built.request.prompt.includes(SMALL), 'premise: the window cuts it');
  const item = pivot(0, 'A1-r', 'A4-r');
  const [suite, small] = of.measure([item]).cited;
  assert.ok(suite.added > 0 && small.added < -10, `premise: ${small.added}`);
  const full = reviewInputBytes((await askOnce([item], built, batchEvidence, 10_000_000)).sent[0]);
  // The least it can show: the suite cut, the small result whole.
  const least = full - suite.added;
  const asked = await askOnce([item], built, batchEvidence, least + 5);
  assert.equal(asked.sent.length, 1, 'asked: whole, the small result keeps the request under its bound');
  assert.ok(asked.sent[0].prompt.includes(`<<<\n${SMALL}\n>>>`) && !asked.sent[0].prompt.includes(SUITE));
  assert.equal(gapsIn(asked.sent[0]), 1, 'only the suite is declared over the bound');
  assert.ok(reviewInputBytes(asked.sent[0]) <= least + 5);
  // One byte under the least: oversize, never sent.
  assert.equal((await askOnce([item], built, batchEvidence, least - 1)).sent.length, 0);
});

test('D103 an item over the bound alone that shows a cited result whole is asked alone; the others share, theirs whole', async () => {
  const s = suiteSession();
  const { built } = builtOf(s);
  const { batchEvidence, of } = providerOf(s, built);
  // The first item cites the suite and the build: alone, it has room for the suite whole, not for both.
  const items = [pivot(0, 'A1-r', 'A3-r'), pivot(1, 'A3-r'), pivot(2)];
  const [suite, build] = of.measure([items[0]]).cited;
  const alone = reviewInputBytes((await askOnce([items[0]], built, batchEvidence, 10_000_000)).sent[0]);
  const bound = alone - build.added + 10;
  const { sent, result } = await askOnce(items, built, batchEvidence, bound);
  assert.deepEqual(sent.map((request) => request.challenge.items.map((item) => item.key).join(',')),
    ['pivots:0', 'pivots:1,pivots:2']);
  assert.ok(sent.every((request) => reviewInputBytes(request) <= bound));
  assert.ok(sent[0].prompt.includes(SUITE) && !sent[0].prompt.includes(BUILD) && gapsIn(sent[0]) === 1);
  assert.ok(sent[1].prompt.includes(BUILD) && gapsIn(sent[1]) === 0);
  assert.equal(result.budgetExhausted, false);
  assert.ok(suite.added > build.added);
});

// The review of D2 (M): an item that cannot be shown even one of its cited results whole gets no batch of its own.
/** `n` long results, each cited by one pivot: about 53 KB each, cut by a Claude Code recording's skim. */
function manyCut(n) {
  const events = [ask('I1', 'Run them all.')];
  for (let k = 1; k <= n; k++) events.push(run(`A${k}`, `npm run job${k}`), out(`A${k}-r`, `A${k}`, long(1_000, 500, `odd ${k}`, `job${k}`)));
  const s = sessionOf([...events, said('C1', 'Done.')]);
  return { s, items: Array.from({ length: n }, (_, k) => pivot(k, `A${k + 1}-r`)) };
}
/** The requests' items, as keys joined per request. */
const keysOf = (sent) => sent.map((request) => request.challenge.items.map((item) => item.key).join(','));

test('D103 an item that can show none of its cited results whole shares a batch, each cut result declared, as before', async () => {
  const { s, items } = manyCut(12);
  const { built } = builtOf(s);
  const { batchEvidence, of } = providerOf(s, built);
  // A bound with room for the twelve, each result cut and declared, and for no item with its result whole.
  const whole = reviewInputBytes((await askOnce(items, built, batchEvidence, 10_000_000)).sent[0]);
  const cut = whole - of.measure(items).cited.reduce((n, result) => n + result.added, 0);
  const bound = cut + 10;
  const alone = await Promise.all(items.map(async (item) =>
    reviewInputBytes((await askOnce([item], built, batchEvidence, 10_000_000)).sent[0])));
  assert.ok(alone.every((bytes) => bytes > bound), 'premise: no item fits with its result whole, even alone');
  const { sent, result } = await askOnce(items, built, batchEvidence, bound);
  assert.deepEqual(keysOf(sent), [items.map((item) => item.key).join(',')], 'one call, as before part 2');
  assert.equal(gapsIn(sent[0]), 12, 'each cut result declared');
  assert.ok(reviewInputBytes(sent[0]) <= bound);
  assert.equal(result.budgetExhausted, false);
  // Before part 2 (the window's evidence, no result whole) the same items took the same number of calls.
  const before = await challengeItems({ items, evidence: built.request.evidencePrompt, verifyReceipt: () => ({ ok: false }),
    checklist: true, aliases: built.aliases, maxInputBytes: bound, passes: 1, requiredSurvivals: 1, judge: uncertain });
  assert.equal(before.plannedCalls, result.plannedCalls);
  // Re-asked, they share a batch the same way.
  const again = await askOnce(items, built, batchEvidence, bound,
    (request) => (request.challenge.reask ? uncertain(request) : { votes: [] }));
  assert.deepEqual(keysOf(again.sent), [keysOf(sent)[0], keysOf(sent)[0]]);
  assert.match(again.sent[1].label, /:reask:p1$/);
  assert.equal(gapsIn(again.sent[1]), 12);
  // At a bound of exactly their bytes with every result cut, the twelve still share one call: the bound is inclusive.
  const exact = await askOnce(items, built, batchEvidence, cut);
  assert.deepEqual(keysOf(exact.sent), keysOf(sent));
  assert.equal(reviewInputBytes(exact.sent[0]), cut);
});

test('D103 in a dossier too, items that can show none of their cited results whole share a batch, each cut declared', async () => {
  // Twelve results of about 320 KB: whole, any one is longer than twelve of them cut.
  const events = [ask('I1', 'Run them all.')];
  for (let k = 1; k <= 12; k++) events.push(run(`A${k}`, `npm run job${k}`), out(`A${k}-r`, `A${k}`, long(6_000, 3_000, `odd ${k}`, `job${k}`)));
  const s = sessionOf([...events, said('C1', 'Done.')]);
  const { built } = builtOf(s);
  const items = Array.from({ length: 12 }, (_, k) => pivot(k, `A${k + 1}-r`));
  const args = { session: s, window: built.window, context: built.context, settings: built.settings,
    aliases: built.aliases, checklist: true };
  const dossier = (list, cut = null) => {
    const d = buildChallengeDossier({ ...args, items: list, cut });
    return { evidence: d.evidencePrompt, cited: d.cited, verifyReceipt: () => ({ ok: false }) };
  };
  const run1 = async (maxInputBytes, judge = uncertain) => {
    const sent = [];
    const result = await challengeItems({ items, evidence: built.request.evidencePrompt, dossier,
      verifyReceipt: () => ({ ok: false }), checklist: true, aliases: built.aliases, maxInputBytes, passes: 1,
      requiredSurvivals: 1, judge: async (request) => { sent.push(request); return judge(request); } });
    return { sent, result };
  };
  const whole = reviewInputBytes((await run1(100_000_000)).sent[0]);
  const bound = whole - buildChallengeDossier({ ...args, items }).cited.reduce((n, result) => n + result.added, 0) + 10;
  const { sent } = await run1(bound);
  assert.deepEqual(keysOf(sent), [items.map((item) => item.key).join(',')], 'one call');
  assert.ok(gapsIn(sent[0]) === 12 && reviewInputBytes(sent[0]) <= bound);
});

/** `pairs` items asked alone and `pairs` that show none whole, alternating (the review of D2's fix, M): every item cites
 *  one shared result too long to show whole beside anything (about 320 KB); each `g` item cites its own medium result
 *  too (about 32 KB), which it shows whole alone. The bound has room for every item at the skim and for one medium
 *  result whole beside them. Results of every size are recorded in any order, so this order is an ordinary one. */
async function alternating(pairs) {
  const events = [ask('I1', 'Run them all.'), run('S', 'npm run shared'), out('S-r', 'S', long(6_000, 3_000, 'odd shared', 'shared'))];
  for (let k = 1; k <= pairs; k++) events.push(run(`M${k}`, `npm run m${k}`), out(`M${k}-r`, `M${k}`, long(600, 300, `odd ${k}`, `m${k}`)));
  const s = sessionOf([...events, said('C1', 'Done.')]);
  const { built } = builtOf(s);
  const { batchEvidence, of } = providerOf(s, built);
  const gs = Array.from({ length: pairs }, (_, k) => pivot(`g${k + 1}`, 'S-r', `M${k + 1}-r`));
  const ns = Array.from({ length: pairs }, (_, k) => pivot(`n${k + 1}`, 'S-r'));
  const items = gs.flatMap((g, k) => [g, ns[k]]);
  const head = items.slice(0, CHALLENGE_PROFILE.maxItemsPerBatch);
  const cited = of.measure(head).cited;
  const whole = reviewInputBytes((await askOnce(head, built, batchEvidence, 100_000_000)).sent[0]);
  const medium = cited.find((result) => result.id === 'M1-r');
  const bound = whole - cited.reduce((n, result) => n + result.added, 0) + medium.added + 10;
  return { s, built, batchEvidence, of, gs, ns, items, bound, medium };
}

/** The calls the rule before the owner's answer of 2026-10-17 planned for `items` (one pass): it asked every item whose
 *  own plan shows a cited result whole alone (`asked`), and batched the others as it would without those (the review
 *  of D2's fix: an item asked alone never closed the batch being formed). Computed from the items' own plans, so it holds
 *  for the old rule's code (measured: 9054303's `challengeItems` gives these counts on every case below). */
async function callsBefore(items, asked, built, batchEvidence, bound) {
  const others = items.filter((item) => !asked.includes(item));
  const shared = others.length ? (await askOnce(others, built, batchEvidence, bound)).result.plannedCalls : 0;
  return shared + asked.length;
}

test('D103 an item asked alone never closes the batch being formed: alternating with items that show none whole', async () => {
  const { built, batchEvidence, gs, ns, items, bound } = await alternating(3);
  const aloneBytes = async (item, max) => reviewInputBytes((await askOnce([item], built, batchEvidence, max)).sent[0]);
  for (const g of gs) assert.ok(await aloneBytes(g, 100_000_000) > bound, 'premise: whole, a g item is over the bound');
  for (const n of ns) assert.ok(await aloneBytes(n, 100_000_000) > bound, 'premise: whole, an n item is over the bound');
  const { sent, result } = await askOnce(items, built, batchEvidence, bound);
  // The n items in one batch, in the place of the first of them. The owner's answer of 2026-10-17: g1 shares it with its
  // own result whole, the one medium result the bound has room for beside them; g2 and g3 fit nowhere else and are asked
  // alone, each with its own result whole. 3 calls, where the rule before the answer made 4.
  assert.deepEqual(keysOf(sent), ['pivots:g1,pivots:n1,pivots:n2,pivots:n3', 'pivots:g2', 'pivots:g3']);
  for (const [at, k] of [[0, 1], [1, 2], [2, 3]]) {
    assert.ok(sent[at].prompt.includes(long(600, 300, `odd ${k}`, `m${k}`)), `g${k} shows its result whole`);
    assert.equal(gapsIn(sent[at]), 1, `the shared result is declared cut, once, beside g${k}`);
  }
  for (const k of [2, 3]) assert.equal(sent[0].prompt.includes(long(600, 300, `odd ${k}`, `m${k}`)), false, `no m${k} there`);
  assert.ok(sent.every((request) => reviewInputBytes(request) <= bound) && result.budgetExhausted === false);
  assert.equal(result.plannedCalls, 3);
  assert.equal(await callsBefore(items, gs, built, batchEvidence, bound), 4, 'the rule before the answer');
  // The n items are batched as they are without the g items: an item asked alone moves no other item's batch.
  assert.deepEqual(keysOf((await askOnce(ns, built, batchEvidence, bound)).sent), ['pivots:n1,pivots:n2,pivots:n3']);
  // Before part 2 (the window's evidence, no result whole) the six took 1 call; the first ask's 3 are the re-ask's.
  const before = await challengeItems({ items, evidence: built.request.evidencePrompt, verifyReceipt: () => ({ ok: false }),
    checklist: true, aliases: built.aliases, maxInputBytes: bound, passes: 1, requiredSurvivals: 1, judge: uncertain });
  assert.equal(before.plannedCalls, 1);
  const again = await askOnce(items, built, batchEvidence, bound,
    (request) => (request.challenge.reask ? uncertain(request) : { votes: [] }));
  assert.deepEqual(keysOf(again.sent.filter((request) => request.challenge.reask)), keysOf(sent));
});

test('D103 twelve items asked alone between twelve that show none whole: fewer calls than the 13 before the answer', async () => {
  const { built, batchEvidence, gs, ns, items, bound } = await alternating(12);
  const { sent, result } = await askOnce(items, built, batchEvidence, bound);
  assert.equal(await callsBefore(items, gs, built, batchEvidence, bound), 13, 'the rule before the answer');
  assert.equal(sent.length, 8);
  assert.equal(result.plannedCalls, 8);
  // The n items still share one batch, which also holds g1 with its own result whole.
  assert.deepEqual(keysOf(sent)[0], [gs[0], ...ns].map((item) => item.key).join(','));
  assert.ok(sent.every((request) => reviewInputBytes(request) <= bound));
  assert.ok(sent.every((request) => gapsIn(request) === 1), 'each declares the shared result cut, once');
  // Every g item shows its own result whole, wherever it is asked.
  for (const [k, g] of gs.entries()) {
    const request = sent.find((r) => r.challenge.items.some((item) => item.key === g.key));
    assert.ok(request.prompt.includes(long(600, 300, `odd ${k + 1}`, `m${k + 1}`)), g.key);
  }
  const before = await challengeItems({ items, evidence: built.request.evidencePrompt, verifyReceipt: () => ({ ok: false }),
    checklist: true, aliases: built.aliases, maxInputBytes: bound, passes: 1, requiredSurvivals: 1, judge: uncertain });
  assert.equal(before.plannedCalls, 2, 'premise: before part 2, two calls (16 items a batch at most)');
});

/** The earlier note's worst case (the review of the integration): `k` items, each citing one shared result too long to
 *  show whole beside anything (about 1 MB) and a result of its own (about 30 KB), at a bound with room for all `k` of
 *  their own results whole beside the shared one cut. Each item is over the bound alone, and alone shows its own result
 *  whole. */
async function sharedAndOwn(k) {
  const events = [ask('I1', 'Run them all.'), run('S', 'npm run shared'),
    out('S-r', 'S', long(20_000, 10_000, 'odd shared', 'shared'))];
  for (let j = 1; j <= k; j++) events.push(run(`M${j}`, `npm run m${j}`), out(`M${j}-r`, `M${j}`, long(600, 300, `odd ${j}`, `m${j}`)));
  const s = sessionOf([...events, said('C1', 'Done.')]);
  const { built } = builtOf(s);
  const { batchEvidence, of } = providerOf(s, built);
  const items = Array.from({ length: k }, (_, j) => pivot(`w${j + 1}`, 'S-r', `M${j + 1}-r`));
  const shared = of.measure(items).cited.find((result) => result.id === 'S-r');
  const bytes = async (list) => reviewInputBytes((await askOnce(list, built, batchEvidence, 100_000_000)).sent[0]);
  // A request holds 16 items at most, so past 16 each further item's own bytes (its item and its result whole, a longer
  // name and longer lines with it: 2,000 bytes of room) are added.
  const most = CHALLENGE_PROFILE.maxItemsPerBatch;
  const each = (await bytes(items.slice(0, 2))) - (await bytes(items.slice(0, 1))) + 2_000;
  const bound = (await bytes(items.slice(0, most))) - shared.added + Math.max(0, k - most) * each + 10;
  return { built, batchEvidence, items, bound };
}

test('D103 the earlier note\'s worst case: items asked alone that one batch shows the same evidence take 1 call, not k', async () => {
  const most = CHALLENGE_PROFILE.maxItemsPerBatch;
  for (const k of [3, 6, 12, most, most + 1]) {
    const { built, batchEvidence, items, bound } = await sharedAndOwn(k);
    for (const [j, item] of items.entries()) {
      const whole = (await askOnce([item], built, batchEvidence, 100_000_000)).sent[0];
      assert.ok(reviewInputBytes(whole) > bound, `premise: k=${k}, whole, item ${j + 1} is over the bound`);
      const alone = (await askOnce([item], built, batchEvidence, bound)).sent[0];
      assert.ok(alone.prompt.includes(long(600, 300, `odd ${j + 1}`, `m${j + 1}`)) && gapsIn(alone) === 1,
        `premise: k=${k}, alone, item ${j + 1} shows its own result whole and the shared one cut`);
    }
    assert.equal(await callsBefore(items, items, built, batchEvidence, bound), k, `k=${k}: the rule before the answer`);
    const { sent, result } = await askOnce(items, built, batchEvidence, bound);
    // One call for up to 16 items; past the item bound, the item that fits in no batch is asked alone.
    const expected = k <= most ? [items.map((item) => item.key).join(',')]
      : [items.slice(0, most).map((item) => item.key).join(','), items[most].key];
    assert.deepEqual(keysOf(sent), expected, `k=${k}`);
    assert.equal(result.plannedCalls, Math.ceil(k / most));
    for (let j = 1; j <= k; j++) {
      const request = sent.find((r) => r.challenge.items.some((item) => item.key === `pivots:w${j}`));
      assert.ok(request.prompt.includes(long(600, 300, `odd ${j}`, `m${j}`)), `k=${k}: m${j} whole`);
    }
    assert.ok(sent.every((request) => gapsIn(request) === 1), `k=${k}: the shared result declared cut, once a request`);
    assert.ok(sent.every((request) => reviewInputBytes(request) <= bound && request.challenge.items.length <= most));
    // Before part 2 (the window's evidence, no result whole) the same items took as many calls as now.
    const before = await challengeItems({ items, evidence: built.request.evidencePrompt, verifyReceipt: () => ({ ok: false }),
      checklist: true, aliases: built.aliases, maxInputBytes: bound, passes: 1, requiredSurvivals: 1, judge: uncertain });
    assert.equal(before.plannedCalls, Math.ceil(k / most), `k=${k}: before part 2`);
  }
});

test('D103 planned calls never rise against the rule before the owner\'s answer: items asked alone, in any order, at any '
  + 'room', async () => {
  // Every order of items asked alone (g) and items that show none whole (n), at bounds with room for 0 to 3 of the
  // medium results whole beside every item at the skim. The rule before the answer: `callsBefore`. An item is asked
  // alone by it when, over the bound whole, alone it shows whole a cited result the skim cuts (fewer gaps declared than
  // it cites results the skim cuts).
  let fewer = 0, cases = 0;
  for (const pairs of [1, 2, 3, 5]) {
    const { built, batchEvidence, of, gs, ns, medium } = await alternating(pairs);
    const orders = { alternate: gs.flatMap((g, k) => [g, ns[k]]), gFirst: [...gs, ...ns], nFirst: [...ns, ...gs],
      paired: gs.flatMap((g, k) => (k % 2 ? [ns[k], g] : [g, ns[k]])) };
    for (const [name, items] of Object.entries(orders)) {
      const head = items.slice(0, CHALLENGE_PROFILE.maxItemsPerBatch);
      const cited = of.measure(head).cited;
      const whole = reviewInputBytes((await askOnce(head, built, batchEvidence, 100_000_000)).sent[0]);
      for (const room of [0, 1, 2, 3]) {
        const bound = whole - cited.reduce((n, result) => n + result.added, 0) + room * medium.added + 10;
        const asked = [];
        for (const item of items) {
          const cuts = of.measure([item]).cited.filter((result) => result.added > 0).length;
          if (reviewInputBytes((await askOnce([item], built, batchEvidence, 100_000_000)).sent[0]) <= bound) continue;
          const alone = (await askOnce([item], built, batchEvidence, bound)).sent;
          if (alone.length === 1 && gapsIn(alone[0]) < cuts) asked.push(item);
        }
        const before = await callsBefore(items, asked, built, batchEvidence, bound);
        const { result } = await askOnce(items, built, batchEvidence, bound);
        assert.ok(result.plannedCalls <= before, `${pairs} ${name} room ${room}: ${result.plannedCalls} > ${before}`);
        cases++;
        if (result.plannedCalls < before) fewer++;
      }
    }
  }
  assert.equal(cases, 64);
  assert.ok(fewer > 0, 'premise: the answer saves calls somewhere');
});

test('D103 an item that shows none whole alone joins only a batch that cuts nothing another item there shows whole', async () => {
  const s = sessionOf([ask('I1', 'Run both.'), run('A1', 'npm test'), out('A1-r', 'A1', SUITE), run('A2', 'npm run build'),
    out('A2-r', 'A2', BUILD), said('C1', 'Done.')]);
  const { built } = builtOf(s);
  const { batchEvidence, of } = providerOf(s, built);
  // The first item cites the suite with words long enough that, alone, it cannot show the suite whole; the second cites
  // the suite too, and can; the third cites the build.
  const wordy = { ...pivot(0, 'A1-r'), candidate: { ...pivot(0, 'A1-r').candidate, whyAbandoned: 'w'.repeat(4_000) } };
  const same = pivot(1, 'A1-r'), other = pivot(2, 'A2-r');
  const [suite] = of.measure([wordy]).cited;
  const [build] = of.measure([other]).cited;
  const aloneOf = async (item) => reviewInputBytes((await askOnce([item], built, batchEvidence, 10_000_000)).sent[0]);
  const wordyAlone = await aloneOf(wordy);
  const bound = (await aloneOf(same)) + 10;
  assert.ok(wordyAlone > bound && wordyAlone - suite.added <= bound, 'premise: alone, the wordy item shows the suite cut');
  const { sent } = await askOnce([wordy, same], built, batchEvidence, bound);
  assert.deepEqual(keysOf(sent), ['pivots:0', 'pivots:1'], 'never one batch: the second shows the suite whole');
  assert.ok(gapsIn(sent[0]) === 1 && !sent[0].prompt.includes(SUITE) && sent[1].prompt.includes(SUITE));
  // Either order: the wordy item never joins a batch that shows the suite whole.
  assert.deepEqual(keysOf((await askOnce([same, wordy], built, batchEvidence, bound)).sent), ['pivots:1', 'pivots:0']);
  // An item citing another result shares the wordy item's batch, with its own result whole.
  const tight = wordyAlone - 1;
  assert.ok(wordyAlone - suite.added + build.added + 1_000 < tight, 'premise: room for the build beside the cut suite');
  const shared = await askOnce([wordy, other], built, batchEvidence, tight);
  assert.deepEqual(keysOf(shared.sent), ['pivots:0,pivots:2']);
  assert.ok(gapsIn(shared.sent[0]) === 1 && shared.sent[0].prompt.includes(BUILD) && !shared.sent[0].prompt.includes(SUITE));
  assert.ok(reviewInputBytes(shared.sent[0]) <= tight);
});

test('D103 a batch keeps every result it shows whole: one that shows none whole never joins it by cutting one', async () => {
  const s = sessionOf([ask('I1', 'Run both.'), run('A1', 'npm test'), out('A1-r', 'A1', SUITE), run('A2', 'npm run build'),
    out('A2-r', 'A2', BUILD), said('C1', 'Done.')]);
  const { built } = builtOf(s);
  const { batchEvidence, of } = providerOf(s, built);
  const bytesOf = async (items) => reviewInputBytes((await askOnce(items, built, batchEvidence, 10_000_000)).sent[0]);
  const words = (item) => ({ ...item, candidate: { ...item.candidate, whyAbandoned: 'w'.repeat(4_000) } });
  const [suite] = of.measure([pivot(0, 'A1-r')]).cited;
  const [build] = of.measure([pivot(0, 'A2-r')]).cited;
  // (1) A batch that took its second item with every result whole (the suite, the first item's) refuses an item that
  // shows none whole and would cut the suite, though the three would fit with it cut.
  const same = pivot(1, 'A1-r'), bare = pivot(2), wordy = words(pivot(0, 'A1-r'));
  const pair = await bytesOf([same, bare]);
  assert.ok(await bytesOf([wordy]) > pair && (await bytesOf([same, bare, wordy])) - suite.added <= pair,
    'premise: alone, the wordy item shows the suite cut; the three would fit with it cut');
  const first = await askOnce([same, bare, wordy], built, batchEvidence, pair);
  assert.deepEqual(keysOf(first.sent), ['pivots:1,pivots:2', 'pivots:0']);
  assert.ok(first.sent[0].prompt.includes(SUITE) && gapsIn(first.sent[0]) === 0, 'the suite stays whole');
  // (2) An item that joined a batch beside a cut result, with its own result whole (the build), keeps it whole: a later
  // item that cuts the build is refused, though the three would fit with both cut.
  const cutsSuite = pivot(3, 'A1-r'), showsBuild = pivot(4, 'A2-r'), cutsBuild = words(pivot(5, 'A2-r'));
  const bound = (await bytesOf([cutsSuite, showsBuild])) - suite.added + 10;
  assert.ok(await bytesOf([cutsSuite]) > bound && (await bytesOf([showsBuild])) <= bound, 'premise: the suite cut alone');
  assert.ok(await bytesOf([cutsBuild]) > bound && (await bytesOf([cutsBuild])) - build.added <= bound, 'premise: the build too');
  assert.ok((await bytesOf([cutsSuite, showsBuild, cutsBuild])) - suite.added - build.added <= bound,
    'premise: the three would fit with both cut');
  const second = await askOnce([cutsSuite, showsBuild, cutsBuild], built, batchEvidence, bound);
  assert.deepEqual(keysOf(second.sent), ['pivots:3,pivots:4', 'pivots:5']);
  assert.ok(second.sent[0].prompt.includes(BUILD) && gapsIn(second.sent[0]) === 1, 'the build whole, the suite cut');
});

test('D103 an item whose plan shows a cited result whole shares a batch where it fits with that result whole', async () => {
  // The owner's answer of 2026-10-17 ("same evidence, fewer calls"). The suite is cited by both; the second item cites
  // the build too, which it shows whole alone. Room for both items with the suite cut and the build whole: one call,
  // where the rule before the answer asked the second alone (2 calls).
  const s = suiteSession();
  const { built } = builtOf(s);
  const { batchEvidence, of } = providerOf(s, built);
  const none = pivot(0, 'A1-r'), gains = pivot(1, 'A1-r', 'A3-r');
  const [suite] = of.measure([gains]).cited;
  const both = reviewInputBytes((await askOnce([none, gains], built, batchEvidence, 10_000_000)).sent[0]);
  const bound = both - suite.added + 10;
  const alone = (await askOnce([gains], built, batchEvidence, bound)).sent[0];
  assert.ok(alone.prompt.includes(BUILD) && gapsIn(alone) === 1, 'premise: alone, it shows the build whole, the suite cut');
  const { sent } = await askOnce([none, gains], built, batchEvidence, bound);
  assert.deepEqual(keysOf(sent), ['pivots:0,pivots:1']);
  assert.ok(sent[0].prompt.includes(BUILD) && !sent[0].prompt.includes(SUITE) && gapsIn(sent[0]) === 1,
    'the same evidence: the build whole, the suite cut and declared');
  assert.ok(reviewInputBytes(sent[0]) <= bound);
  assert.equal(await callsBefore([none, gains], [gains], built, batchEvidence, bound), 2, 'the rule before the answer');
  // Either order: its place in the batch is its place in the fixed order.
  assert.deepEqual(keysOf((await askOnce([gains, none], built, batchEvidence, bound)).sent), ['pivots:1,pivots:0']);
  // One byte less room, and it fits nowhere else: it is asked alone, as before.
  const tight = reviewInputBytes(sent[0]) - 1;
  assert.deepEqual(keysOf((await askOnce([none, gains], built, batchEvidence, tight)).sent), ['pivots:0', 'pivots:1']);
});

test('D103 a result whose whole view is the shorter is no result an item shows whole: such an item shares a batch', async () => {
  // As below: 241 lines of 100 bytes, which the skim cuts at line 121 alone, so whole the result is the shorter.
  const SMALL = Array.from({ length: 241 }, (_, k) => `s${String(k + 1).padStart(3, '0')} ${'x'.repeat(94)}`).join('\n');
  const s = sessionOf([ask('I1', 'Run both.'), run('A1', 'npm test'), out('A1-r', 'A1', SUITE), run('A4', 'npm run small'),
    out('A4-r', 'A4', SMALL), said('C1', 'Done.')]);
  const { built } = builtOf(s);
  const { batchEvidence, of } = providerOf(s, built);
  const item = pivot(0, 'A1-r', 'A4-r'), bare = pivot(1);
  const [suite, small] = of.measure([item]).cited;
  assert.ok(small.added < 0, 'premise: whole, the small result is the shorter');
  const bound = reviewInputBytes((await askOnce([item, bare], built, batchEvidence, 10_000_000)).sent[0]) - suite.added + 10;
  const { sent } = await askOnce([item, bare], built, batchEvidence, bound);
  assert.deepEqual(keysOf(sent), ['pivots:0,pivots:1'], 'one call: the item shows no result whole that the skim cuts');
  assert.ok(sent[0].prompt.includes(`<<<\n${SMALL}\n>>>`) && gapsIn(sent[0]) === 1);
});

test('D103 a re-ask is planned as a first batch is: an item over the bound alone is asked again with its result cut', async () => {
  const s = suiteSession();
  const { built } = builtOf(s);
  const { batchEvidence, of } = providerOf(s, built);
  const item = pivot(0, 'A1-r', 'A3-r');
  const [suite, build] = of.measure([item]).cited;
  const full = reviewInputBytes((await askOnce([item], built, batchEvidence, 10_000_000)).sent[0]);
  const bound = full - build.added + 10;
  // The first reply leaves the item without a vote; its re-ask votes.
  const { sent, result } = await askOnce([item], built, batchEvidence, bound,
    (request) => (request.challenge.reask ? uncertain(request) : { votes: [] }));
  assert.equal(sent.length, 2, 'the slot is asked again');
  assert.match(sent[1].label, /:reask:p1$/);
  assert.ok(sent.every((request) => reviewInputBytes(request) <= bound && request.prompt.includes(SUITE)
    && gapsIn(request) === 1), 'each with the suite whole and the build cut and declared');
  assert.equal(result.reaskCalls, 1);
  assert.equal(result.results[0].votes[0].answered, true);
  assert.ok(suite.added > 0);
});

test('D103 only a batch that is sent is rendered: every other batch is counted, its bytes the rendered ones', async () => {
  // Twelve results, each long, each cited by one item: a run sizes every growing batch, and renders only what it sends.
  const events = [ask('I1', 'Run them all.')];
  for (let k = 1; k <= 12; k++) events.push(run(`A${k}`, `npm run job${k}`), out(`A${k}-r`, `A${k}`, long(600, 300, `odd ${k}`, `job${k}`)));
  const s = sessionOf([...events, said('C1', 'Done.')]);
  const { built } = builtOf(s);
  const items = Array.from({ length: 12 }, (_, k) => pivot(k, `A${k + 1}-r`));
  const { batchEvidence, of, rendered } = providerOf(s, built);
  const whole = reviewInputBytes((await askOnce(items, built, batchEvidence, 10_000_000)).sent[0]);
  assert.equal(rendered.length, 1, 'one batch sent, one render');
  // A bound that holds about four of them a batch.
  const added = of.measure([items[0]]).evidenceBytes - byteLength(built.request.evidencePrompt);
  rendered.length = 0;
  const { sent } = await askOnce(items, built, batchEvidence, whole - 8 * added);
  assert.ok(sent.length >= 3, `premise: split into ${sent.length}`);
  assert.deepEqual(rendered.map((r) => r.keys), sent.map((request) => request.challenge.items.map((i) => i.key).join(',')));
  // Each batch's counted bytes are the request it sent.
  const opening = '# Supplied evidence — untrusted\n';
  for (const request of sent) {
    const list = request.challenge.items;
    const evidence = request.prompt.slice(request.prompt.indexOf(opening) + opening.length,
      request.prompt.indexOf('\n\n# Candidates to challenge\n{'));
    assert.equal(byteLength(evidence), of.measure(list).evidenceBytes, list.map((i) => i.key).join(','));
  }
});

test('D103 fails closed: a batch whose rendered request is over the bound is never sent, first or re-asked', async () => {
  const s = suiteSession();
  const { built } = builtOf(s);
  const { batchEvidence } = providerOf(s, built);
  const item = pivot(0, 'A1-r');
  const full = reviewInputBytes((await askOnce([item], built, batchEvidence, 10_000_000)).sent[0]);
  // A count 1,000 bytes short of what is rendered: the batch is planned, rendered, found over and never sent.
  const short = { measure: (items) => ({ ...batchEvidence.measure(items),
    evidenceBytes: batchEvidence.measure(items).evidenceBytes - 1_000 }), shown: batchEvidence.shown };
  const first = await askOnce([item], built, short, full - 500);
  assert.equal(first.sent.length, 0);
  assert.equal(first.result.budgetExhausted, true);
  assert.deepEqual(first.result.rejected.map((r) => r.reason), ['unreviewed_scope']);
  // A re-ask rendered 1,000 bytes over what was counted: never sent; its slot keeps the first reply's reason.
  let renders = 0;
  const growing = { measure: batchEvidence.measure, shown: (list, cut) => {
    const shown = batchEvidence.shown(list, cut);
    return renders++ === 0 ? shown : { ...shown, evidence: `${shown.evidence}${' '.repeat(1_000)}` };
  } };
  const again = await askOnce([item], built, growing, full + 500,
    (request) => (request.challenge.reask ? uncertain(request) : { votes: [] }));
  assert.equal(again.sent.length, 1, 'the re-ask is not sent');
  assert.equal(again.result.reaskCalls, 0);
  assert.deepEqual(again.result.rejected.map((r) => r.reason), ['unreviewed_scope']);
});

test('D103 a re-ask joins items by the first ask\'s rule: an item asked alone for a result it shows whole stays alone '
  + 'where it fits in no batch', async () => {
  // The suite and the build, and a lint run four times the suite's size.
  const s = sessionOf([ask('I1', 'Run them.'), run('A1', 'npm test'), out('A1-r', 'A1', SUITE), run('A2', 'npm run lint'),
    out('A2-r', 'A2', long(4_000, 2_000, 'lint warning in the middle', 'lint')), run('A3', 'npm run build'),
    out('A3-r', 'A3', BUILD), said('C1', 'Done.')]);
  const { built } = builtOf(s);
  const { batchEvidence, of } = providerOf(s, built);
  // `alone` can show the suite whole, not the build; `none` cannot show the lint run whole; `bare` cites nothing.
  const alone = pivot(0, 'A1-r', 'A3-r'), none = pivot(1, 'A2-r'), bare = pivot(2);
  const [suite, build] = of.measure([alone]).cited;
  const [lint] = of.measure([none]).cited;
  const sizes = async (items) => reviewInputBytes((await askOnce(items, built, batchEvidence, 10_000_000)).sent[0]);
  // Room for the two with the build and the lint run cut, and no more.
  const bound = (await sizes([alone, none])) - build.added - lint.added + 10;
  assert.ok((await sizes([alone])) - build.added <= bound && (await sizes([alone])) > bound, 'premise: alone, the build cut');
  assert.ok((await sizes([none])) > bound && (await sizes([none])) - lint.added <= bound, 'premise: the lint run cut');
  assert.ok(suite.added > 0);
  const first = await askOnce([alone, none, bare], built, batchEvidence, bound);
  assert.deepEqual(keysOf(first.sent), ['pivots:0', 'pivots:1,pivots:2']);
  assert.ok(first.sent[0].prompt.includes(SUITE) && gapsIn(first.sent[0]) === 1 && gapsIn(first.sent[1]) === 1);
  const again = await askOnce([alone, none, bare], built, batchEvidence, bound,
    (request) => (request.challenge.reask ? uncertain(request) : { votes: [] }));
  assert.deepEqual(keysOf(again.sent), [...keysOf(first.sent), ...keysOf(first.sent)]);
  // The owner's answer of 2026-10-17: where a batch has room for it with the result it shows whole, the re-ask holds it
  // there, as the first ask does.
  const wide = (await sizes([alone, none, bare])) - build.added - lint.added + 10;
  const shared = await askOnce([alone, none, bare], built, batchEvidence, wide,
    (request) => (request.challenge.reask ? uncertain(request) : { votes: [] }));
  assert.deepEqual(keysOf(shared.sent), ['pivots:0,pivots:1,pivots:2', 'pivots:0,pivots:1,pivots:2']);
  assert.ok(shared.sent.every((request) => request.prompt.includes(SUITE) && gapsIn(request) === 2));
  assert.equal(shared.result.reaskCalls, 1);
});

// ---- what a challenge request shows: carried, riding back, served ---------------------------------------------------------

test('D103 a carried result and a helper\'s result riding back are shown whole when cited, and their sources are whole', () => {
  const OLD = long(800, 400, 'old failure in the middle', 'old');
  const HELPER = long(700, 350, 'helper failure in the middle', 'helper');
  const s = sessionOf([ask('I0', 'Run the old job.'), run('A0', 'npm run old'),
    out('A0-r', 'A0', OLD, { result: 'failed', exitCode: 1 }), run('H0', 'npm run helper'),
    out('H0-r', 'H0', HELPER, { result: 'failed', exitCode: 1 }), ask('I1', 'Now ask the helper.'), run('A5', 'delegate'),
    out('A5-r', 'A5', 'The helper reported.'), said('C1', 'Done.')]);
  const window = { index: 0, events: ['I1', 'A5', 'A5-r', 'C1'].map((id) => s.event(id)) };
  const context = { parts: [{ childId: null, activeTask: null, activeTaskShown: null, humans: [],
    failures: [{ call: s.event('A0'), result: s.event('A0-r') }], thoughts: [], failuresLeftOut: 0, thoughtsLeftOut: 0 }],
  rideBack: [{ report: 'A5-r', childId: 'h1', failures: [{ call: s.event('H0'), result: s.event('H0-r') }], leftOut: 0 }] };
  const settings = windowSettingsOf('session-only', 'claude-cli', 'claude');
  const of = challengeEvidenceOf({ session: s, window, context, settings });
  assert.ok(!of.evidencePrompt.includes(OLD) && !of.evidencePrompt.includes(HELPER), 'premise: both cut');
  assert.ok(of.evidencePrompt.includes('old 1: ') && of.evidencePrompt.includes('helper 1: '), 'premise: both shown');
  const item = pivot(0, 'A0-r', 'H0-r');
  const shown = of.shown([item]);
  assert.ok(shown.evidencePrompt.includes(`<<<\n${OLD}\n>>>`) && shown.evidencePrompt.includes(`<<<\n${HELPER}\n>>>`));
  assert.deepEqual(shown.sourceMap['A0-r'].map((x) => x.text), [OLD]);
  assert.deepEqual(shown.sourceMap['H0-r'].map((x) => x.text), [HELPER]);
  const counted = of.measure([item]);
  assert.deepEqual(counted.cited.map((r) => r.id), ['A0-r', 'H0-r']);
  assert.equal(counted.evidenceBytes, byteLength(shown.evidencePrompt));
});

test('D103 a cited result cut over the bound beside lines the re-ask served declares each range still not shown, with its bytes', () => {
  const s = suiteSession();
  const { built } = builtOf(s);
  const served = serveEvidence({ session: s, settings: built.settings, aliases: built.aliases, sourceMap: built.sourceMap,
    requests: [{ eventId: 'A1-r', fromLine: 450, throughLine: 460 }], served: {}, maxBytes: 72_000 });
  assert.equal(served.record.served, 1, 'premise: the lines are served');
  const { of } = providerOf(s, built, { served: { byEvent: served.byEvent } });
  const item = pivot(0, 'A1-r');
  const shown = of.shown([item], new Set(['A1-r']));
  const [field] = eventView(s, s.event('A1-r'), built.settings, CITED_VIEWS.overBound).fields;
  const { fromLine, throughLine } = field.omitted;
  assert.ok(fromLine < 450 && throughLine > 460 && !field.omitted.partFrom && !field.omitted.partThrough);
  const lines = SUITE.split('\n');
  const bytesOf = (a, b) => lines.slice(a - 1, b).reduce((n, line) => n + byteLength(line) + 1, 0);
  const omitted = (a, b) => `  omitted: lines ${a.toLocaleString('en-US')}–${b.toLocaleString('en-US')} of this output, `
    + `${bytesOf(a, b).toLocaleString('en-US')} UTF-8 bytes, are not shown (${SHOWN_GAPS.resultOverBound}: shown whole, `
    + 'it would put this request over its size bound). Quote the shown spans only, never across the cut.';
  assert.ok(shown.evidencePrompt.includes(omitted(fromLine, 449)), 'before the served lines');
  assert.ok(shown.evidencePrompt.includes(omitted(461, throughLine)), 'after them');
  assert.ok(shown.evidencePrompt.includes('lines 450–460 of this output, served after the first answer asked for them:'));
  // The two ranges and the served lines are the omitted middle, byte for byte.
  assert.equal(bytesOf(fromLine, 449) + bytesOf(450, 460) + bytesOf(461, throughLine), field.omittedBytes);
  // And the bytes are counted exactly: whole, minus what cutting it saves.
  const counted = of.measure([item]);
  assert.equal(byteLength(shown.evidencePrompt), counted.evidenceBytes - counted.cited[0].added);
  // The window's own evidence (the narrative's served middle) is as it was: no gap, no bytes on its ranges.
  assert.ok(!of.evidencePrompt.includes(SHOWN_GAPS.resultOverBound));
});

test('D103 a forbidden edit names no result by its event id: its dossier shows none whole and cuts none', () => {
  const s = suiteSession();
  const { built } = builtOf(s);
  const item = forbiddenChallengeItem('forbiddenEdits:0', { instruction: receipt('I1', 'instruction', 'Run the suite'),
    violation: receipt('A1', 'action', 'npm test'), breach: 'ran', between: [], choices: ['A3'] }, 'A proposition.');
  const named = [...citedEventIds(item.candidate), ...item.candidate.humanChoicesBetween];
  assert.ok(named.length && named.every((id) => s.event(id)?.kind !== 'observation'), named.join(','));
  const dossier = buildChallengeDossier({ session: s, window: built.window, context: built.context,
    settings: built.settings, aliases: built.aliases, items: [item], wholeCarry: true,
    alsoCited: item.candidate.humanChoicesBetween, checklist: true });
  assert.deepEqual(dossier.cited, []);
  assert.ok(dossier.evidencePrompt.includes('build 1: ') && !dossier.evidencePrompt.includes(BUILD),
    'the chosen action\'s result is shown by the skim');
});

// ---- through a whole review --------------------------------------------------------------------------------------------

/** A recording whose suite result is about 2.2 MB, failed, and the agent's claim that it passed. */
function hugeSession() {
  return sessionOf([ask('I1', 'Run the suite and tell me.'), run('A1', 'npm test'),
    out('A1-r', 'A1', HUGE, { result: 'failed', exitCode: 1 }), said('C1', 'The whole suite passes.')]);
}

test('D103 a claim citing a result too large to show whole is asked with it cut and declared, and publishes', async () => {
  const s = hugeSession();
  const { plan, built } = builtOf(s, { speedProfile: 'm33-lean' });
  assert.ok(byteLength(HUGE) > BOUND, 'premise: whole, it is over the bound');
  const claim = { text: 'The agent said the suite passes.', stated: receipt(built.aliases.of('C1'), 'commentary',
    'The whole suite passes.'), contradictedBy: receipt(built.aliases.of('A1-r'), 'observation', `huge 1: ${OK}`) };
  const seen = [];
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan, speedProfile: 'm33-lean',
    judge: async (request) => {
      seen.push(request);
      if (!request.challenge) return narrative({ claims: [claim] });
      return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
        explanation: 'Synthetic.', receipts: [item.candidate.contradictedBy] })) };
    } });
  const asked = seen.filter((request) => request.challenge);
  assert.equal(asked.length, 3, 'the claim is asked in its three passes');
  for (const request of asked) {
    assert.ok(reviewInputBytes(request) <= BOUND && gapsIn(request) === 1 && !request.prompt.includes(MIDDLE), request.label);
  }
  assert.deepEqual(report.findings.map((f) => [f.kind, f.status]), [['claim_contradicted', 'DECIDE']]);
});

test('D103 a failure row citing a result too large to show whole is asked in its dossier with it cut and declared', async () => {
  const s = hugeSession();
  const { plan, built } = builtOf(s, { speedProfile: 'm33-lean' });
  const failure = { eventId: built.aliases.of('A1-r'), handling: 'told-human',
    response: receipt(built.aliases.of('C1'), 'commentary', 'The whole suite passes.') };
  const seen = [];
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan, speedProfile: 'm33-lean',
    judge: async (request) => {
      seen.push(request);
      if (!request.challenge) return narrative({ failures: [failure] });
      return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
        explanation: 'Synthetic.', receipts: [receipt('A1-r', 'observation', `huge 1: ${OK}`)] })) };
    } });
  const dossiers = seen.filter((request) => request.challenge && request.label.includes(':t1'));
  assert.equal(dossiers.length, 1, 'the failure row is asked once, in its dossier');
  assert.ok(reviewInputBytes(dossiers[0]) <= BOUND && gapsIn(dossiers[0]) === 1);
  const [window] = report.windowResults;
  const row = window.challenge.results.find((result) => result.type === 'failure');
  assert.deepEqual(row.votes.map((vote) => [vote.answered, vote.valid, vote.verdict]), [[true, true, 'not-refuted']]);
  assert.equal(window.challenge.budgetExhausted, false);
});

// ---- versions ---------------------------------------------------------------------------------------------------------

test('D103 the challenge and dossier versions moved once each', () => {
  assert.equal(CHALLENGE_PROFILE.version, 'sonah.challenge/45');
  assert.equal(CHALLENGE_DOSSIER_VERSION, 'sonah.challenge-dossier/15');
});
