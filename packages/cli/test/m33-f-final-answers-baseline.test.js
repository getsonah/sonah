// M33 F (helper final answers). Attaching a helper's FINAL_ANSWER to its hand-off makes the report quotable evidence
// (a RESULT of the hand-off), so the narrative and challenge requests of a window that holds an attributed report
// change: that is intended. No other request byte may change — not for encrypted NEW_TASK / MESSAGE rows, a report
// no hand-off matched by its recorded sender, one two hand-offs could own, or an unknown message type, which are
// counted and declared as gaps, never shown. This pins both against the code BEFORE the change: the base values below
// were computed by running `captureFinalAnswerCases` (evidence/test/m33-f-final-answer-fixture.js, node built-ins
// only) against a `git archive 2e05794` export in a scratch directory, twice there to show they do not depend on the
// temp path. M33 F repair: recomputed there after the fixture was rebuilt to the recorder's header shape (Task name =
// recipient, Sender = author); the base digests did not change (the base reads no header), nor did this tree's.
//
// M33 F placement: a report is now placed where the parent RECEIVED it (its own row), not beside its hand-off. In the
// attributed case the fix report arrived after the notes spawn, so the requests of that window change again — and only
// by that move: the same capture with each report's recorded `turn` removed (which keeps a report beside its hand-off,
// the rule for a ledger written before placement) reproduces the digests pinned before this change, byte for byte.
//
// Synthetic rollouts in a temp directory and a deterministic fake judge: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { runReview, planWindowRequests } from '../../evidence/src/run-review.js';
import { captureCase, windowNarrative } from './m33-fast-profile-fixture.js';
import { captureFinalAnswerCases } from '../../evidence/test/m33-f-final-answer-fixture.js';
import { modulesBeforeRelayRule } from '../../evidence/test/m33-h-relay-rule-fixture.js';
import { modulesBeforeForbiddenEdit, modulesBeforeDisclosureWords } from '../../evidence/test/m33-n-forbidden-edit-fixture.js';
import { modulesBeforeStatusFact } from '../../evidence/test/status-fact-fixture.js';
import { modulesBeforeHedgedClaims } from '../../evidence/test/h3-hedged-claims-fixture.js';
import { withoutIdentity } from '../../evidence/test/stable-ids-fixture.js';
import { modulesBeforeM36Conversation, modulesBeforeW1, modulesBeforeW2, modulesBeforeW3, modulesBeforeFixReview }
  from '../../evidence/test/m33-integration-fixture.js';

/** C-01 event identity (stable event ids): the adapter as it named events before — the same ledger with its recorded
 *  identities taken out, so every event keeps its positional id. Every render-back below adapts through it. */
const positionalSessionFromLedger = (ledger, options) => sessionFromLedger(withoutIdentity(ledger), options);

/** captureFinalAnswerCases on 2e05794 (see the header). */
const BASE_2E05794 = Object.freeze({
  unattached: Object.freeze({ name: 'unattached', windows: 1,
    planned: '06cc989b3b26b008ace996e0f57504f6ef9c60d57849564d49c090c6fa87c359',
    sentCount: 5,
    sentInOrder: 'fa758892c1c484c1159a9feebf43fc89db9a5e534db3bdd46851dcf21b65a165',
    sentSorted: '7fc03eb694ba66a2d12b87b0788d5bb5ff9e0294946f6b88fcc5b427906e36ec',
    labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73',
    windowFailures: '' }),
  attributed: Object.freeze({ name: 'attributed', windows: 1,
    planned: '450421c35e6173536aa9d3048c30a25d227f03cd6d96e41914016a1c3a936348',
    sentCount: 5,
    sentInOrder: '55482a17d113d2ed9e0d532f42c21f757fb7436ab5cfa8de693c110c30ff26b5',
    sentSorted: 'bad8d1f1b1221fb8df9add550f45ddeedb9bc54f4d07bcde0bb8bd427c2310d1',
    labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73',
    windowFailures: '' }),
});
/** The attributed case at 3c70b58, each report placed right after its hand-off: the reports are in the requests. */
const ATTRIBUTED_M33_F_BESIDE = Object.freeze({ name: 'attributed', windows: 1,
  planned: 'e921b422cda63c0b0a170b49a0a26969388300525e7dc6303e208b9f6f6c9888',
  sentCount: 5,
  sentInOrder: '371c5c5dd97e34a8809663a69879fe4e6e1a6ed8a191634ee800417f251a43fe',
  sentSorted: '6ee63c4d8479cc3efb79e8658f82ab0d20d9cc8929d1beeb20a08f7df239699f',
  labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73',
  windowFailures: '' });
/** The same capture on this tree: each report where the parent received it (after both spawns). */
const ATTRIBUTED_M33_F = Object.freeze({ name: 'attributed', windows: 1,
  planned: '868f51a179b41c6111f50a4ae48b96d9365099068021c45d38916e4281181428',
  sentCount: 5,
  sentInOrder: 'c2146e62c37de468ff84d52362c029d3f387c7d1fcf1f7c7542f90952d3e29db',
  sentSorted: 'e17dd43b5d633636d4c759b7ca6a0deab5e2908874551f3dc6110f6d5199c5fe',
  labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73',
  windowFailures: '' });

// M33 C (claims as facts) moved the narrative task text and the challenge system prompt on purpose, so every request
// byte above moved with it (the same convention as MOVED_BY_M33_C in m33-fast-profile-baseline.test.js). The pins
// above stay as history; the same captures on the merged tree (computed twice, identical) are pinned here. What this
// test guards is unchanged: nothing attached moves nothing beyond M33 C's own change, an attributed report moves only
// its window's bytes, and placement alone separates the attributed capture from the one beside its hand-off.
const MOVED_BY_M33_C = Object.freeze({
  unattached: Object.freeze({ name: 'unattached', windows: 1,
    planned: 'b51f77a4bfaafb360094f99a47b847ba4c289b14350dfbecd56b849c95893800',
    sentCount: 5,
    sentInOrder: 'eaa7ae15f0459a9fc68556adf8f0e69379725a6de87a1d50b13fb42626b05e0d',
    sentSorted: '21b9b300180092f822419ca399238d24e6f98a6379ca41adfe41e73d07f99d7a',
    labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73',
    windowFailures: '' }),
  attributed: Object.freeze({ name: 'attributed', windows: 1,
    planned: 'df3ed694393d6413d882754194c52058c4ce1af4f5b1fbceeef91c089770ac5d',
    sentCount: 5,
    sentInOrder: '0da754ee57351c78dbe280284694420ae93b850a17128bbea037097d070546c6',
    sentSorted: '9e23b934f03a1dccdf45dd12cd5c12f3577ee9ae0267411e89275d905e215a7d',
    labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73',
    windowFailures: '' }),
  beside: Object.freeze({ name: 'attributed', windows: 1,
    planned: '9a834f1f1e657dae78458d8fbcb34238f2e38b7f0e8219de4f6bc9eb6a17d7b7',
    sentCount: 5,
    sentInOrder: 'da420f6bbb1dbe054d0bb38cd4f3fd964048154815f48606705d1f2a938c35b7',
    sentSorted: 'f86d9d3a4c9a5a9d93191bb6d772ca0c1c40e402e9311cc7388550f8cdb00ba0',
    labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73',
    windowFailures: '' }),
});

// M33 C2 (`sonah.challenge/9`, the verbatim quote decides) moved the challenge requests of every capture on purpose: a
// batch holding a claim-class item shows each such item's stated quote as `claim` and its narrative text as
// `reviewersReading`, and is sent CLAIM_WORDS_NOTE after the unchanged system prompt. Only `sentInOrder` and
// `sentSorted` moved; rendering every challenge request back as /8 rendered it (no note, candidates as proposed), this
// tree reproduces MOVED_BY_M33_C's three captures byte for byte. The narrative requests (`planned`), the number of
// requests sent, their labels and order, and the window failures did not move. M33 C2 repair (still /9): the same values
// moved again, and only they — code's grounded words and their `context`, and the note naming them; rendered back as /8,
// every capture is still MOVED_BY_M33_C's byte for byte.
const c2 = (capture, sentInOrder, sentSorted) => Object.freeze({ ...capture, sentInOrder, sentSorted });
const MOVED_BY_M33_C2 = Object.freeze({
  unattached: c2(MOVED_BY_M33_C.unattached, 'fcb3277c542162b4e38eea272a8253fa63411ba86286d99f8a8b2e5ba6862d20',
    '6ea506cce213008ad9fbadc6088d33ead667217e5398b4d0c615e0271ce5e332'),
  attributed: c2(MOVED_BY_M33_C.attributed, '06eea626f3534922a9ed76ea88a5939e273d6bc054aa764e0c91a17d244c0ba4',
    '6614cd03f2ab752ea60b39b2a41ef3e37fc573222693644ccb6833f6ddfb7e9e'),
  beside: c2(MOVED_BY_M33_C.beside, '71657d131b28aeb1ae85a25bc8cecdacc8e601dd967eb9177d3fbfdac5c584d8',
    '3cdf918983d8180b81aa7dd37567e1e85f9c0ae19948d5ca59056992ba837da3'),
});

// M33 H's repair (`sonah.narrative/13`, `sonah.challenge/10`: a relay of another agent's report is the passing agent's
// own claim) moved every capture's narrative and challenge requests on purpose, by the relay rule's words alone:
// `planned`, `sentInOrder` and `sentSorted`. Rendered back as /12 and /9 sent them (m33-h-relay-rule-fixture.js), every
// capture is MOVED_BY_M33_C2's byte for byte (the render-back test below). The number of requests sent, their labels and
// order, and the window failures did not move.
const h = (capture, planned, sentInOrder, sentSorted) => Object.freeze({ ...capture, planned, sentInOrder, sentSorted });
const MOVED_BY_M33_H = Object.freeze({
  unattached: h(MOVED_BY_M33_C2.unattached, 'a2a2bed9c7808cecee55d5e6875ebed054e804765212387768421bebc182f98d',
    '126edc93445d569c1727621052963548b4f3658ea1d550299d1cf54be2547736',
    '8129fb311f748a7165319406a90bd52e2417723ae5ecc9685dab8d91e372fa44'),
  attributed: h(MOVED_BY_M33_C2.attributed, '2a711bfed41050cef23790e1c767f7b65c44d3595f60704dc49f6b233ded9638',
    '5d9ed8cb3a510b23b33530233581b16208c0deecc55636428f8b6f50d4d84440',
    '4b6c22b30a5b8e004fe328fc3ac1a8b232796c9417ae765b05f090c4adfbb99f'),
  beside: h(MOVED_BY_M33_C2.beside, 'f10f8f0ae2d30ac818e28deb223676f3afbdb8640261f14d9414f85997ddfc78',
    'd26e9bdf27274f74aa3e5c051615c6f7d20fe81788b21719a871f81de61c9146',
    '93a09ef6a328b74f156b36ed931628df8686e33676b1e846419ad146bffc4105'),
});
// M1: each capture's runner command is a `bash` action, no longer `test` (`tool=bash`):
// every capture's narrative and challenge requests moved again (`planned`, `sentInOrder`, `sentSorted`), at both
// render-back levels; nothing else moved.
const MOVED_BY_M1 = Object.freeze({
  n13: { unattached: { planned: '4aa54ce06215a78d56142a23607222a01863510c798584ef52c4922badd25a03', sentInOrder: '2cb63d07656d3939a5a98b8ff1a6cef6348e0ec7a29e2e76c7591e0e5471923b', sentSorted: '41b0eb98853a2a5adb5d8bbaf566361c9d291ebd65ba6bdb82c4aeb137d4351d' },
    attributed: { planned: '638b964f5f77ed33619713d6076d911206d891b72ee85279c6446ead25c0b04b', sentInOrder: '7696ade43b760f38503639e4dd5b8530480433ab08f43366a3b18b37ce4edbc9', sentSorted: 'ac62a9468caf1817cd82e5f925628bad01598b664310167ff4733d6eb6c67aa6' },
    beside: { planned: '3463055fd7093a26cdb7d03a61848563cd9e5cdeb30ce75cf866b545f6c2cd86', sentInOrder: '534e48e90866248498a64cc718b0d4b60bd8420c1b41af4ed3da3b38aa54b74e', sentSorted: 'a56ec61b96da5dae48ca8a763d67e86be6dad98aad6defe5dce02d8d4c565db2' } },
  n12: { unattached: { planned: '5b298e691159a24f8fa99c38e8f18a18cc5079bc0e1368af86abcdba12280ca9', sentInOrder: 'f0cf5313a9755c38321fe30195e10cad3e329ed1cec3a26bcdcbf9da7a2b2d08', sentSorted: '94c0558e3befe91a4896633bb5ce5f983acd15d41a17dd3261d047fc971ef788' },
    attributed: { planned: '0cac345f100c34e1d41c524f94eabdc3a29690cb216ef48d6d7e0ea10fb0816b', sentInOrder: '881b835493c0751e8a3e072deb71209cc8d413ea274ba5f11e56ec8bfdad8e31', sentSorted: 'b0f4321f6708ba8b05d8edd810bd4e7c440ca83166ea32d2d68301ca442b6b20' },
    beside: { planned: 'ff40b1840f79a583305fd747da88d883532c0e76859d42fc0af79d6ebadccb08', sentInOrder: 'f60672ec1dcd68305d3491e2bbb50a7f0bbe2f0d75ee9d947b214df3a8a0f649', sentSorted: '1b8c73f1379d8391ecd246e65e7b2c7855577c3f8e9590943bd3c7626bfbeb78' } },
});
// H3 (`sonah.narrative/16`, `sonah.challenge/13`: a claim is every statement about the
// state or the outcome of the work, hedged or not) moved every capture's narrative and challenge requests on purpose, by
// the claims definition's words alone (the narrative task and output contract, the shared challenge system prompt):
// `planned`, `sentInOrder` and `sentSorted`, as /16 and /13 send them. Rendered back as /14 and /11 sent them
// (h3-hedged-claims-fixture.js), then as /13 (M33 N), every capture is MOVED_BY_M33_H's byte for byte (the M33 F test
// below). The number of requests sent, their labels and order, and the window failures did not move.
// H3's review repair (2026-10-06; /16 and /13, were /15 and /12) re-pinned these values once, in place: the relay and
// supportedBy rules' example phrasings are gone and a hedge on a relay is not doubt — the same requests moved, by the
// same fixture's texts, and the render-back still reproduces the values before H3.
// The owner's decision of 2026-10-06 (still /13) re-pinned every capture once more, in place: CLAIM_WORDS_NOTE lists no
// kinds of statement (the quoted text may narrow what the words assert and never widens it), so only `sentInOrder` and
// `sentSorted` moved, by the same fixture's text; the render-back still reproduces the values before H3.
const MOVED_BY_H3 = Object.freeze({
  unattached: h(MOVED_BY_M33_H.unattached, 'e979905f20bdd3f7fa21a92bab08745688913fec006570032e3da70379a3c069',
    '705fd132ffbb405c09704bdc0dfedf843d966bc3884896e7d210e4a5d284b28b',
    '0bafd7764e3e9925c25ff3c6c8d194e885bf92808c4af2f5f11f47e3b0b4a256'),
  attributed: h(MOVED_BY_M33_H.attributed, 'fd673d8dd8da8c9105484ed4476a962de6db3be67d6d72727c35d7ff3d5fab0b',
    '82ade9f4a22e183fa40760cda418bcbf3ae0f3aabdc536fa0ddc168d0aa59eba',
    '3cd6bb7fccaae8d9033509add35e2953d8c3589b00e8f463a9078dd030dc4b26'),
  beside: h(MOVED_BY_M33_H.beside, '50534043a90002a048682d0dbe0778e7e330c3489198e068415c837e89625287',
    '66c23aa702f716b43da3563b204376712ddba91b7f792bdd64c77d87d421266e',
    'da53e9a1b83f75622258f733a5feb9ec64812b2923c052bb02327301aa44b46a'),
});
// M33 integration (2026-10-06; `sonah.narrative/17`, `sonah.challenge/15`): every capture as the merged code sends it —
// the narrative and challenge requests (`planned`, `sentInOrder`, `sentSorted`) carry H3's, the status fact's, G3's and
// M3's texts and M1's `tool=bash` together, which no branch sent. Every other value (windows, number of requests sent,
// labels, order, window failures) is M33 H's. Rendered back through every branch's fixture (the two tests above), each
// capture is M33 H's and M33 C2's with M1's moves, byte for byte.
const MOVED_BY_INTEGRATION = Object.freeze({
  unattached: h(MOVED_BY_M33_H.unattached, 'aa34da1322735424cd90b43acafbf223393f17ef2f5407c9ad4c33d42dd02260',
    'c3b15760651a3728c5d626ae3a291af19cb673405e024dab5c663c6172b3f723',
    '0f0031b2cf681fa090500b77d8865aec92b4c55e9ddece2a1cc36fc7074e3098'),
  attributed: h(MOVED_BY_M33_H.attributed, 'caf0300a3e2462ae0488a4fe0c335838c6ff11a61b1fbbbbdfcf771bcc00eb32',
    '9470f0aa4b86e5c7a0d10f8255762905023c667773511b0b95323b02056731a9',
    '2a76c5a899b9744d0e3ee544d99a02b0e8d4f5d90f7775939afd6c49d42890aa'),
  beside: h(MOVED_BY_M33_H.beside, '5a6c9ea332ee1288ecbf9fede2fa273f0fd391105e5249dcb298a09bb9a3133c',
    '5b30e21fd4fbc060f3a5b58f09b235aa3cd7bab055011dd79405c8986b6439c2',
    'c6098ecda67d85b611c7f937c7c8c65c4fb4f15ba08904c34cc9d68561522377'),
});
/** A report's recorded arrival turn removed, so it stays beside its hand-off (the rule before placement). */
const besideOf = (ledger) => {
  const out = redact(ledger);
  for (const delegation of out.ledger.delegations ?? []) if (delegation.finalAnswer) delete delegation.finalAnswer.turn;
  return out;
};

test('M33 H repair: rendered back as /12 and /9 sent them, every final-answer capture is M33 C2\'s byte for byte', async () => {
  // H3's texts are rendered back first (/16 → /14), then the status fact's (/15 → /14), then M33 N's (/14 → /13), then
  // M33 H's.
  const modules = modulesBeforeRelayRule(modulesBeforeForbiddenEdit(modulesBeforeStatusFact(modulesBeforeHedgedClaims({
    sliceLineage, redact, sessionFromLedger: positionalSessionFromLedger, runReview, planWindowRequests, captureCase,
    windowNarrative }))));
  const [unattached, attributed] = await captureFinalAnswerCases(modules);
  assert.deepEqual(free(unattached), free({ ...MOVED_BY_M33_C2.unattached, ...MOVED_BY_M1.n12.unattached }));
  assert.deepEqual(free(attributed), free({ ...MOVED_BY_M33_C2.attributed, ...MOVED_BY_M1.n12.attributed }));
  const [, beside] = await captureFinalAnswerCases({ ...modules, redact: besideOf });
  assert.deepEqual(free(beside), free({ ...MOVED_BY_M33_C2.beside, ...MOVED_BY_M1.n12.beside }));
});

test('M33 F review requests change only for a window holding an attributed report', async () => {
  // M33 N (`sonah.narrative/14`) moved every session-only narrative request by its three forbidden-edit texts alone:
  // rendered back as /13 sent them (`modulesBeforeForbiddenEdit`), every capture is M33 H's below, byte for byte.
  // The status fact's texts (`sonah.narrative/15`, `sonah.challenge/12` on its branch) and H3's (`sonah.narrative/16`,
  // `sonah.challenge/13` on its branch) are rendered back first (`modulesBeforeStatusFact`, `modulesBeforeHedgedClaims`).
  const back = (modules) => modulesBeforeForbiddenEdit(modulesBeforeStatusFact(modulesBeforeHedgedClaims(modules)));
  const [unattached, attributed] = await captureFinalAnswerCases(back({ sliceLineage, redact,
    sessionFromLedger: positionalSessionFromLedger, runReview, planWindowRequests, captureCase, windowNarrative }));
  assert.deepEqual(free(unattached), free({ ...MOVED_BY_M33_H.unattached, ...MOVED_BY_M1.n13.unattached }),
    'nothing attached: every request exactly as M33 H left it, but for M1');
  for (const key of ['planned', 'sentInOrder', 'sentSorted'])
    assert.notEqual(attributed[key], unattached[key], `${key}: the reports are new evidence`);
  for (const key of ['windows', 'sentCount', 'labels', 'windowFailures'])
    assert.equal(attributed[key], BASE_2E05794.attributed[key], `${key}: the same windows and the same calls`);
  assert.deepEqual(free(attributed), free({ ...MOVED_BY_M33_H.attributed, ...MOVED_BY_M1.n13.attributed }));
  // Placement alone moved those bytes: without the recorded arrival turn each report stays beside its hand-off, and the
  // requests are exactly the ones pinned before placement.
  const [unmoved, besideCase] = await captureFinalAnswerCases(back({ sliceLineage, redact: besideOf,
    sessionFromLedger: positionalSessionFromLedger, runReview, planWindowRequests, captureCase, windowNarrative }));
  assert.deepEqual(free(unmoved), free({ ...MOVED_BY_M33_H.unattached, ...MOVED_BY_M1.n13.unattached }));
  assert.deepEqual(free(besideCase), free({ ...MOVED_BY_M33_H.beside, ...MOVED_BY_M1.n13.beside }));
  assert.notDeepEqual(besideCase, attributed, 'placement alone separates the two attributed captures');
  // History: before M33 C these captures were ATTRIBUTED_M33_F and ATTRIBUTED_M33_F_BESIDE.
  assert.ok(ATTRIBUTED_M33_F.planned && ATTRIBUTED_M33_F_BESIDE.planned);
});

test('M33 integration: every final-answer capture as /17 and /15 send it — only the narrative and challenge requests moved', async () => {
  // C-01 event identity: adapted as before stable ids (positional ids), every capture is the integration's — with the D64
  // wording's proposer sentences rendered back as /19 sent them (`modulesBeforeDisclosureWords`).
  const modules = modulesBeforeDisclosureWords({ sliceLineage, redact, sessionFromLedger: positionalSessionFromLedger,
    runReview, planWindowRequests, captureCase, windowNarrative });
  const [unattached, attributed] = await captureFinalAnswerCases(modules);
  assert.deepEqual(free(unattached), free(MOVED_BY_INTEGRATION.unattached));
  assert.deepEqual(free(attributed), free(MOVED_BY_INTEGRATION.attributed));
  const [, beside] = await captureFinalAnswerCases({ ...modules, redact: besideOf });
  assert.deepEqual(free(beside), free(MOVED_BY_INTEGRATION.beside));
  // H3 moved the same three values on its own branch (MOVED_BY_H3, kept as its history); merged, every one moved again.
  for (const name of ['unattached', 'attributed', 'beside'])
    for (const key of ['planned', 'sentInOrder', 'sentSorted']) {
      assert.notEqual(MOVED_BY_INTEGRATION[name][key], MOVED_BY_M33_H[name][key]);
      assert.notEqual(MOVED_BY_INTEGRATION[name][key], MOVED_BY_H3[name][key]);
    }
});

/**
 * Stable event ids (C-01 event identity, 2026-10-07; `sonah.narrative/19`): every event of these sliced rollouts is
 * named by the recorder's own identity of its row (a call's `call_id` and part, a message's line), so every capture's
 * narrative and challenge requests moved by their event ids (and the scope digest over them) alone: `planned`,
 * `sentInOrder` and `sentSorted`. Adapted as before (positional ids), each capture is MOVED_BY_INTEGRATION's, byte for
 * byte (the test above), and the evidence package's render-back tests show a request then differs from its positional
 * twin's by ids and id digests only. The number of requests sent, their labels and order, and the window failures did
 * not move.
 */
const MOVED_BY_STABLE_IDS = Object.freeze({
  unattached: h(MOVED_BY_INTEGRATION.unattached, '8d2ad60fde05d802663be81dc005579304dc62ba77d31ae10d705f3962b0f109',
    '297de7bea8474b1d7109b928145e0f43d1a06b4a9c35f37c59890a2a57741515',
    '32677c858947da2c83ec7d4c987a2ebfec0a559155660cae589650a9d7f40cd5'),
  attributed: h(MOVED_BY_INTEGRATION.attributed, '4e1a02574137c8502e6cdb41b1b0994874e93414b586146d7868ee092571dcd9',
    '28a728d1cc2916d09ad2da84883a830674da4ac1b7550e8c6e7c52a0df58bab5',
    'fa4d751909776d3b47345657a826664167a10fb98e2daa944b165a294bb074f3'),
  beside: h(MOVED_BY_INTEGRATION.beside, '6f980e2b4825954343ca4e92948602324690b6ee85b59cdbc20ccb679c161c3e',
    '366d366f3c24e8ff78a030284b7c4d4e37a22421cd71f66e2c35c4fc632d86c9',
    'cae2942fde701e7fc567141426f776b3a6dea6d8e47d03c8e3adf4e8999b95cb'),
});

test('C-01 stable event ids: every final-answer capture as /19 sends it — moved by the event ids alone', async () => {
  // The D64 wording's proposer sentences rendered back as /19 sent them (`modulesBeforeDisclosureWords`).
  const modules = modulesBeforeDisclosureWords({ sliceLineage, redact, sessionFromLedger, runReview, planWindowRequests,
    captureCase, windowNarrative });
  const [unattached, attributed] = await captureFinalAnswerCases(modules);
  assert.deepEqual(free(unattached), free(MOVED_BY_STABLE_IDS.unattached));
  assert.deepEqual(free(attributed), free(MOVED_BY_STABLE_IDS.attributed));
  const [, beside] = await captureFinalAnswerCases({ ...modules, redact: besideOf });
  assert.deepEqual(free(beside), free(MOVED_BY_STABLE_IDS.beside));
});

/**
 * D64 wording (owner decision 2026-10-07; `sonah.narrative/20`): every session-only narrative request's item 6 sentence
 * and output-contract rule ask for the agent's statement that it went against the human's instruction, so every
 * capture's narrative requests moved by those two texts alone: `planned`, `sentInOrder` and `sentSorted`. Rendered back
 * (`modulesBeforeDisclosureWords`), each capture is MOVED_BY_STABLE_IDS', byte for byte (the test above). The number of
 * requests sent, their labels and order, and the window failures did not move.
 */
const MOVED_BY_DISCLOSURE_WORDS = Object.freeze({
  unattached: h(MOVED_BY_STABLE_IDS.unattached, '35ed8f9a84626e089987d2deb63618d74a46a014a3785a94dde25f3abb0b3ea4',
    '0bed2b0634cc9907ae9043a9322ec10d5b1a778fb8e5b2841bc4af484b55cbef',
    '78b82c882d828af74c37546f4fbbd9cc124a9f6b36e90e0ad4f7d7721e05d246'),
  attributed: h(MOVED_BY_STABLE_IDS.attributed, 'c3a30c44206f2ffb456dea81fe368ff01ee0f3f9121983eec1df5d06d2ae3b55',
    '1d012a606078916c3a2db9bc8dcd2bbf0f6b43b3e178079e26c111b21057f1a8',
    '5afebddde0155a8c654a2e2461180f21e40606b9a6ea833a466d673fa64e384c'),
  beside: h(MOVED_BY_STABLE_IDS.beside, '630380c9eedc84a745a1787259754d957167d56da9f576cd4f2323a135eea2e6',
    '66bc1c8c9438c6c4d99b268597fe8fba53e31846af289d501b5b6a0958667964',
    '8310a7d4903dc014aa367f8d99be02e5d1138d0ede62dd49b7a028759c764384'),
});

/**
 * M35 windowing (C-07 "M35 windowing"; `sonah.narrative/21`, `sonah.challenge/18`): the ONLY values that moved from
 * `MOVED_BY_DISCLOSURE_WORDS` — every capture's narrative and challenge requests (`planned`, `sentInOrder`,
 * `sentSorted`: windows by segment, carried context, trims, aliases). The number of requests sent, their labels and
 * order, the windows and the window failures did not move. A text render-back can no longer reproduce an older request
 * capture: those values are kept as the record, and every other value is still compared at every level (`free`).
 */
const MOVED_BY_WINDOWING = Object.freeze({
  unattached: h(MOVED_BY_DISCLOSURE_WORDS.unattached, '6fa77b1181a7ca3fac116e0b4b3a93c3ddb60341b81ef662d135231eecfa5995',
    '8d006f01089737107eae5e9fefdb875190c8cecc371155bc9084010f6e091e1a',
    '948be43555a0954fca4a2e1710a7d8b46660b51a827f459ec734d8acc25071de'),
  attributed: h(MOVED_BY_DISCLOSURE_WORDS.attributed, '37c763d06bf9b8a12eb6823678d60f3a6a4f7048ce1bf25390ba36ff6942c632',
    'd14e25e2e7c8e5ee07dd30191393b189f01e5a3b20ac5769466d6faf696e8739',
    'd64379e5bc068ab1f089ea317240b43a9dcd5443117c06bdd0dffb5373fd6f1f'),
  beside: h(MOVED_BY_DISCLOSURE_WORDS.beside, 'f9be21fc8d8316b80ed4ed8063c92b28abde0410feef7d35f07b984ee2efc69b',
    'e3ab974616da9d1aa076c352e15aa149a19fd56c024b748c984a3118356a501e',
    '7288d87709c9a4d944a0330bc9a2f7a43df4d6c45afc56bfcb1f51847eaa4ee7'),
});
/** A capture less the request values M35 windowing moved. */
const free = ({ planned, sentInOrder, sentSorted, ...rest }) => rest;
/**
 * M36 phase 2, the window format (D68 L; C-07 "M36 window format"; `sonah.narrative/23`, `sonah.challenge/20`):
 * the ONLY values that moved from `MOVED_BY_WINDOWING` — every capture's narrative and challenge requests (each RESULT
 * opens with its label line built from the recorder's typed fields). The windows, the requests sent, their labels and
 * order and the window failures did not move (`free`).
 */
const MOVED_BY_M36_FORMAT = Object.freeze({
  unattached: h(MOVED_BY_WINDOWING.unattached, 'fa1d19b236ecf9573e27ea62f6b7148cf275c93ad351a37d1d78d087f739e092',
    'f5fb73e3004b152cd3cc2e2f9fc3a7082a6554ebb35aac32213cf67100f85789',
    '1be80d6ad30eff567d4214b1add36fb25ea5182ef74eeb35327fdd433228ba4e'),
  attributed: h(MOVED_BY_WINDOWING.attributed, '326b6845287bcd07025b79dc811bf5b87355b777ee37db62679174a44fc88c2d',
    '51f47437f27eba6c7d97b4b51cecc62f7669477b7de22534685f86980f6b0338',
    'becfbfddda8d3461b32b0ec922bd37e862573112f4f9ce2c77ce0a2c060b9a7c'),
  beside: h(MOVED_BY_WINDOWING.beside, '658510f2da3d79f981f11b8cf36d7f150760771c1c70f2065aabf4e80859d041',
    '9a15a1a8f76989e6a8c64da1556702bccd7f410b3693ccd2b8ad73dba2f0296e',
    '8753c74cc9d950798fc3c3f1e10991ef0d4800539e92da28d755807cceac71e4'),
});

/**
 * M36 phase 3 (D68 K, Q, F; `sonah.narrative/24`, `sonah.challenge/21`): the ONLY values that moved from
 * `MOVED_BY_M36_FORMAT` — every capture's narrative requests, by item 1's actor sentence and the session-only contract's
 * `evidenceRequests` member and rules alone (rendered back, `modulesBeforeM36Conversation`, they are phase 2's). The
 * windows, the requests sent, their labels and order and the window failures did not move (`free`).
 */
const MOVED_BY_M36_CONVERSATION = Object.freeze({
  unattached: h(MOVED_BY_M36_FORMAT.unattached, '85fb44271b526361c787444cc80ccebec3e05a557e2c93b7dc79d46954396759',
    'ae588157f0703ae5049bd759509faf9443ba7cf2595c2400d7a01a5235eadd69',
    '253dcb281cf7f076fa3b1d3a7722d270a6fddf000f86bf81405339ea51de3e30'),
  attributed: h(MOVED_BY_M36_FORMAT.attributed, '3e722712852a925795c4baf0778205fd0020e22366e7a9b1b235f6d517c7a3d0',
    'f0d056b7171c040d0f18c92450caa585f6f3b16f6564bfc4b6af6ed8391b830a',
    '026a110e13037543a5916ade73a380eff7b7010986a096c6b16ebcda044044e8'),
  beside: h(MOVED_BY_M36_FORMAT.beside, '47a979249ca436d7f31e8f44b2b12b5f89ef5919e980dedeb0c021bd829bfc6e',
    '9e04da6664f6cfb1578e46d64edd5f6841be184f48215a85f024a3b95b131218',
    'b4cd870cdea50b09debb5a704a5a46ee5a507a1c892050f2189a43c07dd66c73'),
});

/**
 * D71 (S2, the reviewer brief as the checklist): the ONLY values that moved from `MOVED_BY_M36_CONVERSATION` — every
 * capture's narrative requests (the brief as the system prompt; the window in the checklist's reading order and format)
 * and challenge requests (one proposition per item, the session core and its notes). Nothing renders a request back to
 * phase 3's; no capture's windows, calls, labels or failures moved.
 */
const MOVED_BY_D71_BRIEF = Object.freeze({
  unattached: h(MOVED_BY_M36_CONVERSATION.unattached, '235499c65402cce459940e27d945179382d8429e09341174e1e061a037ec6f4e',
    'dba67c3e84499a393d904dc4dc89484bf595d8c23a82e263175b7516a022d72b',
    'd73c99591e18b4110db2d022536b1e12d28f0589b665b1b6714233e9cafd8863'),
  attributed: h(MOVED_BY_M36_CONVERSATION.attributed, '073dd860e657d55e152cabde6cedca4000767f3884bd57865b5fa9073a51ca70',
    'ba8976e86c8658e9885ada2aa39e68f68d265c52b9c089c435ac937e3c274e24',
    '16afaea96c233f50e1dc5cbe60c72fb1ad55df7c0820785ba2fdd7abd560732c'),
  beside: h(MOVED_BY_M36_CONVERSATION.beside, 'fa6681d60807c31a5ad0e505f96392cca876a9bea2406ac1393e3b5a2c680211',
    '1fdefd82845a23470b11754dd68ae4f97ffa34526000b20a57565afe164ab8aa',
    '0c9958760fa41578b384180763cd7c7aecd7a4cbb2d2eeed992b3c1e53f58083'),
});

/**
 * D71 (S3, the new channels): the ONLY values that moved from `MOVED_BY_D71_BRIEF` — every capture's narrative requests
 * ("About this window" lists the RESULTs step 4 answers for; the brief's last step is step 6; the brief itself) and
 * challenge requests (the session core's sixth role, the claim note). No capture's windows, calls, labels or failures moved.
 */
const MOVED_BY_D71_CHANNELS = Object.freeze({
  unattached: h(MOVED_BY_D71_BRIEF.unattached, '7dc23d85d11e33e65adabdea42c7c49ea5e4f1af6211e4a54c9d2c48594dc1fb',
    'b2226a3841b4cf801d15938121cd7e594c4d4fff03bd8bae75c50b778c060332',
    '72ad2078c16c07dfa81fa3c4becb792663e1866116d441d64413c07024a71129'),
  attributed: h(MOVED_BY_D71_BRIEF.attributed, '421ba1c66e0a6e3ce25474a88f65a6a4eee3a3c7f919297686ad1bba08c33740',
    '56540ea2c50dcf576356e8199a5da1157c9c7f6f1ac7216e28c9f9636d7d651b',
    'fa20876598af34f169173c9cac971bfb7b076a073bdca15f55a08646ed2f5b0d'),
  beside: h(MOVED_BY_D71_BRIEF.beside, 'dcc838554288d24e82194af27dceac67c2af3a7450ab980a300db82e17886686',
    '0531d489f6e97b44880cb62a9370531ac4669f1a83af37a67e29487f76d71e44',
    '89c4765170e286965dc2e9a585fc996f1214f3614f3476bae2e8282da0e27277'),
});

/**
 * S6 (the fixes of the S5 review): the ONLY values that moved from `MOVED_BY_D71_CHANNELS` — every capture's narrative
 * requests (the brief: a choice not to act with no actions, a claim's `restsOn`). No capture's windows, calls, labels or
 * failures moved.
 */
const MOVED_BY_D71_FIX = Object.freeze({
  unattached: h(MOVED_BY_D71_CHANNELS.unattached, 'd8eac8b5df11df23ac11454a21c322314b4d7323b9d2a4908f8fed5d32550f31',
    '5d44912b497614fd13c8270afdff1216aae4c84dcde80e8ba702831dc6350b85',
    '63208b57e9e2eb1bf7e26213787365937b105b98feddd054190cd0c028440ff3'),
  attributed: h(MOVED_BY_D71_CHANNELS.attributed, 'c9229730ac6c4a7a459e6c2f2c571a4c23b42a533323ba7de1c9d76cefbff0e5',
    'd4166b3f452b3d7e883820943146d8472d94645151c77b449f7f95be7cfa85b8',
    'e918bc93829527b4b113dea09e5c7a43728ad6c183f6e3e57d942bbfa7557818'),
  beside: h(MOVED_BY_D71_CHANNELS.beside, 'b6bcf5b2c02dada6137cf8770dda4df1f5476d878b5c3da7aedd045e894d563f',
    'ef130b844ea37cc7da109ad45d281f40d0cd8c8831633b0a93f57745d6e3fd4a',
    'a080de8e2d16e0c44a3e4f40ad133c463d149daaa8d6ed44a682dcc1a01be6bb'),
});

/** S7: the ONLY values that moved from `MOVED_BY_D71_FIX` — every capture's narrative
 *  requests (the brief's restsOn and step 4 sentences, the failures line). No capture's windows, calls, labels or failures
 *  moved. */
const MOVED_BY_S7 = Object.freeze({
  unattached: h(MOVED_BY_D71_FIX.unattached, '0ed33db48d417c7b283b7c9c8d480a4cb6582538199a7f37fd784fc8e57e0ee1', 'eff59d3e3317e1da0129ff18f3799296fa1a3b194e2f3db81088056ced852397', 'f08ad01c60ff41c6fb704bee50e1a81c85e64aaa29adce280867b28de3bee2c9'),
  attributed: h(MOVED_BY_D71_FIX.attributed, '4471a2b4c6b6acc4e40adc6a9de5e6a02573882cc5007dbdce0f6ed2000e4732', 'e3cb10ea169b10e282ef0bf63aa1098edb9a7847f0e7b9ac5fbacf192292f73c', '73611d2b6550b7f9f446f4098e5e46151eacb2cbc6a4516db4cd314f6c74b893'),
  beside: h(MOVED_BY_D71_FIX.beside, 'f97f17ba4b34f5ccb3e5e13b627402e1eddef1251b9787a2d98f444b85ad589f', '7add0f666811c7dca1a53c919666a2fe8941638c6c5bcee84624df4c6dd2e10a', 'e89a5105f64d82ac71510451608d2b3c0f1669dc1fd66bb2b86a507400c2935a'),
});

/** The column fix (owner decisions D83 (2) and D84): the ONLY values that moved from `MOVED_BY_S7` — every
 *  capture's narrative requests (the brief says who decided a decision: a project instruction file may cover it, and
 *  "you asked, the agent chose how" holds only when doing what was asked requires deciding the question; D84:
 *  "made without asking you" checks the shown project instruction files too; and on 2026-10-13: "you
 *  settled it" is words that state the choice's own answer, and DECISION_NOTE never says to refute a decision those
 *  words settle, D84 (3); the settled-words gain: such a choice is reported settled at the level the words address, and
 *  DECISION_NOTE says it holds there). No capture's windows, calls, labels or failures moved. */
const MOVED_BY_FIX_COLUMN = Object.freeze({
  unattached: h(MOVED_BY_S7.unattached, '899428dde7d99b49d8ed1fc1ec17a0e9be810a04f1dd46baa67bbff23066f479',
    '1c33edb056474e9a55ecfdd678a9e7a7961a4628d66049ef57c52891a3a66934',
    'a68155ad1031c14fd60b8c92d36530493d23055b51c5127af3d3f9dcf9170252'),
  attributed: h(MOVED_BY_S7.attributed, '40c17456f819a9f1ee190a062f05d1a618a5463f059e7196a2d8af093ffd8ca2',
    '357dcc6167bbb058e694e1e6c0de339dcae6e1203636040eba893a7aada04eda',
    '967108d6ad8efb5b09b0a780f31aa76c1857a1a521560f4578095e0e5a1cd8eb'),
  beside: h(MOVED_BY_S7.beside, '25ce730ed913e55cf41becd0394ec2aebbb9280c1b7d1b107325196a10530068',
    '5804884514d86e8ba306c36560c8c2be9c56b0042dde20fefd25533341f63722',
    '786cf2dc13f3f4be3381bf3ebaf2829515088f9742462433ba2efa81287072c9'),
});
/** The asks fixes (P1): the ONLY values that moved from the column fix's — every capture's requests, by the brief's one
 *  sentence on a run the human asked for, refused at every attempt (`sonah.session-review-agent/9`). S3 moved none: no
 *  capture's challenge refutes a requirement. No capture's windows, calls, labels or failures moved. */
const MOVED_BY_ASKS_FIXES = Object.freeze({
  unattached: h(MOVED_BY_FIX_COLUMN.unattached, 'b33355d37283a8673fd1e85e93fc2e6ebab645570c025e8377465c0b964fad24',
    'e5e434b156c96b8412673588d6bacad885384430c06b007f4c4080ef0bef3c07',
    'b003e7613ce892250ca601a6d22b4c9ab1bbe82fe73ba9190e566beb85af0169'),
  attributed: h(MOVED_BY_FIX_COLUMN.attributed, '8caeeedd990baeb35904b3831860e7a3614f7e725c0241ce2811a60107d96950',
    'cbb58d4f7b71f6188eafc4b69a9e6767b8b1cbf77f50e6aad3f754c9aa83922f',
    '232678f8584e2ec01572b58007f18fe2855b34e6908bc8b79cbb12bbcf7eebe2'),
  beside: h(MOVED_BY_FIX_COLUMN.beside, '7a97b0226d15ed5c7ba52c1cf3518d212947b9dbe9d32f13923e6ea71314e806',
    '148da0f9dbd5e034972f76ecbeceb0e1321f5ede18359a61eabbd51faed19bf0',
    '0d72b1f38a694b0c4934f0467668e5f892195ca664aa5ef6234e2c961950ef52'),
});

/** W1 B: the ONLY values that moved from the asks fixes' — every capture's requests, by the brief's texts (W1_TEXTS:
 *  step 3's sentence, step 5, a forbidden edit's instruction role and its contract rule; `sonah.session-review-agent/10`).
 *  W1 A moved none: no capture's challenge refutes a decision. Rendered back (`modulesBeforeW1`), each is
 *  The asks fixes'. No capture's windows, calls, labels or failures moved. */
const MOVED_BY_W1 = Object.freeze({
  unattached: h(MOVED_BY_ASKS_FIXES.unattached, '1cf4aac1a9d2f8e192231d457e9e327e6f457c0a14aee9f95bbb085aa4bd64c0',
    '06e6574cfd8d69278f49a68bc0e9deea672cc6178a1c5000a9b7a3681d96d008',
    'ed184fae125601b0a6c79578c85207e995b388d6f7eb02b93342695ec2d908d4'),
  attributed: h(MOVED_BY_ASKS_FIXES.attributed, '17ac48977f94f8a76837ddb3e31fbd527949376bc04adb9d4a08bdfb5c6ed9d8',
    '951a62f9a9ca01362d6ad25ea86375e73a62b9b77977d0356cd1558dc95651f0',
    '3845b103355b627238e87a2626fcb14643bb9c465dbf23615520651de667aa97'),
  beside: h(MOVED_BY_ASKS_FIXES.beside, 'e5cf1ae17b82a9cbe41f7e36ef405ea11536e633b4ccabf103a6c6c6e85b2e28',
    '269c16d5bb7f9072ea38fa95e6d3aeeeb57a3a3bf6e62160e49924825af9fcfb',
    '6da1d15e1f49ca09882f3ef4a1b0241408b4bd49b11a6d669ed529efe264535b'),
});

/** W2 (3): every capture's requests moved once more, by the brief's texts (W2_TEXTS: step 2's compare sentence and its
 *  contradictedBy, step 5's written contradiction; `sonah.session-review-agent/11`) and, where a batch holds a claim-class
 *  item, CLAIM_NOTE (`sonah.challenge/32`). Rendered back (`modulesBeforeW2`), each is W1's. No capture's windows, calls,
 *  labels or failures moved. */
const MOVED_BY_W2 = Object.freeze({
  unattached: h(MOVED_BY_W1.unattached, '98fea583f439ff791df552342aaeffd189609541e60a685732540b02542d80b9',
    '5a2a6d1d86055a63f01fd1981033fb1e57530f307dc60185f94f53457583c5c5',
    '5d6478736ea89f7fa207c83dc850032b6e777beb2d87d79b73ee802ac2449d40'),
  attributed: h(MOVED_BY_W1.attributed, 'd48e47ae29c22b918352dc99a795ccebc3b3752fa23210c532c9f02006d3559f',
    '80dac4a3dc9d264f6c2c52e592706954bf362c28ced9a059bf6a421c9d2293b6',
    '7e897ab7d32ce6bebc6b8d341ff076b30c1e95612f91c6bc2aa32ff435c49147'),
  beside: h(MOVED_BY_W1.beside, '8f39234c22e17a1146898fb777326c966a11318f1ce9a90d82fe3ac8718e2348',
    '30ec1c3c3793a1151d6c55048fb733c1977499c92ab3e13bc11ffc606a7449eb',
    '8a11aa96cb654b6b8fb36aeb82e8da7970bb428fb78253db9ba19fedd3a672e4'),
});

/** W3 F1(b) and F2: the challenge requests moved once more, by CLAIM_NOTE's changed-since criterion and its
 *  failed-result sentence (W3_TEXTS; `sonah.challenge/34`), in a batch holding a claim-class item; no narrative request
 *  moved. Rendered back (`modulesBeforeW3`), each is W2's. */
const MOVED_BY_W3 = Object.freeze({
  unattached: h(MOVED_BY_W2.unattached, '98fea583f439ff791df552342aaeffd189609541e60a685732540b02542d80b9',
    '6a492a5a531890ca212745feed67d3f9bc8894f35c9598db1114e70b24728a21',
    'bd4c16f4cd39fed555741aea1fc0b37ee20b2882c5a1a2c3ddbbc33bc5b43d85'),
  attributed: h(MOVED_BY_W2.attributed, 'd48e47ae29c22b918352dc99a795ccebc3b3752fa23210c532c9f02006d3559f',
    '070825734c9a7e58a3765c7edb8cd7d149f55808a81baee26477bf910f158271',
    '04d1d6f3f83ee816798811dd52add73bcd355725db0afda2654d3522d83e436e'),
  beside: h(MOVED_BY_W2.beside, '8f39234c22e17a1146898fb777326c966a11318f1ce9a90d82fe3ac8718e2348',
    'a01f1b1a38dcfc26ec4dfb6f5d01d3da426b25c38cb4d4d549b12c357f5ed000',
    '625670c235c8059f2f26d9fd3382bf2226006323e26fcc1c40ec95daf3e83702'),
});

/** The fix review: the challenge requests moved once more, by CLAIM_NOTE's failed-result sentence (FIX_REVIEW_TEXTS;
 *  `sonah.challenge/35`), in a batch holding a claim-class item; no narrative request moved. Rendered back
 *  (`modulesBeforeFixReview`), each is W3's. */
const MOVED_BY_FIX_REVIEW = Object.freeze({
  unattached: h(MOVED_BY_W3.unattached, '98fea583f439ff791df552342aaeffd189609541e60a685732540b02542d80b9',
    'd71b598ddf9591341a02d782585eb8d5d5fd5f24cd183d870ba1d74793858aad',
    'c5f200d7eb3ba5e810f67f4ee2b3495dddbe041624b3726113708cac794af619'),
  attributed: h(MOVED_BY_W3.attributed, 'd48e47ae29c22b918352dc99a795ccebc3b3752fa23210c532c9f02006d3559f',
    '4804623b30eafdc8425c527cb5bfa025b76fb1ae827c2d3b367a9d2dff876200',
    '9b7686749c1a97030257983443e005ae444a484bbd0734d8e5ea3b5506e29a1d'),
  beside: h(MOVED_BY_W3.beside, '8f39234c22e17a1146898fb777326c966a11318f1ce9a90d82fe3ac8718e2348',
    '45f1e5081db6452a11be60a9da6ac751a6ea6bb8739b0679e0b325b613570e37',
    '51c455b15b536dbef6e9d487dbfcf5ccdc6b777ca04da16d5cec7dbb26d17090'),
});

test('D64 wording: every final-answer capture as this tree sends it — moved by the two proposer sentences alone', async () => {
  const modules = { sliceLineage, redact, sessionFromLedger, runReview, planWindowRequests, captureCase, windowNarrative };
  const [unattached, attributed] = await captureFinalAnswerCases(modules);
  const [, beside] = await captureFinalAnswerCases({ ...modules, redact: besideOf });
  // D71 (S2): every capture's requests moved again (MOVED_BY_D71_BRIEF); phase 3's render-back no longer reproduces phase 2's.
  // D71 (S3): and once more (MOVED_BY_D71_CHANNELS). S6: and once more (MOVED_BY_D71_FIX). S7: and once more (MOVED_BY_S7).
  // The column fix: and once more (MOVED_BY_FIX_COLUMN). The asks fixes: and once more (MOVED_BY_ASKS_FIXES).
  // W1 B: and once more (MOVED_BY_W1); rendered back (`modulesBeforeW1`), the asks fixes', byte for byte.
  // W2: and once more (MOVED_BY_W2); rendered back (`modulesBeforeW2`), W1's, byte for byte.
  // W3 F1(b): and once more (MOVED_BY_W3); rendered back (`modulesBeforeW3`), W2's, byte for byte.
  // The fix review: and once more (MOVED_BY_FIX_REVIEW); rendered back (`modulesBeforeFixReview`), W3's, byte for byte.
  assert.deepEqual(unattached, MOVED_BY_FIX_REVIEW.unattached);
  assert.deepEqual(attributed, MOVED_BY_FIX_REVIEW.attributed);
  assert.deepEqual(beside, MOVED_BY_FIX_REVIEW.beside);
  const w3 = modulesBeforeFixReview(modules);
  const [unattachedW3, attributedW3] = await captureFinalAnswerCases(w3);
  const [, besideW3] = await captureFinalAnswerCases({ ...w3, redact: besideOf });
  assert.deepEqual([unattachedW3, attributedW3, besideW3], [MOVED_BY_W3.unattached, MOVED_BY_W3.attributed, MOVED_BY_W3.beside]);
  const w2 = modulesBeforeW3(modules);
  const [unattachedW2, attributedW2] = await captureFinalAnswerCases(w2);
  const [, besideW2] = await captureFinalAnswerCases({ ...w2, redact: besideOf });
  assert.deepEqual([unattachedW2, attributedW2, besideW2], [MOVED_BY_W2.unattached, MOVED_BY_W2.attributed, MOVED_BY_W2.beside]);
  const w1 = modulesBeforeW2(modules);
  const [unattachedW1, attributedW1] = await captureFinalAnswerCases(w1);
  const [, besideW1] = await captureFinalAnswerCases({ ...w1, redact: besideOf });
  assert.deepEqual([unattachedW1, attributedW1, besideW1], [MOVED_BY_W1.unattached, MOVED_BY_W1.attributed, MOVED_BY_W1.beside]);
  const back = modulesBeforeW1(modules);
  const [unattachedBack, attributedBack] = await captureFinalAnswerCases(back);
  const [, besideBack] = await captureFinalAnswerCases({ ...back, redact: besideOf });
  assert.deepEqual([unattachedBack, attributedBack, besideBack],
    [MOVED_BY_ASKS_FIXES.unattached, MOVED_BY_ASKS_FIXES.attributed, MOVED_BY_ASKS_FIXES.beside]);
  for (const name of ['unattached', 'attributed', 'beside']) {
    assert.deepEqual(free(MOVED_BY_FIX_REVIEW[name]), free(MOVED_BY_W3[name]), `${name}: the fix review moved its requests alone`);
    assert.deepEqual(free(MOVED_BY_W3[name]), free(MOVED_BY_W2[name]), `${name}: W3 moved its requests alone`);
    assert.deepEqual(free(MOVED_BY_W2[name]), free(MOVED_BY_W1[name]), `${name}: W2 moved its requests alone`);
    assert.deepEqual(free(MOVED_BY_W1[name]), free(MOVED_BY_ASKS_FIXES[name]), `${name}: W1 moved its requests alone`);
    assert.deepEqual(free(MOVED_BY_ASKS_FIXES[name]), free(MOVED_BY_FIX_COLUMN[name]),
      `${name}: the asks fixes moved its requests alone`);
    assert.deepEqual(free(MOVED_BY_FIX_COLUMN[name]), free(MOVED_BY_S7[name]),
      `${name}: the column fix moved its requests alone`);
    assert.deepEqual(free(MOVED_BY_S7[name]), free(MOVED_BY_D71_FIX[name]), `${name}: S7 moved its requests alone`);
    assert.deepEqual(free(MOVED_BY_D71_FIX[name]), free(MOVED_BY_D71_CHANNELS[name]), `${name}: S6 moved its requests alone`);
    assert.deepEqual(free(MOVED_BY_D71_CHANNELS[name]), free(MOVED_BY_D71_BRIEF[name]), `${name}: S3 moved its requests alone`);
    assert.deepEqual(free(MOVED_BY_D71_BRIEF[name]), free(MOVED_BY_M36_CONVERSATION[name]), `${name}: D71 moved its requests alone`);
    assert.deepEqual(free(MOVED_BY_WINDOWING[name]), free(MOVED_BY_DISCLOSURE_WORDS[name]), `${name}: M35 moved its requests alone`);
    assert.deepEqual(free(MOVED_BY_M36_FORMAT[name]), free(MOVED_BY_WINDOWING[name]), `${name}: M36 phase 2 moved its requests alone`);
    assert.deepEqual(free(MOVED_BY_M36_CONVERSATION[name]), free(MOVED_BY_M36_FORMAT[name]),
      `${name}: M36 phase 3 moved its requests alone`);
  }
  for (const name of ['unattached', 'attributed', 'beside'])
    for (const key of ['windows', 'sentCount', 'labels', 'windowFailures'])
      assert.equal(MOVED_BY_DISCLOSURE_WORDS[name][key], MOVED_BY_STABLE_IDS[name][key], `${name} ${key}`);
});
