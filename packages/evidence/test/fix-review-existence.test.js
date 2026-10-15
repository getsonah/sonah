// The review of the W1-W3 fixes (2026-10-14), its finding on W1 A: code cannot tell whether a refuted decision was
// refuted on who decided it or on its existence, so every refuted decision that names who decided it goes to a fresh
// existence check — which saw the choice without the refuting votes and, in m33-lean (the default CLI profile), ran
// once on a dossier. A decision the first check refuted on its existence could come back ("could not tell") because a
// weaker second check disagreed. Now the existence check is shown what each refuting vote said (REFUTING_VOTES, with
// DECISION_EXISTENCE_NOTE), and it is unanimous across as many passes as the decision's own check used, never fewer
// than the decide tier's: every pass must uphold it. Every recording here is synthetic; no model is called — the
// judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, humanAsk, said, call, result } from './m33-u-unasked-fixture.js';
import { runReview } from '../src/run-review.js';
import { RESOLUTION_CHALLENGE_OUTCOMES } from '../src/ledger.js';
import { CHALLENGE_PROFILE, DECISION_NOTE, DECISION_EXISTENCE_NOTE, REFUTING_VOTES, SESSION_DOSSIER_NOTE,
  checklistSystem } from '../src/challenge.js';
import { textBeforeFixReview } from './m33-integration-fixture.js';
import { CHALLENGE_TIER_BOUNDS } from '../src/review-profiles.js';

const ASK = 'Fix greet.js so empty names give a friendly greeting.';
const CODE = 'return name || "guest"';
const rows = () => [
  humanAsk(ASK),
  call('t1', 'Edit', { file_path: '/repo/greet.js', old_string: 'return name', new_string: CODE }),
  result('t1', 'The file /repo/greet.js has been updated.', { filePath: '/repo/greet.js', oldString: 'return name',
    newString: CODE, originalFile: 'return name\n', structuredPatch: [] , userModified: false, replaceAll: false }),
  said('Fixed greet.js: an empty name now gets "guest".'),
].map((r, i) => ({ ...r, uuid: `u-frex-${i + 1}` }));
const quote = (eventId, role, text) => ({ eventId, role, quote: text });
const REFUTATION = 'The cited edit does not adopt this choice: SYNTHETIC_FREX_REFUTATION.';
const decision = (n) => ({ dimension: 'empty-name greeting', chosen: 'greet an empty name as "guest"', value: '"guest"',
  valueReceipt: { eventId: n.edit.id, field: 'added-code', role: 'code', quote: CODE }, actions: [n.edit.id],
  constrainedBy: { instruction: quote(n.ask.id, 'instruction', 'empty names give a friendly greeting'), settles: true,
    settledValueQuote: 'a friendly greeting' } });
const narrative = (decisions) => ({ requirements: [], claims: [], pivots: [], decisions });
const counts = (set = {}) => Object.fromEntries(RESOLUTION_CHALLENGE_OUTCOMES.map((o) => [o, set[o] ?? 0]));

/** The decision's own check refutes it; the existence check votes `exists(pass)`; the re-ask files no column. */
function judgeOf(n, exists, seen = []) {
  return async (request) => {
    seen.push(request);
    if (request.challenge) {
      const pass = Number(/:p(\d+)$/.exec(request.label)?.[1]);
      return { votes: request.challenge.items.map((item) => {
        const verdict = /:exists/.test(request.label) ? exists(pass) : item.type === 'decision' ? 'refuted' : 'not-refuted';
        return { key: item.key, verdict, explanation: verdict === 'refuted' && !/:exists/.test(request.label) ? REFUTATION
          : 'Synthetic.', receipts: [quote(item.candidate.actions[0], 'code', CODE)] };
      }) };
    }
    if (/:recolumn:/.test(request.label)) return narrative([{ ...decision(n), constrainedBy: null }]);
    return narrative([decision(n)]);
  };
}
async function fixture(t) {
  const { session } = await load(t, rows());
  return { session, ask: session.events.find((e) => e.kind === 'instruction'),
    edit: session.events.find((e) => e.kind === 'invocation') };
}
const review = (n, judge, extra = {}) => runReview({ session: n.session, pr: null, reviewScope: 'session-only', judge,
  ...extra });

test('fix review: the existence check is shown what each refuting vote said, with its own note', async (t) => {
  const n = await fixture(t);
  const seen = [];
  await review(n, judgeOf(n, () => 'not-refuted', seen));
  const exists = seen.filter((request) => request.challenge && /^challenge:w1:exists/.test(request.label));
  assert.ok(exists.length > 0);
  for (const request of exists) {
    const [item] = request.challenge.items;
    assert.ok(!Object.hasOwn(item.candidate, 'constrainedBy'), 'the choice alone');
    // Every refuting vote of the decision's own check (three passes in the standard profile), by the window's aliases.
    assert.equal(item.candidate[REFUTING_VOTES].length, 3);
    for (const vote of item.candidate[REFUTING_VOTES]) {
      assert.equal(vote.explanation, REFUTATION);
      assert.deepEqual(vote.receipts.map((r) => [r.role, r.quote]), [['code', CODE]]);
    }
    assert.ok(request.prompt.includes(REFUTATION));
    assert.ok(!request.prompt.includes(n.edit.id), 'named by the window\'s aliases, as the evidence names events');
    assert.ok(request.system.includes(`${DECISION_NOTE}\n${DECISION_EXISTENCE_NOTE}`), 'its note, after the decision note');
  }
  // No other batch is sent the note or carries the member.
  const others = seen.filter((request) => request.challenge && !/^challenge:w1:exists/.test(request.label));
  assert.ok(others.length > 0);
  assert.ok(others.every((request) => !request.system.includes(DECISION_EXISTENCE_NOTE)
    && !request.prompt.includes(REFUTING_VOTES)));
});

test('fix review: one pass that does not uphold the choice keeps a refuted decision out, in every profile', async (t) => {
  const n = await fixture(t);
  for (const speedProfile of ['standard', 'm33-lean']) {
    for (const [dissent, ended] of [['refuted', 'refuted'], ['uncertain', 'unsettled']]) {
      const seen = [];
      // Two passes uphold that the agent made the choice; the third does not.
      const report = await review(n, judgeOf(n, (pass) => (pass === 3 ? dissent : 'not-refuted'), seen),
        { speedProfile });
      const label = `${speedProfile} ${dissent}`;
      assert.equal(report.decisions.length, 0, `${label}: the decision stays out`);
      assert.deepEqual(report.windowResults[0].recolumn.existence, counts({ [ended]: 1 }), label);
      assert.ok(!seen.some((request) => /:recolumn:/.test(request.label)), `${label}: never re-asked`);
      const profile = report.windowResults[0].recolumnExistsChallenge.profile;
      assert.deepEqual([profile.passes, profile.requiredSurvivals, profile.unanimous],
        [CHALLENGE_TIER_BOUNDS.decide.passes, CHALLENGE_TIER_BOUNDS.decide.passes, true], label);
      const exists = seen.filter((request) => request.challenge && /^challenge:w1:exists/.test(request.label));
      assert.equal(exists.length, CHALLENGE_PROFILE.passes, `${label}: as many passes as the decide tier's`);
      assert.ok(exists.every((request) => !request.system.includes(SESSION_DOSSIER_NOTE)), `${label}: the whole window`);
    }
    // Every pass upholds it: the choice comes back, "could not tell" (its re-ask filed no column).
    const upheld = await review(n, judgeOf(n, () => 'not-refuted'), { speedProfile });
    assert.deepEqual(upheld.decisions.map((d) => d.column), [null], speedProfile);
    assert.deepEqual(upheld.windowResults[0].recolumn.existence, counts({ upheld: 1 }), speedProfile);
  }
});

test('fix review: the existence note is sent only beside an existence item, and renders back to W3\'s system', () => {
  assert.equal(checklistSystem(['decision'], { existence: true }),
    `${checklistSystem(['decision'])}\n${DECISION_EXISTENCE_NOTE}`);
  assert.equal(textBeforeFixReview(checklistSystem(['decision'], { existence: true })), checklistSystem(['decision']));
  assert.ok(DECISION_EXISTENCE_NOTE.includes(`"${REFUTING_VOTES}"`));
});

test('fix review: only the refuting votes are listed — a split check lists its two refutations, never the upholding vote',
  async (t) => {
    const n = await fixture(t);
    const UPHOLDING = 'The cited edit adopts this choice: SYNTHETIC_FREX_UPHOLDING.';
    const seen = [];
    // The decision's own check: passes 1 and 2 refute it, pass 3 upholds it; the existence check upholds the choice.
    const judge = async (request) => {
      seen.push(request);
      if (!request.challenge) return /:recolumn:/.test(request.label) ? narrative([{ ...decision(n), constrainedBy: null }])
        : narrative([decision(n)]);
      const pass = Number(/:p(\d+)$/.exec(request.label)?.[1]);
      const own = !/:exists/.test(request.label);
      return { votes: request.challenge.items.map((item) => {
        const refutes = own && item.type === 'decision' && pass !== 3;
        return { key: item.key, verdict: refutes ? 'refuted' : 'not-refuted',
          explanation: refutes ? REFUTATION : own && item.type === 'decision' ? UPHOLDING : 'Synthetic.',
          receipts: [quote(item.candidate.actions?.[0] ?? n.edit.id, 'code', CODE)] };
      }) };
    };
    const report = await review(n, judge);
    assert.equal(report.windowResults[0].recolumn.refuted, 1, 'the decision\'s own check refuted it, 2 votes to 1');
    const exists = seen.filter((request) => request.challenge && /^challenge:w1:exists/.test(request.label));
    assert.ok(exists.length > 0);
    for (const request of exists) {
      const [item] = request.challenge.items;
      assert.deepEqual(item.candidate[REFUTING_VOTES].map((vote) => vote.explanation), [REFUTATION, REFUTATION]);
      assert.ok(!request.prompt.includes(UPHOLDING), 'the upholding vote is not shown as a refutation');
    }
  });
