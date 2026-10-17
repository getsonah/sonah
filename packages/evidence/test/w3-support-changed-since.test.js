// W3 F1(b) (owner decision 2026-10-13): a support recorded before the claim, with
// in-repository changes recorded between its run and the claim, was refused `stale_run` before any checker saw it,
// whether or not the claim is about that moment or a change could alter what the result shows.
// On the session route it is now asked: its challenge item carries one fixed line under the closed label
// "changed since:" listing those changes (event id and typed path), and CLAIM_NOTE says to vote not-refuted only when
// the words are about the state the result showed when it ran, or no listed change can alter what it shows. How each
// such item ended is counted under the closed counter `staleAsked`. A run, an order or a path code cannot read still
// refuses it, and the combined route, whose challenge is not told so, refuses it as before.
//
// Synthetic sessions and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { supportCheck, changedSinceLine, CHANGED_SINCE_LABEL } from '../src/claims.js';
import { runReview } from '../src/run-review.js';
import { CLAIM_NOTE, CHALLENGE_PROFILE, SESSION_CHALLENGE_CORE } from '../src/challenge.js';
import { SUPPORT_ASKED, RESOLUTION_CHALLENGE_OUTCOMES } from '../src/ledger.js';
import { W2_VERSIONS, W3_VERSIONS, FIX_REVIEW_VERSIONS, CODE_PASS_VERSIONS, CODE_STEP_VERSIONS, CODE_STEP_REVIEW_VERSIONS, CODE_STEP_REREVIEW_VERSIONS, CODE_STEP_THIRD_REVIEW_VERSIONS, VOID_VOTE_REASK_VERSIONS, CLEANUP_VERSIONS, CITED_WHOLE_VERSIONS, textBeforeW3 } from './m33-integration-fixture.js';

const TEXT = {
  ask: 'SYNTHETIC_W3B_ASK: make the suite pass.',
  run: 'npm test',
  out: 'SYNTHETIC_W3B_RUN: 14 passing, 0 failing',
  edited: 'export const parse = (s) => s;\n',
  said: 'SYNTHETIC_W3B_SAID: The new tests failed before the fix.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const ask = { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 };
const said = { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('said'), ...T1 };
const run = [
  { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Bash', operation: 'command', paths: [], command: whole('run'),
    input: [], changes: [], ...T1 },
  { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result: 'succeeded', exitCode: 0,
    terminalStatusProven: true, output: whole('out'), sourceOfResult: 'native', ...T1 }];
const edit = (id, paths, { outside = false, result = 'succeeded' } = {}) => [
  { id, kind: 'invocation', callKey: id, tool: 'edit', operation: 'edit', paths: paths.map((path) => ({ path })),
    command: [], input: [], changes: paths.map((path) => ({ path, before: [], after: whole('edited'), diff: [],
      extent: { chars: TEXT.edited.length, lines: 1, truncated: false, cap: null, recorded: true, redactedLines: 0,
        priorState: 'none' }, ...(outside ? { outsideRepository: true } : {}) })), ...T1 },
  { id: `${id}-r`, kind: 'observation', invocation: id, callKey: id, phase: 'terminal', result,
    terminalStatusProven: true, output: [], sourceOfResult: 'native', ...T1 }];
const sessionOf = (events) => new Session({ sessionKey: 'sess-w3-changed', adapter: 'claude', blobs: { ...TEXT },
  events: events.map((event, sequence) => ({ ...event, sequence })), children: [] });
const claim = { text: 'The agent said the new tests failed before the fix.', stated: { eventId: 'C1', role: 'commentary',
  quote: 'The new tests failed before the fix.' }, supportedBy: { eventId: 'A1-r', role: 'observation',
  quote: '14 passing, 0 failing' } };
const shown = { 'A1-r': [{ role: 'observation', text: TEXT.out }] };
const session = (between) => sessionOf([ask, ...run, ...between, said]);

test('W3 F1(b): on the session route an earlier support with changes since its run passes, with those changes', () => {
  const two = session([...edit('E1', ['src/parse.js']), ...edit('E2', ['src/cli.js', 'README.md'])]);
  assert.deepEqual(supportCheck(two, claim, shown, { checklist: true }), { ok: true,
    receipt: supportCheck(two, claim, shown, { checklist: true }).receipt,
    changedSince: [{ eventId: 'E1', path: 'src/parse.js' }, { eventId: 'E2', path: 'src/cli.js' },
      { eventId: 'E2', path: 'README.md' }] });
  // The combined route refuses it as before.
  assert.equal(supportCheck(two, claim, shown).reason, 'stale_run');
  // A change outside the repository, or one recorded as failed, is no change: nothing to list.
  for (const between of [edit('E1', ['.claude/notes.md'], { outside: true }), edit('E1', ['src/parse.js'], { result: 'failed' })]) {
    const checked = supportCheck(session(between), claim, shown, { checklist: true });
    assert.equal(checked.ok, true);
    assert.equal(checked.changedSince, undefined);
  }
  // A change whose place in the order, or whose path, code cannot read is still stale.
  const unordered = session(edit('E1', ['src/parse.js']));
  delete unordered.event('E1').sequence;
  assert.equal(supportCheck(unordered, claim, shown, { checklist: true }).reason, 'stale_run');
  const pathless = session(edit('E1', ['src/parse.js']));
  delete pathless.event('E1').changes[0].path;
  assert.equal(supportCheck(pathless, claim, shown, { checklist: true }).reason, 'stale_run');
});

test('W3 F1(b): the line is fixed words, the event ids by the window\'s names, each path a JSON string', () => {
  assert.equal(CHANGED_SINCE_LABEL, 'changed since:');
  assert.equal(changedSinceLine([]), null);
  assert.equal(changedSinceLine([{ eventId: 'E1', path: 'src/a.js' }, { eventId: 'E1', path: 'b"\n.js' },
    { eventId: 'E2', path: 'c.js' }], (id) => `X${id}`),
  '  changed since: these changes in the repository were recorded after this result\'s run and before the claim: '
    + 'XE1 "src/a.js", "b\\"\\n.js"; XE2 "c.js".');
  assert.ok(SESSION_CHALLENGE_CORE.includes('and the other labels) is Sonah\'s and never quoted'),
    'the core already says every label outside the fences is Sonah\'s');
});

test('W3 F1(b): CLAIM_NOTE says how to judge it; one version bump, rendered back W2\'s note', () => {
  const note = CLAIM_NOTE.replace(/\s+/g, ' ');
  assert.ok(note.includes('When the item lists changes recorded since the result ("changed since:"), vote not-refuted'
    + ' only when the quoted words are about the state that result showed when it ran, or no listed change can alter what'
    + ' it shows; otherwise refute.'));
  // The fix review moved it once more (FIX_REVIEW_VERSIONS: challenge): a cancelled or stopped result, as a failed one.
  assert.equal(FIX_REVIEW_VERSIONS.challenge.before, W3_VERSIONS.challenge.after);
  // D87 moved it once more (CODE_PASS_VERSIONS: challenge): the code pass's own run; no other request byte moved.
  assert.equal(CODE_PASS_VERSIONS.challenge.before, FIX_REVIEW_VERSIONS.challenge.after);
  // The code step moved it once more (CODE_STEP_VERSIONS: challenge): the code pass's run left challengeItems.

  assert.equal(CODE_STEP_VERSIONS.challenge.before, CODE_PASS_VERSIONS.challenge.after);

  // The review of the code step moved it once more (CODE_STEP_REVIEW_VERSIONS: challenge): no `duplicate`, and a
  // finding's checker sees no agent words.
  assert.equal(CODE_STEP_REVIEW_VERSIONS.challenge.before, CODE_STEP_VERSIONS.challenge.after);
  // The second review of the code step moved it once more (CODE_STEP_REREVIEW_VERSIONS: challenge): a code check's
  // checker sees no word of the agent's in any row.
  assert.equal(CODE_STEP_REREVIEW_VERSIONS.challenge.before, CODE_STEP_REVIEW_VERSIONS.challenge.after);
  // The third review of the code step moved it once more (CODE_STEP_THIRD_REVIEW_VERSIONS: challenge): a code
  // check's checker sees what its row states again.
  assert.equal(CODE_STEP_THIRD_REVIEW_VERSIONS.challenge.before, CODE_STEP_REREVIEW_VERSIONS.challenge.after);

  // The re-ask of a void vote moved it once more (VOID_VOTE_REASK_VERSIONS: challenge): a vote a reply cast that could
  // not be counted is asked again once, naming its cause.
  assert.equal(VOID_VOTE_REASK_VERSIONS.challenge.before, CODE_STEP_THIRD_REVIEW_VERSIONS.challenge.after);
  // Its withdrawal moved it once more (CLEANUP_VERSIONS: challenge): a vote a reply cast that could not be counted
  // stands again, as before /43.
  assert.equal(CLEANUP_VERSIONS.challenge.before, VOID_VOTE_REASK_VERSIONS.challenge.after);
  // D103 moved it once more (CITED_WHOLE_VERSIONS: challenge): a session-only batch shows the results its items cite whole.
  assert.equal(CITED_WHOLE_VERSIONS.challenge.before, CLEANUP_VERSIONS.challenge.after);
  assert.equal(CHALLENGE_PROFILE.version, CITED_WHOLE_VERSIONS.challenge.after);
  assert.equal(W3_VERSIONS.challenge.before, W2_VERSIONS.challenge.after);
  assert.ok(!textBeforeW3(CLAIM_NOTE).includes('changed since:'));
  assert.deepEqual(SUPPORT_ASKED.slice(0, 1), ['staleAsked']);
});

// The fix review (2026-10-14): the unanimity this test names is now exercised — one pass that does not uphold the
// support leaves the claim open (`unsettled`), whatever the other passes vote.
test('W3 F1(b): the support item lists the changes, is judged unanimously, and is counted by how it ended', async () => {
  const answer = { decisions: [], pivots: [], requirements: [], claims: [structuredClone(claim)] };
  const sessionWith = () => session(edit('E1', ['src/parse.js']));
  const review = async (supportVerdict) => {
    const prompts = [];
    const report = await runReview({ session: sessionWith(), pr: null, reviewScope: 'session-only',
      judge: async (request) => {
        if (!request.challenge) return structuredClone(answer);
        prompts.push(request.prompt);
        const pass = Number(/:p(\d+)$/.exec(request.label)?.[1]);
        const verdict = typeof supportVerdict === 'function' ? supportVerdict(pass) : supportVerdict;
        return { votes: request.challenge.items.map((item) => ({ key: item.key,
          verdict: item.key.endsWith(':support') ? verdict : 'not-refuted', explanation: 'Synthetic.',
          receipts: [item.key.endsWith(':support') ? item.candidate.supportedBy : item.candidate.stated] })) };
      } });
    return { report, prompts };
  };
  const upheld = await review('not-refuted');
  const support = upheld.prompts.find((prompt) => prompt.includes(':support (support)'));
  const line = support.split('\n').find((text) => text.startsWith(`  ${CHANGED_SINCE_LABEL}`));
  assert.match(line, /^ {2}changed since: these changes in the repository were recorded after this result's run and before the claim: E\d+ "src\/parse\.js"\.$/);
  assert.ok(!line.includes(' E1 '), 'the event by its alias in the window, never its stable id');
  assert.deepEqual(upheld.report.promises.map((p) => p.status), ['verified']);
  assert.deepEqual(upheld.report.counts.promiseSupport.staleAsked,
    Object.fromEntries(RESOLUTION_CHALLENGE_OUTCOMES.map((outcome) => [outcome, outcome === 'upheld' ? 1 : 0])));
  const refuted = await review('refuted');
  assert.deepEqual(refuted.report.promises.map((p) => p.status), ['open']);
  assert.equal(refuted.report.counts.promiseSupport.staleAsked.refuted, 1);
  // Unanimous: two of the three passes uphold it and one does not — never verified, counted unsettled.
  for (const dissent of ['refuted', 'uncertain']) {
    const split = await review((pass) => (pass === 3 ? dissent : 'not-refuted'));
    assert.deepEqual(split.report.promises.map((p) => p.status), ['open'], dissent);
    assert.equal(split.report.counts.promiseSupport.staleAsked.unsettled, 1, dissent);
  }
  // A support with no change since its run is asked with no such line, and counted under no counter.
  const plain = await runReview({ session: session([]), pr: null, reviewScope: 'session-only', judge: async (request) => (
    !request.challenge ? structuredClone(answer) : { votes: request.challenge.items.map((item) => ({ key: item.key,
      verdict: 'not-refuted', explanation: 'Synthetic.',
      receipts: [item.key.endsWith(':support') ? item.candidate.supportedBy : item.candidate.stated] })) }) });
  assert.equal(plain.counts.promiseSupport.staleAsked.upheld, 0);
});
