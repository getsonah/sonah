// M33 K. The cited-evidence dossier of the "m33-lean" profile's single-pass (`:t1`) challenge run. In place
// of the whole window evidence, each batch of that run is shown: every event an item in the batch cites, in
// full, with each cited invocation's own result and each cited result's invocation; the window's skeleton
// (every instruction and statement in full, every invocation's command, brief and paths — never an uncited
// result or an uncited invocation's written bodies); and the same human-instruction inventory. Its votes
// are verified against exactly what it showed. The DECIDE-bound, resolution and written runs keep the
// whole window evidence, and the standard and m33-fast profiles are unchanged.
//
// Synthetic sessions and judges only: no model call, no recording. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as challenge from '../src/challenge.js';
import * as prompt from '../src/prompt.js';
import * as reviewRun from '../src/run-review.js';
import { windowOfLabel, windowsToReask } from '../../cli/src/session-review.js';
import { TURN_RECEIPTS, TURN_TEXT, ownReceipt, turnNarrative, turnSession } from '../../cli/test/m33-fast-profile-fixture.js';

const LEAN = 'm33-lean';
const TURN = turnSession();
const NOTES_BODY = 'SYNTHETIC_FAST_TURN_STATUS: all replay checks pass.';

/** A judge answering the turn narrative; `verdict(item, request)` is a verdict (the item's first receipt
 *  cited), `{ cite }` for not-refuted citing that receipt, or null to leave the item out. */
function turnJudge(verdict = () => 'not-refuted', seen = []) {
  return async (request) => {
    seen.push(request);
    if (!request.challenge) return turnNarrative();
    return { votes: request.challenge.items.flatMap((item) => {
      const chosen = verdict(item, request);
      if (chosen === null) return [];
      if (typeof chosen === 'object') return [{ key: item.key, verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [chosen.cite] }];
      return [{ key: item.key, verdict: chosen, explanation: 'Synthetic.',
        receipts: chosen === 'uncertain' ? [] : [ownReceipt(item.candidate)] }];
    }) };
  };
}
const review = (speedProfile, verdict, seen = []) => reviewRun.runReview({ session: TURN, pr: null,
  reviewScope: 'session-only', ...(speedProfile ? { speedProfile } : {}), judge: turnJudge(verdict, seen) });
const byLabel = (seen, label) => seen.find((request) => request.label === label);
const plan = () => reviewRun.planWindowRequests({ session: TURN, reviewScope: 'session-only', speedProfile: LEAN }).requests[0];
/** The t1 run's items of the turn window, exactly as the review asks them. M33 C: every claim — the plain
 *  claim `claims:1` included — is asked in the three-pass run over the whole window, never in this one. */
const T1_ITEMS = [
  { key: 'decisions:0', type: 'decision', candidate: turnNarrative().decisions[0] },
  { key: 'pivots:0', type: 'pivot', candidate: turnNarrative().pivots[0] },
  { key: 'requirements:0', type: 'requirement', candidate: turnNarrative().requirements[0] },
];
const dossierOf = (items) => {
  const built = plan();
  // M35: the window's own carried context, settings and aliases, as its request was built with them.
  return prompt.buildChallengeDossier({ session: TURN, window: built.request.window, context: built.context,
    settings: built.settings, aliases: built.aliases, items, checklist: true });
};
/** D71 (S2): a session-only batch lists its keys first, then the evidence, then its candidates. */
const evidenceOf = (request) => request.prompt.slice(request.prompt.indexOf('# Supplied evidence — untrusted\n'),
  request.prompt.lastIndexOf('\n\n# Candidates to challenge\n'));

test('M33 K a lean window\'s single-pass run is sent the dossier; the DECIDE-bound run the whole window', async () => {
  const seen = [];
  const report = await review(LEAN, undefined, seen);
  const once = byLabel(seen, 'challenge:w1:t1:b1:p1');
  assert.ok(once, 'the single-pass run was asked');
  assert.deepEqual(once.challenge.items.map((item) => item.key), T1_ITEMS.map((item) => item.key));
  // Cited in full: the decision's action and its result, the pivot's statements and result, the requirement's
  // instruction; and (skeleton) the plain claim's statement.
  for (const text of [TURN_TEXT.lint, TURN_TEXT.regex, TURN_TEXT.first, TURN_TEXT.switched, TURN_TEXT.plain, TURN_TEXT.ask])
    assert.ok(once.prompt.includes(text), `cited: ${text}`);
  // The skeleton: every statement, every command and path.
  for (const text of [TURN_TEXT.claim, TURN_TEXT.corrected, TURN_TEXT.replay, 'path (role=action): /srv/fast/NOTES.md'])
    assert.ok(once.prompt.includes(text), `skeleton: ${text}`);
  // Never an uncited result's output. D71 (S2): the requirement carries its deliverable (the notes it wrote), so
  // that write is cited — its body and its result in full.
  for (const text of [TURN_TEXT.three, TURN_TEXT.checks, TURN_TEXT.zero])
    assert.ok(!once.prompt.includes(text), `omitted: ${text}`);
  for (const text of [TURN_TEXT.wrote, NOTES_BODY]) assert.ok(once.prompt.includes(text), `cited by the deliverable: ${text}`);
  assert.equal(evidenceOf(once), `# Supplied evidence — untrusted\n${dossierOf(T1_ITEMS).evidencePrompt}`);
  assert.ok(once.system.endsWith(challenge.SESSION_DOSSIER_NOTE));
  assert.equal(once.system, challenge.checklistSystem(['decision', 'pivot', 'requirement'], { dossier: true }));
  // The DECIDE-bound, resolution and written runs keep the whole window evidence and today's system prompt — M33 C2:
  // followed by CLAIM_WORDS_NOTE, since each holds a claim-class item; the single-pass dossier run above holds none.
  const whole = plan().request.evidencePrompt;
  for (const label of ['challenge:w1:b1:p1', 'challenge:w1:resolution:b1:p1', 'challenge:w1:written:b1:p1']) {
    const request = byLabel(seen, label);
    assert.ok(request.prompt.includes(whole), label);
    assert.equal(request.system, challenge.checklistSystem(request.challenge.items.map((item) => item.type)), label);
  }
  // The DECIDE-bound run is the m33-fast one, byte for byte.
  const fast = [];
  await review('m33-fast', undefined, fast);
  const [leanBound, fastBound] = [byLabel(seen, 'challenge:w1:b1:p1'), byLabel(fast, 'challenge:w1:b1:p1')];
  assert.deepEqual([leanBound.system, leanBound.prompt], [fastBound.system, fastBound.prompt]);
  // Same outcome as m33-fast on the same answers.
  assert.equal(report.sessionReview, 'complete');
  assert.deepEqual([report.decisions.length, report.pivots.length, report.promises.length, report.requirements.length],
    [1, 1, 1, 1]);
  // Per window, numbers only: the dossier's bytes beside the whole evidence's.
  const [window] = report.windowResults;
  assert.deepEqual(Object.keys(window.dossier).sort(), ['batches', 'dossierBytes', 'evidenceBytes']);
  assert.equal(window.dossier.batches, 1);
  assert.equal(window.dossier.evidenceBytes, Buffer.byteLength(whole, 'utf8'));
  assert.ok(window.dossier.dossierBytes > 0 && window.dossier.dossierBytes < window.dossier.evidenceBytes);
  assert.deepEqual(report.instrument.dossier, { windows: 1, batches: 1, evidenceBytes: window.dossier.evidenceBytes,
    dossierBytes: window.dossier.dossierBytes });
});

test('M33 K standard and m33-fast send no dossier and record none', async () => {
  for (const profile of [null, 'm33-fast']) {
    const seen = [];
    const report = await review(profile, undefined, seen);
    const challenges = seen.filter((request) => request.challenge);
    // D71 (S2): each batch is sent the session core and its own types' notes — CLAIM_WORDS_NOTE when it holds a claim-class
    // item; never a dossier's note.
    assert.ok(challenges.every((request) => request.system
      === challenge.checklistSystem(request.challenge.items.map((item) => item.type))), String(profile));
    assert.ok(challenges.every((request) => !request.system.includes(challenge.SESSION_DOSSIER_NOTE)
      && !request.system.includes(challenge.DOSSIER_NOTE)), String(profile));
    assert.ok(challenges.every((request) => request.prompt.includes(TURN_TEXT.three)), String(profile));
    assert.ok(!Object.hasOwn(report.windowResults[0], 'dossier'), String(profile));
    assert.ok(!Object.hasOwn(report.instrument, 'dossier'), String(profile));
  }
});

test('M33 K the dossier is the window\'s own event format, in session order, with its sourceMap restricted', () => {
  const built = plan();
  const whole = built.request.evidencePrompt;
  const { evidencePrompt, sourceMap } = dossierOf(T1_ITEMS);
  // M35: both name events by the window's aliases.
  const block = (text, id) => {
    const from = text.indexOf(`[${built.aliases.of(id)}] `);
    return from < 0 ? null : text.slice(from, text.indexOf('\n\n', from));
  };
  // A cited or skeleton event's block is exactly the window evidence's block.
  for (const id of ['I1', 'C1', 'A1', 'C2', 'A5', 'A5-r', 'C6', 'A3', 'A2', 'C3', 'C4'])
    assert.equal(block(evidencePrompt, id), block(whole, id), id);
  // D71 (S2): an uncited result keeps its header and typed outcome line only — never its output. The requirement's
  // deliverable cites the write, so the write and its result are shown whole, as the window shows them.
  for (const id of ['A1-r', 'A3-r', 'A2-r']) {
    const [header, outcome, ...rest] = block(evidencePrompt, id).split('\n');
    assert.equal(header, block(whole, id).split('\n')[0], id);
    assert.ok(outcome.startsWith('  outcome: ') && !rest.length, id);
  }
  for (const id of ['W1', 'W1-r']) assert.equal(block(evidencePrompt, id), block(whole, id), id);
  // Session order.
  const at = (id) => evidencePrompt.indexOf(`[${built.aliases.of(id)}] `);
  const order = ['I1', 'C1', 'A1', 'C2', 'A5', 'A5-r', 'C6', 'W1', 'A3', 'A2', 'C3', 'C4'];
  assert.deepEqual([...order].sort((a, b) => at(a) - at(b)), order);
  // The same human block, first, and the same session header, as the window evidence (D71 S2).
  const human = whole.slice(0, whole.indexOf('## The session\n'));
  assert.ok(human.startsWith('## What the human asked') && evidencePrompt.startsWith(`${human}## The session\n`));
  // The sourceMap is what the dossier showed: no uncited result, no uncited written body.
  for (const id of ['A1-r', 'A3-r', 'A2-r']) assert.ok(!Object.hasOwn(sourceMap, id), id);
  for (const id of ['W1', 'W1-r']) assert.deepEqual(sourceMap[id], built.sourceMap[id], id);
  for (const id of ['I1', 'C1', 'A1', 'C2', 'A5', 'A5-r', 'C6', 'C4']) assert.deepEqual(sourceMap[id], built.sourceMap[id], id);
});

test('M33 K a cited invocation brings its result, a cited result its invocation; a cited write keeps its body', () => {
  const decision = { key: 'decisions:0', type: 'decision', candidate: { ...turnNarrative().decisions[0], actions: ['A3'],
    stated: null } };
  const viaAction = dossierOf([decision]).evidencePrompt;
  assert.ok(viaAction.includes(TURN_TEXT.checks), 'the cited action\'s own result');
  const pivot = { key: 'pivots:0', type: 'pivot', candidate: { abandoned: 'x', adopted: 'y', receipts: [TURN_RECEIPTS.fixed] } };
  const viaResult = dossierOf([pivot]);
  assert.ok(viaResult.evidencePrompt.includes(TURN_TEXT.zero), 'the cited result');
  assert.ok(Object.hasOwn(viaResult.sourceMap, 'A2'), 'and its invocation');
  assert.ok(!viaResult.evidencePrompt.includes(TURN_TEXT.three), 'but no other result');
  const written = { key: 'writtenClaims:0', type: 'written', candidate: { text: 't', stated: TURN_RECEIPTS.written,
    contradictedBy: TURN_RECEIPTS.checks } };
  const viaWrite = dossierOf([written]);
  assert.ok(viaWrite.evidencePrompt.includes(NOTES_BODY), 'a cited write in full');
  assert.ok(viaWrite.sourceMap.W1.some((s) => s.role === 'code'));
  assert.ok(viaWrite.evidencePrompt.includes(TURN_TEXT.wrote), 'with its own result');
});

test('M33 K the dossier is deterministic: the same items in any order give the same bytes', () => {
  const one = dossierOf(T1_ITEMS);
  const two = dossierOf([...T1_ITEMS].reverse());
  assert.equal(one.evidencePrompt, two.evidencePrompt);
  assert.deepEqual(one.sourceMap, two.sourceMap);
  assert.equal(dossierOf(T1_ITEMS).evidencePrompt, one.evidencePrompt);
});

test('M33 K a single-pass vote quoting what the dossier omitted is invalid; m33-fast accepts the same vote', async () => {
  // The decision is voted not-refuted on a result nothing cites — shown to m33-fast, never to the dossier.
  const onOmitted = (item) => (item.key === 'decisions:0' ? { cite: TURN_RECEIPTS.checks } : 'not-refuted');
  const lean = await review(LEAN, onOmitted);
  const fast = await review('m33-fast', onOmitted);
  assert.equal(fast.decisions.length, 1, 'the whole window showed that result');
  // S6 (S5 review H1; owner decision D71 b): the dossier did not, so its one vote is invalid and the decision is not
  // settled — kept "could not tell", never with the column its answer proposed.
  assert.deepEqual(lean.decisions.map((d) => [d.columnState, d.reasons[0]]), [['unchecked', 'unsettled']],
    'the dossier did not: its one vote is invalid');
  const result = lean.windowResults[0].challenge.results.find((r) => r.key === 'decisions:0');
  assert.deepEqual(result.votes.map((v) => [v.valid, v.answered]), [[false, true]]);
  // D71 (S2): a written body a batch-mate cites — the requirement's deliverable — is in the dossier, so a quote of it
  // is valid in both profiles.
  const onBody = (item) => (item.key === 'decisions:0' ? { cite: TURN_RECEIPTS.written } : 'not-refuted');
  assert.equal((await review(LEAN, onBody)).decisions.length, 1);
  assert.equal((await review('m33-fast', onBody)).decisions.length, 1);
});

test('M33 K dossier labels stay the window\'s: an incomplete dossier run is forgotten with its window', async () => {
  const seen = [];
  const report = await review(LEAN, (item, request) => (item.key === 'pivots:0' && request.label.includes(':t1:') ? null
    : 'not-refuted'), seen);
  const labels = seen.filter((request) => request.label.includes(':t1:')).map((request) => request.label);
  assert.deepEqual(labels, ['challenge:w1:t1:b1:p1', 'challenge:w1:t1:reask:p1']);
  assert.ok(labels.every((label) => windowOfLabel(label) === 1));
  // The re-ask carries a dossier of its own item alone.
  const reask = byLabel(seen, 'challenge:w1:t1:reask:p1');
  assert.ok(reask.system.endsWith(challenge.SESSION_DOSSIER_NOTE));
  assert.equal(evidenceOf(reask), `# Supplied evidence — untrusted\n${dossierOf([T1_ITEMS[1]]).evidencePrompt}`,
    'the pivot\'s citations only');
  assert.equal(report.windowResults[0].challenge.complete, false);
  assert.deepEqual([...windowsToReask(report.windowResults)], [1]);
});

test('M33 K challengeItems builds one dossier per batch and verifies each batch\'s votes against its own', async () => {
  const items = Array.from({ length: 17 }, (_, i) => ({ key: `decisions:${i}`, type: 'decision', candidate: { n: i } }));
  const built = [];
  const dossier = (list) => {
    const keys = list.map((item) => item.key);
    built.push(keys);
    return { evidence: `DOSSIER ${keys.join(',')}`, verifyReceipt: (receipt) => (keys.includes(receipt.quote)
      ? { ok: true, receipt } : { ok: false }) };
  };
  const seen = [];
  const out = await challenge.challengeItems({ items, evidence: 'SYNTHETIC WINDOW EVIDENCE', verifyReceipt: () => ({ ok: false }),
    passes: 1, requiredSurvivals: 1, dossier, labelPrefix: 'challenge:w1:t1',
    judge: async (request) => { seen.push(request); return { votes: request.challenge.items.map(({ key }) => ({ key,
      verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [{ eventId: 'E1', role: 'observation', quote: key }] })) }; } });
  assert.deepEqual(seen.map((request) => request.label), ['challenge:w1:t1:b1:p1', 'challenge:w1:t1:b2:p1']);
  assert.ok(seen[0].prompt.startsWith(`# Supplied evidence — untrusted\nDOSSIER ${items.slice(0, 16).map((i) => i.key).join(',')}\n`));
  assert.ok(seen[1].prompt.startsWith('# Supplied evidence — untrusted\nDOSSIER decisions:16\n'));
  assert.ok(!seen.some((request) => request.prompt.includes('SYNTHETIC WINDOW EVIDENCE')));
  assert.equal(out.survivors.length, 17, 'each batch\'s votes verified against its own dossier');
  assert.deepEqual(out.dossierBytes, [Buffer.byteLength(`DOSSIER ${items.slice(0, 16).map((i) => i.key).join(',')}`),
    Buffer.byteLength('DOSSIER decisions:16')]);
  // Without a dossier nothing changes: the window evidence, today's system prompt, no byte count.
  const plainRun = await challenge.challengeItems({ items: items.slice(0, 1), evidence: 'SYNTHETIC WINDOW EVIDENCE',
    verifyReceipt: () => ({ ok: true, receipt: {} }), passes: 1, requiredSurvivals: 1,
    judge: async (request) => { seen.push(request); return { votes: [] }; } });
  assert.ok(seen.at(-1).prompt.includes('SYNTHETIC WINDOW EVIDENCE'));
  assert.equal(seen.at(-1).system, challenge.challengeSystem());
  assert.ok(!Object.hasOwn(plainRun, 'dossierBytes'));
  await assert.rejects(challenge.challengeItems({ items: items.slice(0, 1), evidence: 'E', verifyReceipt: () => ({ ok: false }),
    judge: async () => ({ votes: [] }), dossier: () => ({ evidence: 1 }) }), TypeError);
});

test('M33 K an oversize single-pass batch is never sent, so its dossier bytes are not counted', async () => {
  const items = Array.from({ length: 3 }, (_, i) => ({ key: `decisions:${i}`, type: 'decision', candidate: { n: i } }));
  const shown = (list) => (list.some((item) => item.key === 'decisions:1') ? `DOSSIER ${'X'.repeat(40000)}`
    : `DOSSIER ${list.map((item) => item.key).join(',')}`);
  const dossier = (list) => ({ evidence: shown(list), verifyReceipt: () => ({ ok: false }) });
  const seen = [];
  const out = await challenge.challengeItems({ items, evidence: 'SYNTHETIC WINDOW EVIDENCE', verifyReceipt: () => ({ ok: false }),
    passes: 1, requiredSurvivals: 1, dossier, labelPrefix: 'challenge:w1:t1', maxInputBytes: 20000,
    judge: async (request) => { seen.push(request.prompt); return { votes: [] }; } });
  assert.equal(out.plannedBatches, 3);
  assert.equal(out.plannedCalls, 2, 'the oversize singleton is planned, not sent');
  assert.ok(seen.length >= 2 && !seen.some((prompt) => prompt.includes('XXXX')));
  assert.deepEqual(out.dossierBytes, [Buffer.byteLength('DOSSIER decisions:0'), Buffer.byteLength('DOSSIER decisions:2')]);
});
