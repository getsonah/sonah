// M33 T repair (helper briefs). Recording an encrypted Codex brief as a fact, and the task name as a plain delegate
// event field, changes no review request byte. This pins it against the code BEFORE the change, not against itself:
// the values below were computed ONCE by running `captureHelperCases` (evidence/test/m33-t-helper-brief-fixture.js,
// node built-ins only) against a `git archive 23afc8a` export in a scratch directory, and twice there to show they
// do not depend on the temp path. This test proves the current tree reproduces them, request for request: every
// planned narrative request (label, system, prompt, evidence prompt) and every sent narrative and challenge request.
//
// The `readable` case is the one the first cut got wrong: readable briefs with no whitespace (a snake_case spawn
// and a camelCase follow-up that even opens with the recorder's shape) were taken for encrypted tokens, lost, and
// the requests changed. Base kept them as text; so must this tree.
//
// Merged with M33 C (claims are facts), which moved some request bytes on purpose: `MOVED_BY_M33_C` below holds
// exactly the values it moved, computed ONCE the same way against a `git archive 2fd391f` export (M33 C claims before
// this merge, with this fixture copied in), twice there at different temp paths. Every other value is still 23afc8a's.
//
// M33 C recheck 2 moved the challenge requests once more, on purpose: code no longer withholds a claim before its
// challenge, so each case's "I will hand the parser fix …" claim, which `claim_not_factual` used to withhold, is now
// in its challenge batch. `MOVED_BY_M33_C_RECHECK2` holds exactly the sent-request values that moved, computed ONCE
// on this tree at two temp paths, beside a capture of a `git archive 5fea7f5` export (this fixture copied in) that
// reproduces `MOVED_BY_M33_C` byte for byte; the one difference in the sent requests is that claim item.
//
// M33 C2 (`sonah.challenge/9`, the verbatim quote decides) moved the challenge requests once more, on purpose: a batch
// holding a claim-class item shows each such item's stated quote as `claim` and its narrative text as
// `reviewersReading`, and is sent CLAIM_WORDS_NOTE after the unchanged system prompt. `MOVED_BY_M33_C2` holds exactly
// the sent-request values that moved; rendering every challenge request back as /8 rendered it (no note, candidates as
// proposed), this tree reproduces `MOVED_BY_M33_C_RECHECK2` byte for byte. M33 C2 repair (still /9) moved the same values
// again, and only they: each claim-class item shows code's grounded words and their `context`, and the note names them;
// rendered back as /8, `MOVED_BY_M33_C_RECHECK2` still reproduces byte for byte.
//
// M33 H's repair (`sonah.narrative/13`, `sonah.challenge/10`: a relay of another agent's report is the passing agent's
// own claim) moved every narrative and challenge request once more, on purpose, by the relay rule's words alone:
// `MOVED_BY_M33_H`; rendered back as /12 and /9 sent them, every case is M33 C2's byte for byte.
//
// M5 (the Codex human channel) moved the `linked` case's requests, and only them, on
// purpose: `MOVED_BY_M5`. Its synthetic helper records no typed human channel, so the plugin list it starts with (only
// top-level elements) is set aside by structure and declared as a counted gap instead of being sent as the helper's
// AGENT ASSIGNMENT; the helper's events are its turn 0.
//
// M35 windowing (`MOVED_BY_WINDOWING`) moved every case's requests and the `linked` case's windows: from it on, the
// render-backs compare every value M35 did not move (`windowingFree`), and the request captures before it are the record.
//
// Synthetic rollouts in a temp directory and a deterministic fake judge: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { runReview, planWindowRequests } from '../../evidence/src/run-review.js';
import { captureCase, windowNarrative } from './m33-fast-profile-fixture.js';
import { captureHelperCases } from '../../evidence/test/m33-t-helper-brief-fixture.js';
import { modulesBeforeRelayRule } from '../../evidence/test/m33-h-relay-rule-fixture.js';
import { modulesBeforeForbiddenEdit, modulesBeforeDisclosureWords } from '../../evidence/test/m33-n-forbidden-edit-fixture.js';
import { modulesBeforeStatusFact } from '../../evidence/test/status-fact-fixture.js';
import { modulesBeforeHedgedClaims } from '../../evidence/test/h3-hedged-claims-fixture.js';
import { withoutIdentity } from '../../evidence/test/stable-ids-fixture.js';
import { modulesBeforeM36Conversation, modulesBeforeW1, modulesBeforeW2, modulesBeforeW3, modulesBeforeFixReview }
  from '../../evidence/test/m33-integration-fixture.js';

/** A case's capture less the values M35 windowing moved for it (`MOVED_BY_WINDOWING`, below). */
const windowingFree = (capture, at) => Object.fromEntries(Object.entries(capture)
  .filter(([key]) => !Object.hasOwn(MOVED_BY_WINDOWING[at], key)));

/** captureHelperCases on 23afc8a (see the header). */
const BASE_23AFC8A = Object.freeze([
  { name: 'encrypted', windows: 1,
    planned: '7f068a70adcf7e1c5bb5f1299ccc4975f69746bd3de1e6b7ac54ef9f71c1d846',
    sentCount: 5,
    sentInOrder: 'e0f7462165c48929661e850f76f1dfb44f08bc8906c9766adde386f670d95aca',
    sentSorted: '5174604e65bfe3ef243fde62245986119b29cb2e71d77064d7aec360fdd92c83',
    labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73',
    windowFailures: '' },
  { name: 'plaintext', windows: 1,
    planned: 'a5ce1bd7f05b7227e886b67c0ca77881239c3b4d1df8f515ea099fc1416d342e',
    sentCount: 5,
    sentInOrder: '11281eb52234fba7ac811b64a5ae8c6d77a7a2c2594cef4db5b09eb2c8ab2d47',
    sentSorted: 'f24a3e1ebd475213792963ca49a2b9a18e33033c65cea9e8c7972443205d62a1',
    labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73',
    windowFailures: '' },
  { name: 'readable', windows: 1,
    planned: '52c2662cfe303fce090cecaeec4dbbbc27c581c42caff61079778edcc12e4f8e',
    sentCount: 5,
    sentInOrder: '864b79cea194a1b86a7c830abf4fad796e91b3c796f25abfdc811bbabd18eaab',
    sentSorted: 'e5b0f56fa48b0dab991eda910265e5a29a7923dc3944a74d8e5082fcae9ddc0a',
    labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73',
    windowFailures: '' },
  { name: 'linked', windows: 1,
    planned: 'f2c15aae035b0dc927f317e55589c3e6cd2d3a88615f0a46a356238b1cd98fef',
    sentCount: 5,
    sentInOrder: 'b2e2a103b63e98ef7501d358e1b0c1433a863d93f4e84e6e612a009d5624cdd4',
    sentSorted: '46eae9f402b8838c858868e04386e3a33d5f50cdf40de12f702bdca3d6efb9ab',
    labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73',
    windowFailures: '' },
]);

/**
 * M33 C (`sonah.narrative/11`, `sonah.challenge/8`, as the M33 C repair left them): the ONLY values that moved from
 * 23afc8a's, captured on 2fd391f (see the header), each for a stated reason — every narrative request's task text
 * (`planned`) and every challenge request's system prompt (`sentInOrder`, `sentSorted`). The windows, the number of
 * requests sent, their labels and order, and the window failures are 23afc8a's, unchanged. The merged tree reproduces
 * 2fd391f's capture byte for byte: the M33 T change moves no request byte on either side of the merge.
 */
const MOVED_BY_M33_C = Object.freeze([
  { planned: 'f06962f28b49f4310589cca1c7979dd41f1d1b52a8e6e712e7ebdf35ef53aed1',
    sentInOrder: '825ae6c252c0bf5d6c50a64f103f8f1865dad82f74d9f6008e0414c16e58be4a',
    sentSorted: 'ae0bddf098285a98f57aaf7b4fef7bb06e5f814d9924090e73d79345be688917' },
  { planned: '1cbffc181713b767818df446c20dc32648a2fd79c10f608cb74c870345ace7be',
    sentInOrder: '99453aa04e3238eec859490649d821cba750771848a0fae2104243348b372232',
    sentSorted: 'a38c18f302040e48fba18e00fc0e3218d671bd72516e81643c87decd30cb9437' },
  { planned: 'f35883ea26bb1429809caf8bf46dc964993606267ab145fc5e20218a684828e7',
    sentInOrder: 'fab644b4cda9684b4eb59fa62c02ba9981031fe62d79468c904749e9e6b043b2',
    sentSorted: '3813b95f1aaedfc18ab65272ce75d35a6769c30f683c98b4d58e846db5cb19e5' },
  { planned: '528c421bc51692321efa0b98988ffc3ecc17917087dbb78a3beffe7714ae79b7',
    sentInOrder: 'b2f1e50f5191bdcd0813dc23afd44cdea83a702bdb553b1f47877403f02d8216',
    sentSorted: '73ee069339d206cb6152139caeebebd4596ce7a8b66af36dfae1bd965bae058d' },
]);
/**
 * M33 C recheck 2: the ONLY values that moved from 5fea7f5's capture (`MOVED_BY_M33_C`) — every challenge request
 * (`sentInOrder`, `sentSorted`), because the intention claim code used to withhold is now asked. The narrative
 * requests (`planned`), the number of requests sent, their labels and order, and the window failures did not move.
 */
const MOVED_BY_M33_C_RECHECK2 = Object.freeze([
  { sentInOrder: 'f68d21e21c6fad0aba6efc6c7a469e129abf4b925eb51225f4ddce8fff9b7399',
    sentSorted: 'f3337f1183e632f507bfa76bcbb71d1a1eafca8c57a1cf06b550e467bd0ee2a6' },
  { sentInOrder: '1f0ee7fed486650095a897525eaa96254911f8aa6f96b8e8ffedf942e5a1ffd9',
    sentSorted: '4ac1e081575af05a66bd3e867ce9a6d485d4406001f226f036acad5481b7f163' },
  { sentInOrder: 'eca93e8b4e4a37cef42c1c035491eb5f8ae672baeeb648240dedb5ec47647b80',
    sentSorted: '8a4667a279d0b8ca5c76b8e679a00a7aca6d457f936276dc410b12232b293b07' },
  { sentInOrder: 'a824aecb6c416711bdaa6e177e25dc5f22130b592506094889109444aad66510',
    sentSorted: '152f9be22b80bd3c36b7cc93f368298988ff549c4312b4656d3bb4b21d47f2f4' },
]);
/**
 * M33 C2: the ONLY values that moved from M33 C recheck 2's — every case's challenge requests (`sentInOrder`,
 * `sentSorted`), because each holds a claim item, now shown with its verbatim words. The narrative requests
 * (`planned`), the number of requests sent, their labels and order, and the window failures did not move.
 */
const MOVED_BY_M33_C2 = Object.freeze([
  { sentInOrder: 'a126659c3bbed8236e46f1440edab36a57797f0dc19504373815beb4ab9777e3',
    sentSorted: '026d17c17171ecb63ada6a0d3337924f9cecf5ec0c54e3443c7cca5d23c71169' },
  { sentInOrder: '0a4b9da99760cc9a84a0d20542fcb9616196fc8b4cd1337f01c00b27e5d77a7a',
    sentSorted: '7fdb774aa81586f44a87eb22fbd19dbcd7d5dcf7998eb75d09bcdd362efcb4ca' },
  { sentInOrder: 'bade1b18b4992979a5143cdc02ed5b32dea7475843dc1aab1a1147a1ca2163ed',
    sentSorted: 'efb6ab48e207143864da9e93e576d538616b005fcecb07c5da1ed31b829112db' },
  { sentInOrder: 'ad4f7c2acf954dfb26cfc1940ea77473f0e1fe1b72c4a11aca7c0dcb568bd593',
    sentSorted: '5237c2a6c756420e317674f979dd2487077b197c069cd74de5256dc24e9f55e5' },
]);
/** 23afc8a's capture with exactly the values M33 C, then M33 C recheck 2, then M33 C2, moved: before M33 H's repair. */
const BEFORE_M33_H = Object.freeze(BASE_23AFC8A.map((c, at) => ({ ...c, ...MOVED_BY_M33_C[at], ...MOVED_BY_M33_C_RECHECK2[at],
  ...MOVED_BY_M33_C2[at] })));
/**
 * M33 H repair (`sonah.narrative/13`, `sonah.challenge/10`: a relay of another agent's report is the passing agent's
 * own claim): the ONLY values that moved from M33 C2's — every narrative request's task text and output contract
 * (`planned`) and every challenge request's shared system prompt (`sentInOrder`, `sentSorted`). Rendered back as /12
 * and /9 sent them (m33-h-relay-rule-fixture.js), every case is M33 C2's byte for byte (the render-back test below).
 * The number of requests sent, their labels and order, and the window failures did not move.
 */
const MOVED_BY_M33_H = Object.freeze([
  { planned: 'a0c5bb7236144492134d757bc0cb2dd64d78d4a979c3531e12ac93a706e4cf72',
    sentInOrder: '76e97533833f234a4839c65879e5c5e86616ccee5a20c165cb3b8e9779b2a24d',
    sentSorted: '966b1e14406c5a2fb192df9e243cd4306aaf99aa15e3bb50dc1ac6ba2a976c18' },
  { planned: 'fd01a834e3b76f4dfd7e6ca85c21393f17be1d09368e7f2deb0d81c4bab9be5f',
    sentInOrder: '7617bbc8ba171ce662295ad62fbdd2200bde646ec27469fdfedc923680fd5419',
    sentSorted: 'f750fda14e222c02be51c1be2b3c995c08f0564f0b7254ef02fd3d0c8b799889' },
  { planned: '96881399b31057c177f1c13595c44485e8207be54274afc47f8ffdcbf141e8c0',
    sentInOrder: 'ac68f8b78859cd461e0e182eb7b2a4b4959aa8156040e04b78f1569f427921cc',
    sentSorted: '25ba6e99c9d92ab57b6181fd4f7f2a4bd31eb6d4a8a9e56bac5eea81bc9aea43' },
  { planned: 'f66cd4b2896a36047cf4cc155ada4b1696436b85d36aa341b27cb63a2c83c7f9',
    sentInOrder: '1b8c6fc7bc90e48bd2bff92f2a883d7bf9abc5e6a6edfa041171517540a710b2',
    sentSorted: '57ed088cd9b96ab39d72f10d86ddae44cd2bdaaa8873b2ba150d3b1ce820d4eb' },
]);
/**
 * M5 (C-02 "M5 Codex human channel"): the ONLY values that moved — the `linked` case's
 * narrative requests (`planned`) and challenge requests (`sentInOrder`, `sentSorted`): its helper's plugin list is no
 * longer an instruction event (no AGENT ASSIGNMENT in the request, the helper's events renumbered from turn 1 to 0, the
 * child's counted structural gap). `current` is the capture as this tree sends it; `renderedBack`, the same capture
 * rendered back as /12 and /9 sent them (the render-back test), which M5 moves in the same case and fields. Computed
 * ONCE on this tree, twice at different temp paths. The other cases, the number of requests sent, their labels and
 * order, and the window failures did not move.
 */
const MOVED_BY_M5 = Object.freeze({
  current: Object.freeze([{}, {}, {}, { planned: '9ff6526ae5696167523b30255545a1c264a63b7226e0c17f13145e81ad07c584',
    sentInOrder: 'ebaa090a0d5f55f65300589be7293aa055051b5ecb049fb81658e4872518c27e',
    sentSorted: '3e2def3cf052a0aa5773083a1d1748e7905434679057883d17f9c9046c088553' }]),
  renderedBack: Object.freeze([{}, {}, {}, { planned: '87075330636751bf5bad1a2329da42cc9ce9b2bd416647081be9a6b8cfe6b6b2',
    sentInOrder: 'f815d90cae8f9588b403908821dd12cca22a7e8832dab0ffa07cc7995b10e9cd',
    sentSorted: '13b236cc776d587c68d45ec3a6a195ef5ffbd07f10965abc402307b8676b4380' }]),
});
/** The capture before M33 H's repair with exactly the values the repair moved, then exactly the values M5 moved. */
const BASE = Object.freeze(BEFORE_M33_H.map((c, at) => ({ ...c, ...MOVED_BY_M33_H[at], ...MOVED_BY_M5.current[at] })));
/**
 * H1 (a command's status from structure only): the ONLY values that moved, of the fourth
 * case ("linked") alone — its helper's command result, recorded by a sub-agent with no typed status, was a pass read from
 * its output text and is now `unknown`: its narrative and challenge requests (`planned`, `sentInOrder`, `sentSorted`), at
 * both render-back levels. No other case, and nothing else of this one, moved.
 */
const MOVED_BY_H1 = Object.freeze({
  n13: [{}, {}, {}, { planned: 'c39c6298a8b4d28c23c17d3aadabf3b826c86c90f98ce1f9887af5402a4cc884',
    sentInOrder: 'b28d1b244f913c9019bcb60122cfd5744a198a35a0319b5f0df2b0863655a585',
    sentSorted: 'cf09a774c60b62baa2bd0334b7d4c913a9b2e256e5e1b8b6777d029c470c5c0d' }],
  n12: [{}, {}, {}, { planned: '57410ef31e598174077c31a5e27345665ed6ba463618bb1cbc4e41e572e7a5f4',
    sentInOrder: '4e6a51562a8c232364210becf3d116551a54b4873e40fd35cda4d5fac112895f',
    sentSorted: '5397b4bf06c87a088b4300fe95baf4928e4b1e8aeaeaac3e7a4de0758121890a' }],
});
/**
 * M1: every case's runner command is a `bash` action, no longer `test` (`tool=bash`; a
 * failed one `tool=error`, as any failed command): every case's narrative and challenge requests moved, at both
 * render-back levels, and nothing else.
 */
const MOVED_BY_M1 = Object.freeze({
  n13: [
    {'planned': '1ba0a6651917085a65529d64c0d65db8967b259c6bee659cb756fc4cbbd6d5b0', 'sentInOrder': '0b6693f211e4f5fc20423a2ca9d07010c007fb0f1fd30d5c692b37a34beebd9d', 'sentSorted': 'd91476b7979bf8d6ef988d1441200d7e9c53e834e40db13ce8cdf4a6d8f810b2'},
    {'planned': '8287849b3f285205c96cc0f1b525d25b95a35510a8a04429fb6f0811712e94be', 'sentInOrder': 'c303a2800ec5a546e49f6fe1ec37a3991642bdd5ecd7deaa1e0b20fd418ee13d', 'sentSorted': 'c144ff59c9d0a1d2445dfc1eb73cdf0f8c0e8506a3c18a5f5a29938f1cb54ebd'},
    {'planned': '79d6effe3529f43d745206e13b22e9d8e0f095ba139636019a346c4b88b4e994', 'sentInOrder': '5700c8080499f1db598b902635a87a0a5643a2cbfee03d5590d6eb00d59ba546', 'sentSorted': '8697b88f8bc0a4b9972aeec747044fe774c1f44e71a083c4e77208e3a0d70466'},
    {'planned': '52da7a32c4e72e21109897a9d3ca0b1c0cf3f4684dc0be1390ad104fafc9621b', 'sentInOrder': '3519e74fbba7b21fdf2ca9583825c9ffe694e6c667339c0c547a9d25ce3cc145', 'sentSorted': '3a16e240a6cbb2052d65813e5afec650d3a5ca3bc5f5a04ebf4b15e4036b332b'}],
  n12: [
    {'planned': 'd787bd7f617b29ccd1afee8dc97bf4b936983b3f7a9f626def45d97d6a6adc09', 'sentInOrder': '1183d455db180433e46bc634cacbe74b96df55692cf6a13a962ed180bb25312e', 'sentSorted': '5592ecc27c956b960f7cd9fe71f2c4104a2550650acb1ee318d5f430bad40428'},
    {'planned': '157db24c020bfd209bbbaa99840a56ae42c43b4b0b2e1420461bccda101051e1', 'sentInOrder': 'db4ab8348e156ee20eb95dce003b15b62c26a44bfac50ba86e29f72a84609a50', 'sentSorted': 'de92a1ed26ea2c005115b20fdc37b5937fe51622920e608a6d8972a369631d8c'},
    {'planned': 'd339664be11dd6d3b17cd912800ab261358709c26af20d714a2c8ba1f98ea02c', 'sentInOrder': 'c1ef8c80dd0cc1ceaf403a5161933c0360c170c7c837cf27bc9e050d9dc26e2a', 'sentSorted': '3bfb85066a392c23039d9e93c97115fe35a71198e75edf665fe6e3d9f3ff5471'},
    {'planned': '422b10cda9da4c78fbe61588257cba5a102ff2d5f2b62d9209fe02bc6cd25810', 'sentInOrder': '0fee406904a49cccdf26847fe33567abd7da0d51beebc07341b4c89860db33ed', 'sentSorted': '13ad496b17f0033b2a7cf4a7c65c028bdcd73415a3f437c7732e6d465253692d'}],
});
/**
 * H3 (`sonah.narrative/16`, `sonah.challenge/13`: a claim is every statement the agent
 * makes about the state or the outcome of its work, hedged or not): the ONLY values that moved, as /16 and /13 send them —
 * every narrative request's task text and output contract (`planned`) and every challenge request's shared system prompt
 * (`sentInOrder`, `sentSorted`). Rendered back as /14 and /11 sent them (h3-hedged-claims-fixture.js), then as /13
 * (M33 N), every case is M33 H's byte for byte (the M33 T test below). The number of requests sent, their labels and
 * order, and the window failures did not move.
 * H3's review repair (2026-10-06; /16 and /13, were /15 and /12) re-pinned these values once, in place: the relay and
 * supportedBy rules' example phrasings are gone and a hedge on a relay is not doubt — the same requests moved, by the
 * same fixture's texts, and the render-back still reproduces the values before H3.
 * The owner's decision of 2026-10-06 (still /13) re-pinned every case once more, in place: CLAIM_WORDS_NOTE lists no
 * kinds of statement (the quoted text may narrow what the words assert and never widens it), so only `sentInOrder` and
 * `sentSorted` moved, by the same fixture's text; the render-back still reproduces the values before H3.
 */
const MOVED_BY_H3 = Object.freeze([
  { planned: '3742acbfc11120ffb6fe6f3752b41d3ec6993c6353f6ee69da553afd5358d1a2',
    sentInOrder: '5f43ff45c1e93475121dacff14204b3bdd207d252b83aad4ed3f35efb90ca68a',
    sentSorted: '73881b5416ceccde6d077251da7378cb3e1f7a92076891e06394a40e0b2b8aaa' },
  { planned: '5f5978a3b970e816aad9533e070aee605842fccc9f20466759ec15cf3194f7c1',
    sentInOrder: '1978ac44353d24ab434f64594b53479bc7ffaac11ebd19006e3fa73409847441',
    sentSorted: '885d37744832f64bea00dda2a6992d4ed03cf6e7f0fa7716e3b10d21d17c531b' },
  { planned: 'e6f8f3a19feacb9b519aa959cac6876c09da8aab99d7a21dda0e6611672cfa98',
    sentInOrder: '01a6929ea37d619282ccf89333f24b52adaa83ef9c061b3185d3fa4ab21624ac',
    sentSorted: 'adf766b4a052a243723f783e5ea339feff460c9db3dcf3af752794f397ac1bfa' },
  { planned: 'b6afcc8eae6139283243c73f9cc7fda2777ce9cf07a2a4bc4033fb56e28d0204',
    sentInOrder: '0fe35b14c06e38dffba47d95d4af8d5a975bb566b35b3143f3773352839315a0',
    sentSorted: '99ad757e977a7a9e4b382773d8213dc20b67f7d5abee69273757997ac93f11a4' },
]);
/**
 * M33 integration (2026-10-06; `sonah.narrative/17`, `sonah.challenge/15`): the ONLY values no branch's constant above
 * holds. (1) `n12`, `n13`: the `linked` case rendered back as /12 and /9, and as /13, sent it — M5's helper channel
 * (M33 human-words repair) and H1's and M1's command moves (M33 outcomes repair) on one case, which no branch built and no
 * text render-back undoes; every other case reproduces each branch's values exactly at both levels. (2) `current`: every
 * case as the merged code sends it — H3's, the status fact's, G3's and M3's texts with those data moves (`planned`,
 * `sentInOrder`, `sentSorted`). No case's windows, number of requests sent, labels, order or window failures moved.
 */
const MOVED_BY_INTEGRATION = Object.freeze({
  n12: Object.freeze([{}, {}, {}, { planned: 'fc8c57e780a7c1408fdbd51a5fba419684b97939a914607a4f20e1ec23947a46',
    sentInOrder: '0db6be9c0711bc94e586aa80faeb43df617e71a59ffa18f1fc33df3405433995',
    sentSorted: 'f360f1d1e87c9d2c062f525fca7bc56fa12fc7580e117ae90f8614db94ee4b81' }]),
  n13: Object.freeze([{}, {}, {}, { planned: '53055c762d2f27415d301a480d0a6cd7a294280fd1342a022c3a25ae57aa2d9c',
    sentInOrder: '00db1225d00c27baeb8c1696644a975d046ca6fc9ab5e067fbb80d9ae77f1a7a',
    sentSorted: '20a05a84d70d68a3871ddb89125f0b513ba803a16a8dc961d99a77860220842c' }]),
  current: Object.freeze([
    { planned: '209976a0c3cd48e2669656011d4fd0b23c80ad23f9b98da7275fcd9adbbe199f',
      sentInOrder: '06ba4d4fd53f3592ffe570c6d313cb11f4aeb48ec7d9fbca8e9fd7cf89064eb5',
      sentSorted: '3a3447da964da15719ac702b6ffdc6fd34f018601d40e580a1b1132d8cd98798' },
    { planned: '0daab46fbe96e0f77357f1de61350528ba1f64dce25b3e4876832685a6cb4ef4',
      sentInOrder: 'f58c3737b843b03d632891fab1259731c6c752f1e757843f90c154de5511ab3a',
      sentSorted: 'ca355cdb2214495478aaab171cc52680aaf9e74a41961b022b745c701daaab07' },
    { planned: '97752c484f958a932c65b726d42ffbbb9fa15a17ce680b4a143154018109a9f1',
      sentInOrder: '57851b7d79c9c5f093e00260d37bd98c325f44f68f9915bd7aa5a49373516c6c',
      sentSorted: '1ecf3899591e9c03a2d9dacf42e27826bd6adedf2f02ac17eb56959831f81d60' },
    { planned: '846c777cff3855c72eaa0ab9db3ed0cb13cbd0701b9b37375b12b691ac4821cb',
      sentInOrder: '94569cbd2d7cac56881953f651383ce4965f39347c28bf55dd07b3902554181f',
      sentSorted: '56d89c5270a136b45e9534334fc5a3d10cd08869ae16437f3d60958fbb81cc6f' },
  ]),
});
/** C-01 event identity (stable event ids): every render-back adapts as before — the same ledger with its recorded
 *  identities taken out, so every event keeps its positional id. `CURRENT_MODULES` adapts as this tree does. */
const MODULES = Object.freeze({ sliceLineage, redact,
  sessionFromLedger: (ledger, options) => sessionFromLedger(withoutIdentity(ledger), options), loadSessionEvidence, runReview,
  planWindowRequests, captureCase, windowNarrative });
const CURRENT_MODULES = Object.freeze({ ...MODULES, sessionFromLedger });
/**
 * Stable event ids (C-01 event identity, 2026-10-07; `sonah.narrative/19`): every event of these sliced recordings is
 * named by the recorder's own identity of its row, so every case's narrative and challenge requests moved by their event
 * ids (and the scope digest over them) alone: `planned`, `sentInOrder`, `sentSorted`. Adapted as before, every case is
 * MOVED_BY_INTEGRATION's (the test above it); the evidence package's render-back tests show a request then differs from
 * its positional twin's by ids and id digests only. No case's windows, number of requests sent, labels, order or window
 * failures moved.
 */
const MOVED_BY_STABLE_IDS = Object.freeze([
  { planned: '825fa84a368c24c0b60ccc7c4b9abcf3c8205b56414a7dbcffe81fc80816b8ac',
    sentInOrder: 'ad7b925611d1b814fb28e91e390f8e22cd0ff7f3dde38d5d654521179a5a2572',
    sentSorted: '61de87179ce2bea1840d8796ad4a6c5ffb626296b9e1393d346d7de3e63f2304' },
  { planned: 'ef98d0572610b0ff3f386204a8af21e94e34dcefef078e98f1a964f04e5eed46',
    sentInOrder: 'b97deadb97fccccc0a7b004443590f545aef6ebfb600c1429359fd638ff6e0ca',
    sentSorted: '55ae8cb62b75dad34aab0bdafbcc864e7ffce456ee8e021c970d9f1ac1707540' },
  { planned: '839342549b60840e874e3a643e07b7a5b346baff7b373ab156b4ce9c75ca0288',
    sentInOrder: 'd0554ce8255d06a9e99a227483aeb89fd94df93c596a7d7d9a788fce5ab24e2f',
    sentSorted: '36e95cff752faf853e1af148efc71969bf180e78529bb592bcc34897b9c20d86' },
  { planned: '6366e8f9d9a73674ae4fc09595c46d01d0bf193c5096cd59e972160ed5ebfe31',
    sentInOrder: 'aca9d4eb26274abf8a80f41c79271a9e67bbc76946744600ec2d003ea61c4556',
    sentSorted: 'a405a4e60760099733f1cbf05771dd271e7a4db4b355c99b1c9d553c91721ce7' },
]);

test('M33 H repair: rendered back as /12 and /9 sent them, every helper-brief case is M33 C2\'s byte for byte', async () => {
  // M33 N's texts are rendered back first (/14 → /13), then M33 H's.
  // M5 moved the `linked` case's data, which no prompt render-back undoes, and so did H1 and M1 (outcomes): their values
  // are each branch's, rendered back; the status fact's and H3's texts are rendered back first (`modulesBeforeStatusFact`,
  // `modulesBeforeHedgedClaims`).
  const cases = await captureHelperCases(modulesBeforeRelayRule(modulesBeforeForbiddenEdit(modulesBeforeStatusFact(
    modulesBeforeHedgedClaims(MODULES)))));
  for (const [index, expected] of BEFORE_M33_H.entries())
    assert.deepEqual(windowingFree(cases[index], index), windowingFree({ ...expected, ...MOVED_BY_M5.renderedBack[index],
      ...MOVED_BY_H1.n12[index], ...MOVED_BY_M1.n12[index], ...MOVED_BY_INTEGRATION.n12[index] }, index), expected.name);
});

test('M33 T every helper-brief case plans and sends exactly the review requests base 23afc8a did — but for the bytes M33 C, C2 and H moved', async () => {
  for (const moved of [...MOVED_BY_M33_C_RECHECK2, ...MOVED_BY_M33_C2]) assert.deepEqual(Object.keys(moved), ['sentInOrder', 'sentSorted']);
  for (const moved of MOVED_BY_M33_H) assert.deepEqual(Object.keys(moved), ['planned', 'sentInOrder', 'sentSorted']);
  for (const moved of [...MOVED_BY_M5.current, ...MOVED_BY_M5.renderedBack])
    assert.ok([0, 3].includes(Object.keys(moved).length), 'M5 moves a case\'s planned and sent requests, or nothing of it');
  assert.deepEqual(MOVED_BY_M5.current.map((moved, at) => Object.keys(moved).length ? BASE[at].name : null).filter(Boolean),
    ['linked'], 'M5 moved the linked case only');
  // M33 N (`sonah.narrative/14`) moved every session-only narrative request by its three forbidden-edit texts alone:
  // rendered back as /13 sent them (`modulesBeforeForbiddenEdit`), every case is M33 H's, byte for byte.
  // The status fact's texts (`sonah.narrative/15`, `sonah.challenge/12` on its branch) and H3's (`sonah.narrative/16`,
  // `sonah.challenge/13` on its branch) are rendered back first (`modulesBeforeStatusFact`, `modulesBeforeHedgedClaims`).
  const cases = await captureHelperCases(modulesBeforeForbiddenEdit(modulesBeforeStatusFact(modulesBeforeHedgedClaims(MODULES))));
  assert.deepEqual(cases.map((c) => c.name), BASE.map((c) => c.name));
  for (const [index, expected] of BASE.entries())
    assert.deepEqual(windowingFree(cases[index], index), windowingFree({ ...expected, ...MOVED_BY_H1.n13[index],
      ...MOVED_BY_M1.n13[index], ...MOVED_BY_INTEGRATION.n13[index] }, index), expected.name);
  // Every other value is 23afc8a's: the windows, the requests sent, their labels and order, the failures.
  for (const [at, c] of BASE_23AFC8A.entries())
    for (const field of ['name', 'windows', 'sentCount', 'labels', 'windowFailures']) assert.equal(BASE[at][field], c[field]);
  assert.ok(cases.every((c) => c.sentCount > c.windows), 'challenge requests were sent as well as narrative ones');
});

test('M33 integration: every helper-brief case as /17 and /15 send it — only the narrative and challenge requests moved', async () => {
  // The D64 wording's proposer sentences rendered back as /19 sent them (`modulesBeforeDisclosureWords`).
  const cases = await captureHelperCases(modulesBeforeDisclosureWords(MODULES));
  for (const [index, expected] of BASE.entries()) {
    assert.deepEqual(windowingFree(cases[index], index), windowingFree({ ...expected, ...MOVED_BY_INTEGRATION.current[index] },
      index), expected.name);
    // H3 moved the same values on its own branch (MOVED_BY_H3, kept as its history); merged, every one moved again.
    for (const key of ['planned', 'sentInOrder', 'sentSorted']) {
      assert.notEqual(MOVED_BY_INTEGRATION.current[index][key], expected[key], key);
      assert.notEqual(MOVED_BY_INTEGRATION.current[index][key], MOVED_BY_H3[index][key], key);
    }
  }
});

test('C-01 stable event ids: every helper-brief case as /19 sends it — moved by the event ids alone', async () => {
  // The D64 wording's proposer sentences rendered back as /19 sent them (`modulesBeforeDisclosureWords`).
  const cases = await captureHelperCases(modulesBeforeDisclosureWords(CURRENT_MODULES));
  for (const [index, expected] of BASE.entries()) {
    assert.deepEqual(windowingFree(cases[index], index), windowingFree({ ...expected, ...MOVED_BY_STABLE_IDS[index] }, index),
      expected.name);
    for (const key of ['planned', 'sentInOrder', 'sentSorted'])
      assert.notEqual(MOVED_BY_STABLE_IDS[index][key], MOVED_BY_INTEGRATION.current[index][key], key);
  }
});

/**
 * D64 wording (owner decision 2026-10-07; `sonah.narrative/20`): every session-only narrative request's item 6 sentence
 * and output-contract rule ask for the agent's statement that it went against the human's instruction, so every case's
 * narrative requests moved by those two texts alone: `planned`, `sentInOrder`, `sentSorted`. Rendered back
 * (`modulesBeforeDisclosureWords`), every case is MOVED_BY_STABLE_IDS' (the test above). No case's windows, number of
 * requests sent, labels, order or window failures moved.
 */
const MOVED_BY_DISCLOSURE_WORDS = Object.freeze([
  { planned: 'c2f315e508f12abf8f479f68109657e0dce127cc8ca92ce8e0e017b77e9750ef',
    sentInOrder: '818a6104c39111ff18bab762d0f74198bd10b5cab1603c83ee060589dbd7fe10',
    sentSorted: '8284a15b20b2e6da47d91dbd9f7af916b50de805fd7957b10d07e8dc4f952bf9' },
  { planned: 'cd47b6f523c13a1575130b01dbbc0d8ad4f7af3dd5cd74acb14e480e9fd6bc1c',
    sentInOrder: 'e5490bcb552c066d4a05ca82ed2e546ba2dd1878ed88fa3e495fc30ae6841d84',
    sentSorted: 'eb0c5d18b4607ffff1b1db8cae344b5fc49513e81930f0201bc9f68236d7d59f' },
  { planned: '61c743706059bc3195e3661240e02258997834125cd9d33f8189a75e7af458e2',
    sentInOrder: '81e8deeceb085fa2cf61b4f683c5566742820b7c2f5c23f52701e3351c621d6c',
    sentSorted: 'dae25cd486e665d15ad2ea5d4c4099ca6002dff666705600cb49ef68795c1b3d' },
  { planned: 'ff9d7e84bc2f77fe9ef413e6759d18088816ef7a21ae866450b3293f8540da09',
    sentInOrder: '6d9f55fd16d43a0a3e718725dccdc41b4d57f5edd8451fdde1c63eb5d5edee0e',
    sentSorted: 'ecd65e097ff52bd1e57716d22439c55dc50b4c52a2a88c9284ef7cc1064d8c76' },
]);

/**
 * M35 windowing (C-07 "M35 windowing"; `sonah.narrative/21`, `sonah.challenge/18`): the ONLY values that moved from
 * `MOVED_BY_DISCLOSURE_WORDS` — every case's narrative and challenge requests (windows by segment, carried context,
 * trims, aliases), and the `linked` case's windows, calls and labels (its helper is a session of its own, so it is two
 * windows). A text render-back can no longer reproduce an older request capture (every window moved): those values are
 * kept as the record, and every value M35 did not move is still compared at every render-back level (`windowingFree`).
 */
const MOVED_BY_WINDOWING = Object.freeze([
  { planned: '5396cdac3d1dd384758ee45b6851ae876e23df809830e533935d36e1d5f14194',
    sentInOrder: 'b4f7251bf40f27ae4f481f8aedb1be38fb74f3ce7d33100db445475297c4ccd7',
    sentSorted: 'c854efed661aae786f81eaaf2661134654e4e61e53b03f6210a22452419c215b' },
  { planned: 'e9232f111ec92b2958b152ed316e2e866c29c785106067b1e704910fe54df5ac',
    sentInOrder: '36017fe2cf2e8d1524f63ab7412e05615c5d47c5087126e30669170b5a84686c',
    sentSorted: 'dd1c6e17ae24bed75d19f7e09e8c24e5f083fa713a64a0fa21f37f746ff410ae' },
  { planned: '5aa7e1761564a513349c1e925dfef02d293695d80a0ffa1943e5917bbb498551',
    sentInOrder: '99d6d2436659d06f8c6dce0181462a873a0dd3a59d6a8e0f04006183c51646a6',
    sentSorted: '55a1bf1a5a88585dbe6e77bf9adaf15d25d0c78c32f3c2362c51a16c6d5a0c9c' },
  { windows: 2, planned: 'ce218633d83fb31fcdae0690e576796dbd0051c53f1d3eea533ba87a4bbdd963', sentCount: 10,
    sentInOrder: '218f81ebb52b331e9766d743b5743b3a4ba3a65c72439677a86550a0f8ada777',
    sentSorted: 'b60fac9bd0763481b803e0fa418817e207988aa03436b2ed72ca18329bbb12bf',
    labels: '3757438135b80ca424c46ca2c91599b867da8da264d14d48fa89884e68a890a9' },
]);

/**
 * M36 phase 2, the window format (D68 L; C-07 "M36 window format"; `sonah.narrative/23`, `sonah.challenge/20`):
 * the ONLY values that moved from `MOVED_BY_WINDOWING` — every case's narrative and challenge requests (each RESULT opens
 * with its label line built from the recorder's typed fields). No case's windows, requests sent, labels, order or window
 * failures moved.
 */
const MOVED_BY_M36_FORMAT = Object.freeze([
  { planned: 'd3711e4fc65a10aac6dda7f2d1d5e6e018b73f105570f0aed057c58e7fa88725',
    sentInOrder: '8bfe9288f91b133ad54813ec5bcbc6957c53cb886fc7b5eccc22ff93892b4028',
    sentSorted: 'd60c095746c467d1ccb8c5ec9c72f16dc522b90d3d9681c5274dd8b8e1747133' },
  { planned: '3079d121d90e719016c30bb6fe7ac43b1318ef9761dbde0c203b6bf8f43f8bce',
    sentInOrder: '05ddabcae0a0dedeb4e1f631394ba6bfaabb340cf2a444d51831c36367ec9844',
    sentSorted: '6b128466f5100992c1df593adfb9383554ff41fe8403e36d1ce377d82fdd6f22' },
  { planned: 'e849ffc033f5c95c8e44f978ea38ab0afce88c07c84f42d2a7ec87b50ba4a90f',
    sentInOrder: 'b8c01294e4d91ac0e7c2bb5718098c4d3cb015a5b7ef2c01b2201dafc4e1e0a4',
    sentSorted: '0e4bb47c0ffcaf5b728fc3b29413f667307516b21159cab3a8fe75a65255756c' },
  { planned: '193176deeb09ca1a27d73cf8daa4d319f5c00b50d6c87d71e576e7f59cb25976',
    sentInOrder: '63d54f3117eb72097cc1d77430b74bed772f459ddf90ada587ad122d9a5027d9',
    sentSorted: 'd87fef24d6fc06b82ba8c9a085eb4371320a8fcce3788c2be94b1c6ff915475b' },
]);

/**
 * M36 phase 3 (D68 K, Q, F; C-07 "M36 packed windows"; `sonah.narrative/24`, `sonah.challenge/21`): the ONLY
 * values that moved from `MOVED_BY_M36_FORMAT`. The first three cases' narrative requests moved by item 1's actor
 * sentence and the session-only contract's `evidenceRequests` member and rules alone (rendered back,
 * `modulesBeforeM36Conversation`, they are phase 2's). The fourth's helper is a small session, so it shares its parent's
 * window, under its own heading: one window, five requests, their labels and every request moved (D68 K).
 */
const MOVED_BY_M36_CONVERSATION = Object.freeze([
  { planned: '9ff99038ff5468c74de65db2d5a7da5c2471e4b01fefa879065fd8512ac20e46',
    sentInOrder: 'f43dc5bdac7318c0e6db9f310bb522319ea95b8b9c0e948e223962faf0628d48',
    sentSorted: '50eee090bbcfffa5f5ed7086ec8555f6d58cbd2b7a694c1c7b52a29e8918f17f' },
  { planned: '390dacf950c823ae8a3b46814f17475b3ee2b5e53e4de7bd72e33bbc0ad4b6c3',
    sentInOrder: '2e7733d4173fb59b8ad56d8fceebda225a8f9207a2316111eea99a1ccdd67266',
    sentSorted: '4dd3f32ce5c0a094d1f095076f4cb9066df855a30b64bcdf38b5dda5a80c4374' },
  { planned: 'a7eda9aaac9174ae36b0843ca3c254638ba0706d2abaa765e607318667bd5415',
    sentInOrder: '6819bcc169ea291dfae7da7dac7a3eb9252b4319cb992c3e1102d3881f9eb6a9',
    sentSorted: '3b0464aedf37e5db7833649edc3b0e89c1964a740bccd980e8346dd441ecc74f' },
  { windows: 1, planned: '4d68ffcab4b8de1a3d4773686d413ca49f99b22f31b32c57b1ca628c8601268c', sentCount: 5,
    sentInOrder: 'bd0f7b525a196bb322337ac2217a5d5729120f8e300a2c52a85135019f0740b8',
    sentSorted: '841668a26da2778b0444b3e34da5bc2adb4478815b694638b24c1d8562a4daa3',
    labels: '75d10cb3d3d7d9d9824ed96454ab4d75787e567b89c960d843bb563652c01f73' },
]);

/**
 * D71 (S2, the reviewer brief as the checklist): the ONLY values that moved from M36 phase 3's. Every case's narrative
 * requests (the brief as the system prompt; the window in the checklist's reading order and format) and challenge
 * requests (one proposition per item, the session core and its notes) — so nothing renders a request back to phase 3's.
 * No case's windows, calls or labels moved.
 */
const MOVED_BY_D71_BRIEF = Object.freeze([
  { planned: '626dedb50b1f1a8b24513fe245aaddd2d87661b45218bb044636a90fd034cb96', sentInOrder: '0bf071afa74cae80abef599db430d2f4b55ef66a42b5d54831f789a73ab5aa60', sentSorted: '40bcbbc2182c1f909c30aeda6a1d027393326750a7472264173a1deca67ec692' },
  { planned: '220e669bc0516d52571f3cded492efcce293127ba72d32f4bc565a0d7b4d95ec', sentInOrder: 'e33c56c2f5535143a54cb43a098cad6f1e826d2a2983e690ca4c483ef66f6a19', sentSorted: 'e1803d188ca2c620647920820103368f5e91af09a6e828f76f83428cb9295723' },
  { planned: 'b5ca536d09e396d56a0e8b4747d24df2dfced123e433024fa39c5b19fe75bef3', sentInOrder: '4831fca895e13fd7426a279b2091bc220aba19bccb7aa385c0e0ac208c0cbc7f', sentSorted: 'f6faf1cfd0a5edcf9e46f03ac4bef76b9341242ea0829680c9b2820d2bd61c93' },
  { planned: '71ec9142cf5ccd167839ec0df7759edda51730192e8fe66d809b64836356d91b', sentInOrder: '03d1073363bcb4a6491c064a1065598134ac3d7528f6215e3ad7921b2bf40deb', sentSorted: '44120c8851c62fe0e91323de59334d7fd256b9a70ac8b6442e706a80188217df' },
]);

/** D71 (S3, the new channels): the ONLY values that moved from D71 (S2)'s — every case's narrative requests ("About this
 *  window" lists the RESULTs step 4 answers for; the brief's last step is step 6; the brief itself) and challenge requests
 *  (the session core's sixth role, the claim note). Nothing renders them back; no other value moved. */
const MOVED_BY_D71_CHANNELS = Object.freeze([
  { planned: '08a3719bf97b2f9057d0825e225a92924aea3e613c4f76dc88fa647be32e5b6e', sentInOrder: '01ce394d55e839cd3ed2702d7f30a898c27348c93d3194b77f77e2e0b94112ea', sentSorted: 'decf05d14e83b0a27b907e2ba7e9f700b42b5bbcc74e57e36cd93751bf769806' },
  { planned: '8ec1f59af3859f31d87285655d8581aeafe64b04291a2429619b8cd357af9509', sentInOrder: '83c6f6bf33acfbfd03c0b51708f14a8beeeba6fac0a4dd25fc4e77bab4a25162', sentSorted: 'fb9ac76d6c9a1795f2f3b81d30f608dfcc1586642c409dfff5104bfc6e63fce6' },
  { planned: '992dec7e1919c7e9fedf94f12c504e41a3ddd0397353ececee5116f5c89a9d65', sentInOrder: 'f8512ac66b2d52f151540dfff26a8054df5b833924983b364b2a37166ae39c97', sentSorted: '3fef0a89e14caf17cd12ea59babd3578453b4153d07c442563e95f5eafc07b08' },
  { planned: '49acf6051b4b71a145f838404c4bcf7113bb9f4a095de5c82be90d18557064af', sentInOrder: '3f2a42441b88073d92a01076eb4225a2b85a7e613e5d8814cd3ba1f7ea9cf573', sentSorted: '317ac86471482f78beb057603429129a4541eea5a50836998a31a93661575a6f' },
]);

/** S6 (the fixes of the S5 review): the ONLY values that moved from S3's — every case's narrative requests (the brief: a
 *  choice not to act with no actions, a claim's `restsOn`). Nothing renders them back; no other value moved. */
const MOVED_BY_D71_FIX = Object.freeze([
  { planned: 'dee2ace9750760b58565f7f18e02dde466ede3a98ab04ddef9d4924d5ca2ac0d', sentInOrder: '064b82bc9f37574baeca02fb2aaeab948623754e2f796daa0fb5626857d6c8f1', sentSorted: 'b8d3751b51fb787d91b2435bbbbfd7f657bce09876f44c0b18940372a6f2d21f' },
  { planned: '4fffdf18646d30f092b8ff0fff0b1adbe61574d3a48b92820e1c5ba8cfad3ec6', sentInOrder: '92da1e84b00940af6a273e236b86e3e057c38134142152e503e81a3f99784eee', sentSorted: '0e70f8670837a5abf7bcccb509485fcc0641e52b9c54578024e1d96802eafa50' },
  { planned: 'fa6dfaa2c9f9e3d2570f8c8cd8230df7b4832e31f1bfec27bdd9cd98b8826e81', sentInOrder: 'de9bc4d3008b76a84fd8ebe44fe928e2c4a12eac8185cebdc9dc0561e11dc7e2', sentSorted: '48102bd234da5890cb31f69fe036bc17d23662c30500bc4c74de138e27e3f6e6' },
  { planned: '05540662efb49c65f6c5c3c6a93feb5662cef8e784f05b3c1c1e5e2c68252277', sentInOrder: '04828d0f789b2468e6d8ed6f2a40c50ae9abe020d3b28f2743c097ec6c9a9d0d', sentSorted: '062d2eec636dc7c96c5cb694a5503c33a6e1e28e901bca7882d0192a2d524b79' },
]);

/** S7: the ONLY values that moved from S6's — every case's narrative requests (the
 *  brief's restsOn and step 4 sentences, the failures line). Nothing renders them back; no other value moved. */
const MOVED_BY_S7 = Object.freeze([
  { planned: '89368bf54151ee6076eca8dd40f551601bba7276d6e7d02c49f20b04b9b920ac', sentInOrder: '721c5378f1a5916520b16a10e4413e56551c0e71cf641c192cc10e83b49e9a98', sentSorted: '45b5eefbd9f94f81bb2d66e04b97aeee78c7513dbc5bfe28732f0a544adcfbeb' },
  { planned: 'f7694bf74a6704db464fa6814f5b0b40ea249f40c8a09f50eb7c8258a335d80d', sentInOrder: '301a7b22300e820386fd68b114821e9d031b3b607b0977bd0f24f35754c806a2', sentSorted: 'e2bc6ca7a17c7fc30179328a39f14029dc65b41c285b6d53c638a8dfba43d771' },
  { planned: 'adcb5eaee5cb84bc6f44e760bb9479f81e01a515ed0408bec7b470fd44a63b4e', sentInOrder: '857482114c40b8a34b7f5a8803f387e59f26d6f033f7f596cce5a1a97cac5d1c', sentSorted: '6d71eba0e7c926ce9775627f575a2960ba57b0c64e3d7f1fe496501efb3ea3e5' },
  { planned: '6f39c1c80891ee35c2f72670c843d69da4a8b07024259e726af71ea7c4904800', sentInOrder: '6f96e2cfbc7bee688fd79af5539bcd5eebaf6215f8beb51466bc1cf904fb1834', sentSorted: 'ac7746f074b2e06587c280e633ccac222fffdf0504a305cc6a0339cd6b545e82' },
]);

/** The column fix (owner decisions D83 (2) and D84): the ONLY values that moved from S7's — every case's requests
 *  (the brief says who decided a decision; D84: and that "made without asking you" checks the shown
 *  project instruction files too; 2026-10-13: and that "you settled it" is words that state the choice's own answer,
 *  and DECISION_NOTE never says to refute a decision those words settle, D84 (3); the settled-words gain: and that such
 *  a choice is reported settled at the level the words address). Nothing renders them back here
 *  (m33-integration-fixture.js `textBeforeFixColumn` does, in the evidence tests); no other value moved. */
const MOVED_BY_FIX_COLUMN = Object.freeze([
  { planned: '1e55dc10eaf24b0fde45592b8037c1bf5dba9621418e8d4ddd4c37f1d2fc28ee',
    sentInOrder: '462c091ac08bd47230291f555f4535e1005ea2cb9a45c8ac6f2491307b4c14e7',
    sentSorted: '95bd6cd3c4e0e5a0f5556d20cd3f6271fd5c28c3b718df63194829b112bb6976' },
  { planned: 'bff6a0e8638402900e790187f1cb3d593f8e2e8a036634a375f11b237ffe8c05',
    sentInOrder: '9ffbf809dfa196c05aa7ceeee5f4a829ddcb3f49eb8f88226ef5d50d9918f69b',
    sentSorted: 'a7b2b01ccbf0494836567ac81f1b2c496a9af426acaa8c515a42c58c55b6210d' },
  { planned: '45c0ed34b56be919fe3329dc188a3656906923823c04cbaea3cb30df50f39ef2',
    sentInOrder: '086a26247fdcffd82acce660c56d6958e472dfcaf41ea7d3d95504a43bf69c38',
    sentSorted: 'bc7343c0da7cebb660718c7bf1d6685f86b5f4968be9d6646f1fb3659529ad3a' },
  { planned: 'dc9895c925eb5bf7433b12904f9f24e44185583d6a5c09467a1e765e2093cb66',
    sentInOrder: '26fa3fc2d4285b83b375c8420c0b14405ec19886739100c6237043909c70f2e3',
    sentSorted: 'b7c2358aced5bac994ffe6f542773ba964d305788dff248e81f1f4318dd68dfd' },
]);

/** The asks fixes (P1): the ONLY values that moved from the column fix's — every case's requests, by the brief's one
 *  sentence on a run the human asked for, refused at every attempt (`sonah.session-review-agent/9`; rendered back by
 *  m33-integration-fixture.js `textBeforeAsksFixes`, in the evidence tests). S3 moved none: no case's challenge refutes
 *  a requirement. No other value moved. */
const MOVED_BY_ASKS_FIXES = Object.freeze([
  { planned: '5f4993cf8337e7500edadd7e830ee89e020693e1af0268e660b58ee1553353a6',
    sentInOrder: '82bd38460b0f5abae27f2ba862552876517c2d6d18fb8bba3fc2de10c07b493e',
    sentSorted: '4fd71618591b257eb872770536bb6b78c92b9696fdb8db1a8b0bccd6ac20a9be' },
  { planned: 'aff02b387834073fb9024847aec2e6096077b2b32bc4355cae19d77db8add5d7',
    sentInOrder: '401485490d940d0825d815de8f754dea8bcced76db7dab1903a20c8d5116374e',
    sentSorted: 'e57c1f36f42025bcdb0c97df70193dd8e5425d5a2914f626840360c9746d0422' },
  { planned: '1a92361bd74b04fd9940ce257d747f2bb051536a7c77e57864036c6ac1100406',
    sentInOrder: 'cf3519df9586009b202f985b5d3acc042e6713f6c942f5b9b012affa1a0640f4',
    sentSorted: 'b405c5d590757e04b1e2604c2d7160b88d17a8298dc72c8c3936aaf1f5993e1e' },
  { planned: 'f805ffbc94954d84556a84063a2259d18f8209349a9c783e6d9235e792122ae4',
    sentInOrder: 'bd1039b956e1af4322cd4ef7e4dc776aadd201936653b9a64190e61d16cd3fe9',
    sentSorted: '1769379cb7e879ddb3290b0fc8386beaa53de82a7c4cdd66aca874bb1dad5a2f' },
]);

/** W1 B: the requests moved once more, by the brief's texts (W1_TEXTS; `sonah.session-review-agent/10`); W1 A moved none
 *  (no case's challenge refutes a decision). Rendered back (`modulesBeforeW1`), each case is the asks fixes'. */
const MOVED_BY_W1 = Object.freeze([
  { planned: '4c6fc0597a006d1b5282b684a1738135fba34c977e8f6995cb397eb7ec263e33',
    sentInOrder: '741d8e89ec7323d7ca538da42fcc90b6a2bb3edbdbd33dce82a7f1c2ae2dddd9',
    sentSorted: '1ecaecfa9b945abfd7996ebccd8be6690e6bff15afa565d1cec251ef82ee001a' },
  { planned: 'f969e6064f87cba23fa38aba2d1f1d15fbbe280b0ba8b66ea6d4389a6f174ac7',
    sentInOrder: '7284d5cec313d7fc261b3da30c82f2c9247c3ba8b9a6ee6fc34b4d0750fa7599',
    sentSorted: '57cb1ca9d9c98830d6a8f79fd24a6a8eb83d54e09c5db02dc2c4dbbf691e8a48' },
  { planned: 'dab2cf5ace830a25b03c6ff94553f76598958b5ed64a4aa1753cb68a43a4c297',
    sentInOrder: 'eabed45a5f5f813521c7b298088cd550ce55b90f2c4e27e76e2d096dac74de37',
    sentSorted: '4501c1940d6dc0a4c5aa6bafec847a28b0af276111c70991d23e164ee3660d82' },
  { planned: '94dffd359d9d2b4f9eb9cdf43a54e2ecf6d64bcca7ba01db7de83f30968a0a8c',
    sentInOrder: 'c3a46fe78d05c950221d740a19157fbe186b04cb4b00e60eade5a477549d6625',
    sentSorted: '48495be8f99c35ba3b160d9f1af7b3239a9772575d0627a5dedb3295d1ea3fb0' },
]);

/** W2 (3): the requests moved once more, by the brief's texts (W2_TEXTS; `sonah.session-review-agent/11`) and, in a batch
 *  holding a claim-class item, CLAIM_NOTE (`sonah.challenge/32`). Rendered back (`modulesBeforeW2`), each case is W1's. */
const MOVED_BY_W2 = Object.freeze([
  { planned: 'b4911ba2f43b54c1f7dce01314eb8a2f040b84fbdbfa491bb4ddf148f26d9845',
    sentInOrder: '97644c1c678e572ab27b2222b9a674e3d055e5f2865adae95db701a035b19b69',
    sentSorted: 'd284872aad2b566d0a4d406b8a326def88b4c3c5ab708c2d807625586001725f' },
  { planned: 'e016650a8e2c9135d6ef8b49af35ac867c20016ab877d73be4324d5b45f9ce19',
    sentInOrder: 'e3616b9f6d828c2d3108226c7dcf332bbfd7935dc4e1589a9db4feaa3a837516',
    sentSorted: '2e4bda82b33ff39637a6720736c15f9bb6430c802bb65b0af0dd3852edbe85c0' },
  { planned: '12f7ca513eeb803425ac10c0702cab4c7af4092191ad560b02d098bd31267c6a',
    sentInOrder: '0db2f70f3ce4efbf8267e006b8205274b5d87e8e6b63f2c1957cc15488fc1a9c',
    sentSorted: '5ee170fb347cc6c76b5d03448fc3b422e83b1f376281d63c2f13d19c2b7df934' },
  { planned: '44f237a315297198a9fd0623605ba201ead081d52f05cf28caff31e90eafe5f8',
    sentInOrder: '2bc2c573d7c779876989b4c05ba767bc817a87fec4138f36d420afae6ca5549f',
    sentSorted: '17cda16c8212011b0c7dd4c99cc1d9d09fc9f095c8d9004c93b1bcdb78b73a7d' },
]);

/** W3 F1(b) and F2: the challenge requests moved once more, by CLAIM_NOTE's changed-since criterion and its
 *  failed-result sentence (W3_TEXTS; `sonah.challenge/34`), in a batch holding a claim-class item; no narrative request
 *  moved. Rendered back (`modulesBeforeW3`), each is W2's. */
const MOVED_BY_W3 = Object.freeze([
  { planned: 'b4911ba2f43b54c1f7dce01314eb8a2f040b84fbdbfa491bb4ddf148f26d9845',
    sentInOrder: 'fc5fe9d83fab4689f494b6d53481842fe7d37cffba90f2ad7edaf4601f55f58a',
    sentSorted: '3b48dfac01057c6591d8c729e1313e1a9121d46f1ea123ea73b0883e60346ce1' },
  { planned: 'e016650a8e2c9135d6ef8b49af35ac867c20016ab877d73be4324d5b45f9ce19',
    sentInOrder: 'dae0df65575bf4a342f68a84c86030acdf913a38a0eaed6b0cf0d69331440045',
    sentSorted: '126de32ffbc90e8e8fb10a45140c3332d0fd6c01862399fe9c46d96417982080' },
  { planned: '12f7ca513eeb803425ac10c0702cab4c7af4092191ad560b02d098bd31267c6a',
    sentInOrder: '90cb092cb0902a6db6d87606d1140a2b46900b3e2bbf26f2cfcf518ac6daf9e3',
    sentSorted: '7d272728471c3f737165ffd366fb053ed225ae3df9a281f7f9707fbf4b3cc742' },
  { planned: '44f237a315297198a9fd0623605ba201ead081d52f05cf28caff31e90eafe5f8',
    sentInOrder: '3c238970dbff76820547cf06d0dd6d5e7f9603ed0474c143f7a87cbf26fadab8',
    sentSorted: '3fc46ec36417e02e7df02cb5d8c346e788da0c6616cfddf72543488eb7a3336d' },
]);

/** The fix review: the challenge requests moved once more, by CLAIM_NOTE's failed-result sentence (FIX_REVIEW_TEXTS;
 *  `sonah.challenge/35`), in a batch holding a claim-class item; no narrative request moved. Rendered back
 *  (`modulesBeforeFixReview`), each is W3's. */
const MOVED_BY_FIX_REVIEW = Object.freeze([
  { planned: 'b4911ba2f43b54c1f7dce01314eb8a2f040b84fbdbfa491bb4ddf148f26d9845',
    sentInOrder: '810efcd0809a08ae14b777209788ac66d0f1790023c795076e6aebf3c7bd2d4e',
    sentSorted: '5207fd4dda9059633092e7dda8b5f2c50c27906c0fd6c1d42aebcf3704c04ec7' },
  { planned: 'e016650a8e2c9135d6ef8b49af35ac867c20016ab877d73be4324d5b45f9ce19',
    sentInOrder: 'dc31a1d1a75e022fe72a83955b4023c123b93d4d1eda0b90109cde1b656c24ae',
    sentSorted: '6e3175ac5c5b139244c38e200496c6bd3dd70196582bc0ae0bdb7af93bf03fd8' },
  { planned: '12f7ca513eeb803425ac10c0702cab4c7af4092191ad560b02d098bd31267c6a',
    sentInOrder: '9eff6799c630db5a05a5f056b61250f49504bd0129ee2e130bb10da547ecabf0',
    sentSorted: '7a6bc30b5304cb71cdba6fee43e4363b3a45b9e9deed6102eba0fae903e90438' },
  { planned: '44f237a315297198a9fd0623605ba201ead081d52f05cf28caff31e90eafe5f8',
    sentInOrder: 'd3eb528ca5d1ab80b5de02f2d4d5253d94fe70f0b4de1481c84f17736a81aff8',
    sentSorted: 'e60865a87a7f09f513292a17cda8e274bda672d8d13ec8857cefa510192c2c8c' },
]);

test('D64 wording: every helper-brief case as this tree sends it — moved by the two proposer sentences alone', async () => {
  const cases = await captureHelperCases(CURRENT_MODULES);
  const w3 = await captureHelperCases(modulesBeforeFixReview(CURRENT_MODULES));
  const back = await captureHelperCases(modulesBeforeW1(CURRENT_MODULES));
  const w1 = await captureHelperCases(modulesBeforeW2(CURRENT_MODULES));
  const w2 = await captureHelperCases(modulesBeforeW3(CURRENT_MODULES));
  for (const [index, expected] of BASE.entries()) {
    const phase2 = { ...expected, ...MOVED_BY_DISCLOSURE_WORDS[index], ...MOVED_BY_WINDOWING[index], ...MOVED_BY_M36_FORMAT[index] };
    // D71 (S2): the requests moved again (MOVED_BY_D71_BRIEF); M36 phase 3's render-back no longer reproduces phase 2's.
    // D71 (S3): and once more (MOVED_BY_D71_CHANNELS), the requests alone. S6: and once more (MOVED_BY_D71_FIX). S7: and
    // once more (MOVED_BY_S7). The column fix: and once more (MOVED_BY_FIX_COLUMN). The asks fixes: and once
    // more (MOVED_BY_ASKS_FIXES). W1 B: and once more (MOVED_BY_W1); rendered back (`modulesBeforeW1`), asks-fixes'.
    const asksFixes = { ...phase2, ...MOVED_BY_M36_CONVERSATION[index], ...MOVED_BY_D71_BRIEF[index],
      ...MOVED_BY_D71_CHANNELS[index], ...MOVED_BY_D71_FIX[index], ...MOVED_BY_S7[index],
      ...MOVED_BY_FIX_COLUMN[index], ...MOVED_BY_ASKS_FIXES[index] };
    // W2: and once more (MOVED_BY_W2); rendered back (`modulesBeforeW2`), W1's.
    // W3 F1(b): and once more (MOVED_BY_W3); rendered back (`modulesBeforeW3`), W2's.
    // The fix review: and once more (MOVED_BY_FIX_REVIEW); rendered back (`modulesBeforeFixReview`), W3's.
    assert.deepEqual(cases[index], { ...asksFixes, ...MOVED_BY_W2[index], ...MOVED_BY_W3[index],
      ...MOVED_BY_FIX_REVIEW[index] }, expected.name);
    assert.deepEqual(w3[index], { ...asksFixes, ...MOVED_BY_W2[index], ...MOVED_BY_W3[index] },
      `${expected.name}: rendered back to W3`);
    assert.deepEqual(w2[index], { ...asksFixes, ...MOVED_BY_W2[index] }, `${expected.name}: rendered back to W2`);
    assert.deepEqual(w1[index], { ...asksFixes, ...MOVED_BY_W1[index] }, `${expected.name}: rendered back to W1`);
    assert.deepEqual(back[index], asksFixes, `${expected.name}: rendered back`);
    assert.deepEqual(Object.keys(MOVED_BY_W2[index]).sort(), ['planned', 'sentInOrder', 'sentSorted'], expected.name);
    assert.deepEqual(Object.keys(MOVED_BY_W1[index]).sort(), ['planned', 'sentInOrder', 'sentSorted'], expected.name);
    assert.deepEqual(Object.keys(MOVED_BY_ASKS_FIXES[index]).sort(), ['planned', 'sentInOrder', 'sentSorted'],
      expected.name);
    assert.deepEqual(Object.keys(MOVED_BY_FIX_COLUMN[index]).sort(), ['planned', 'sentInOrder', 'sentSorted'],
      expected.name);
    assert.deepEqual(Object.keys(MOVED_BY_S7[index]).sort(), ['planned', 'sentInOrder', 'sentSorted'], expected.name);
    assert.deepEqual(Object.keys(MOVED_BY_D71_FIX[index]).sort(), ['planned', 'sentInOrder', 'sentSorted'], expected.name);
    assert.deepEqual(Object.keys(MOVED_BY_D71_BRIEF[index]).sort(), ['planned', 'sentInOrder', 'sentSorted'], expected.name);
    assert.deepEqual(Object.keys(MOVED_BY_D71_CHANNELS[index]).sort(), ['planned', 'sentInOrder', 'sentSorted'], expected.name);
    for (const key of ['planned', 'sentInOrder', 'sentSorted'])
      assert.notEqual(MOVED_BY_DISCLOSURE_WORDS[index][key], MOVED_BY_STABLE_IDS[index][key], key);
  }
});
