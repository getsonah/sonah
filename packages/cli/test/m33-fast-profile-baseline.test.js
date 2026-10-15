// M33 J. The opt-in "m33-fast" speed profile never touches the default. The standard profile plans
// and sends exactly the requests the code sent before any speed profile existed: the same windows,
// the same system and prompt bytes, the same labels, in the same order, and its frozen run profile —
// and so every window checkpoint key — has the same digest.
//
// The pinned values below were computed ONCE by running `captureStandard` (m33-fast-profile-fixture.js)
// against an export of commit a2bc39d — the code before this change — with `git archive a2bc39d` into
// a scratch directory and the fixture copied in. They are not recomputed here: this test proves the
// current code reproduces them, with the profile left out and with `standard` named explicitly. M33 C moved a
// stated few of them on purpose (`MOVED_BY_M33_C`: the narrative task text, the challenge system prompt and
// the run profile's versions), and M33 X a stated few more (`MOVED_BY_M33_X`: the requests of the cases whose
// windows are carried evidence from before them, and the run profile), and M33 C2 a stated few more
// (`MOVED_BY_M33_C2`: the challenge requests that hold a claim-class item, and the run profile's challenge version),
// and M33 H's repair a stated few more (`MOVED_BY_M33_H`: every narrative and challenge request, by the relay rule
// alone, and the run profile's two versions), and M33 N a stated few more (`MOVED_BY_M33_N`: every session-only narrative
// request, by its three forbidden-edit texts alone, and the run profiles). Then five branches moved values from M33 N's
// independently, each pinned on its own branch and kept here as its history: the outcomes branch (`MOVED_BY_H1`,
// `MOVED_BY_H5` and `MOVED_BY_STATUS_FACT`: the carried requests by H5's data, every request by the status fact's texts,
// and the run profiles), H3 (`MOVED_BY_H3`: every narrative and challenge request, by the claims definition alone, and
// the run profiles' two versions), M33 brittleness M3 (`MOVED_BY_M3`: every session-only narrative request, by two of
// M33 N's texts widened, and the run profiles' two versions), M4 and its session route (`MOVED_BY_M4`,
// `MOVED_BY_M4_SESSION`: the run profiles' challenge version alone) and G3 (`MOVED_BY_SUPPORT_ORDER`: every request, by
// the support-order sentences). M33 integration (`MOVED_BY_INTEGRATION`) pins what the merged code sends: rendered back
// through every other branch's fixture, it is the outcomes branch's capture byte for byte, and through all of them every
// older baseline above (with H5's documented data moves); every other value is still a2bc39d's. M35 windowing
// (`MOVED_BY_WINDOWING`) moved every case's requests and the `large` case's windows: from it on, only the run profiles
// are rendered back (`asBeforeWindowing`), and the captures before it are kept as the record.
//
// Synthetic sessions and a fake judge only: no model, no network, no recording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson } from '../../evidence/contracts/canonical.js';
import * as reviewRun from '../../evidence/src/run-review.js';
import * as sessionReview from '../src/session-review.js';
import { CHALLENGE_PROFILE, MAX_REVIEW_INPUT_BYTES } from '../../evidence/src/challenge.js';
import { WINDOW_REQUEST_MAX_BYTES, WINDOWING_PROFILE } from '../../evidence/src/windows.js';
import { captureStandard } from './m33-fast-profile-fixture.js';
import { modulesBeforeRelayRule, profileBeforeRelayRule } from '../../evidence/test/m33-h-relay-rule-fixture.js';
import { modulesBeforeForbiddenEdit, profileBeforeForbiddenEdit, modulesBeforeM3, modulesBeforeDisclosureWords }
  from '../../evidence/test/m33-n-forbidden-edit-fixture.js';
import { profileBeforeCarry5 } from '../../evidence/test/brittle-outcomes-fixture.js';
import { modulesBeforeStatusFact, profileBeforeStatusFact } from '../../evidence/test/status-fact-fixture.js';
import { modulesBeforeHedgedClaims } from '../../evidence/test/h3-hedged-claims-fixture.js';
import { MOVED_BY_M4_SESSION } from '../../evidence/test/m33-m4-disclosure-fixture.js';
import { modulesBeforeSupportOrder } from '../../evidence/test/m33-support-order-fixture.js';
import { PROFILE_TARGETS, DISCLOSURE_NARROW_VERSIONS, STABLE_IDS_VERSIONS, DISCLOSURE_WORDS_VERSIONS, WINDOWING_VERSIONS,
  RECORDED_FACTS_VERSIONS, FORMAT_VERSIONS, profileAs, profileBeforeRecordedFacts, profileBeforeFormat, profileBeforeConversation, CONVERSATION_VERSIONS, D69_VERSIONS, D69_REVIEW_VERSIONS, D71_BRIEF_VERSIONS, D71_CHANNELS_VERSIONS, profileBeforeD69, profileBeforeD69Review, profileBeforeD71Brief,
  profileBeforeD71Channels, D71_FIX_VERSIONS, profileBeforeD71Fix, S7_VERSIONS, profileBeforeS7,
  modulesBeforeM36Conversation, D80_VERSIONS, profileBeforeD80, FIX_COLUMN_VERSIONS, profileBeforeFixColumn,
  ASKS_FIXES_VERSIONS, profileBeforeAsksFixes, W1_VERSIONS, profileBeforeW1, modulesBeforeW1, W2_VERSIONS,
  profileBeforeW2, modulesBeforeW2, W3_VERSIONS, profileBeforeW3, modulesBeforeW3, FIX_REVIEW_VERSIONS,
  profileBeforeFixReview, modulesBeforeFixReview, CODE_PASS_VERSIONS, profileBeforeCodePass, CODE_PASS_REVIEW_CHALLENGE,
  profileBeforeCodePassReview, CODE_STEP_VERSIONS, profileBeforeCodeStep, CODE_STEP_REVIEW_VERSIONS,
  profileBeforeCodeStepReview, CODE_STEP_REREVIEW_VERSIONS, profileBeforeCodeStepRereview,
  CODE_STEP_THIRD_REVIEW_VERSIONS, profileBeforeCodeStepThirdReview, CODE_STEP_FOURTH_REVIEW_VERSIONS,
  profileBeforeCodeStepFourthReview, RELEASE_REVIEW_VERSIONS, profileBeforeReleaseReview, SECOND_RELEASE_REVIEW_VERSIONS,
  profileBeforeSecondReleaseReview }
  from '../../evidence/test/m33-integration-fixture.js';
import { createHash } from 'node:crypto';

// Loaded so that each test, not the whole file, fails when the module is missing.
const profiles = await import('../../evidence/src/review-profiles.js').catch(() => ({}));

/** captureStandard on a2bc39d (see the header). */
const BASE_A2BC39D = Object.freeze({
  cases: [
    { name: 'large', windows: 8,
      planned: '77ff3fb890227698384e2f5b2f1deab4509542595ad0e072f6412ceb82712248',
      sentCount: 35,
      sentInOrder: '0f9f2a86c9acec16681869150c25e7971fd83eef6a3acdad50f125cc4a788969',
      sentSorted: '49a9030232bcbad99e0eb922ba41dc498b50d6a80b58783c7c3729e633ba5a9c',
      labels: '1cbfb718b6f301a8fc5c5fddb43d5d705b2b55f32961079bb3f9f7124336af8c',
      windowFailures: '7:unreviewed_scope' },
    { name: 'turn', windows: 1,
      planned: '184b164ad5d533679cc5e961cc8b8941fcf2525a8946ee6d1a883429c75133b8',
      sentCount: 13,
      sentInOrder: '1bd6b0799b5d5ab6a65e06b131820ed50748cfbb82c5da33a1c1aa97123db1fd',
      sentSorted: '8184dd4b58d8df17f5b024f00b61b21c684212e0167461761ea1f4844b0362ea',
      labels: 'd6e612ba57f7d456c57cb538289c72537433116516c4ee1d43ce266765c6857b',
      windowFailures: '' },
    { name: 'lanes', windows: 4,
      planned: '32e1d9a60f211ac37968ccd05639e0ad757f97d264ff398ebdcbc5a79234bc6e',
      sentCount: 20,
      sentInOrder: 'd23730a83fa4ee30bf97caf7a9417abf26b271d81e34b5809acac3dcbd8ee25f',
      sentSorted: '0e83a364b45be725ce97adc5b7ec33cef4156c61db2a846e20fcc0556ad92ec2',
      labels: 'b7fd264ed59c188a41e8694d0b02716a6754ecd9bbb1cdf737651bc70918ab06',
      windowFailures: '' },
  ],
  runProfile: { 'session-only': 'e41ad815e896871bfa0ed095ebcf8c5822a8608cfec21095ab9d390b30e9ca60',
    combined: '1e964cdb1db8e55266dffa45f139302fafdd18afb32f2758b94d2409975f420f' },
  sessionProfileDigest: 'e41ad815e896871bfa0ed095ebcf8c5822a8608cfec21095ab9d390b30e9ca60',
});

/**
 * M33 C (`sonah.narrative/11`, `sonah.challenge/8`; the case digests as the M33 C repair left them — its narrative
 * task text names the earlier-result rule for supportedBy, its challenge system prompt the support item and the
 * binding sentence; the run profile did not move again): the ONLY values that moved from a2bc39d's, each for a stated
 * reason — every narrative request's task text (its system and evidence bytes are a2bc39d's: `planned`), every
 * challenge request's system prompt (its evidence and candidate bytes are a2bc39d's: `sentInOrder`,
 * `sentSorted`), and the run profile, whose prompt and challenge versions moved (`runProfile`,
 * `sessionProfileDigest`). The windows, the number of requests sent, their labels and order, and the window
 * failures are a2bc39d's, unchanged.
 */
const MOVED_BY_M33_C = Object.freeze({
  cases: [
    { planned: 'e1b47cb6f3e89eb82304d58a926541d580a70c997320174e796759976bae0f70',
      sentInOrder: 'a12e0ff5b0577b6d5a106fb10648b20ef73ae0c010a6ba5d6f8c82893a4d4ef9',
      sentSorted: '0eff07afd06992926f82a84ad51f937f2478b2bae018efa5bfedce401d3a75a5' },
    { planned: 'f9fe23b7c647932bd64907b73cb0f786537087e6bb732e7bb48cfbafa2397f7e',
      sentInOrder: '618c49eb44223e4f787111d5e944dc9ed50011039e1e36ddff013d14aef83adf',
      sentSorted: 'd1877d730173d24e6e258c6369f51c363f359fb2f545b7e59f89e55c4518304e' },
    { planned: '25e98b7d45ccf88ae4e81f58981cbc2704892322c891c493c8aa0d286ef37045',
      sentInOrder: '9d10d4f5e1a3990314d0d0e46e49a2bb8635ce8f7c8001143e97d03be43068c6',
      sentSorted: 'e73981840b6a6fb2e3a56b767cb06597ee8636c7bf2649888c73cf5f9a67d0e2' },
  ],
  runProfile: { 'session-only': 'db65595c76a30e66f19bcbf4cc2b2af9072cd068585984e5cf248ebf72665f10',
    combined: '99d0bac194f1f0f4b6084860fe02fb6f27b81a3ec925541480ff37543f2d0a70' },
  sessionProfileDigest: 'db65595c76a30e66f19bcbf4cc2b2af9072cd068585984e5cf248ebf72665f10',
});
/**
 * M33 X (`sonah.narrative/12`, carried evidence): the ONLY values that moved from M33 C's, each for a stated reason —
 * the "large" case's narrative and challenge requests, because every window of it after the first is carried the
 * agent's last statement before it ("Earlier in this session (carried for context)", first in its evidence: `planned`,
 * `sentInOrder`, `sentSorted`); and the run profile, whose prompt version moved and whose session-only profile now
 * binds the carry bounds (`runProfile`, `sessionProfileDigest`; the combined profile moved by its prompt version only —
 * a combined review carries nothing, and no combined request byte moved). "turn" (one window) and "lanes" (no
 * statement and no failed result to carry) are M33 C's, byte for byte, as are the windows, the number of requests
 * sent, their labels and order, and the window failures of every case.
 * M33 X recheck (`sonah.carry/2`) moved the same values again, for two stated reasons: the carried section's fixed text
 * now says what code selected and what it did NOT decide (no "no later run superseded" assertion), and a carried
 * statement is carried beside the results before it and the writes after it (the "large" case: `planned`,
 * `sentInOrder`, `sentSorted`); and the session-only run profile binds the new carry bounds (`runProfile`,
 * `sessionProfileDigest`; the combined profile did not move).
 * M33 X second recheck (`sonah.carry/3`) moved the same values once more, for two stated reasons: the carried section's
 * fixed text now says which later results code shows first and how it ranks failures, and the context carried beside a
 * statement is chosen slot by slot (the latest test run and check, and the broadest of each that passed since its last
 * write) — the "large" case (`planned`, `sentInOrder`, `sentSorted`); and the session-only run profile binds the new
 * carry bounds (`runProfile`, `sessionProfileDigest`; the combined profile did not move). "turn" and "lanes" did not.
 * M33 X third recheck (`sonah.carry/4`, the recency suffix: code never decides supersession) moved values once more, for
 * three stated reasons: (1) the "large" case — every window after the first is now carried the agent's most recent
 * RESULTS (each `node /srv/fast/step-N.js` run, its output's tail) as well as its statements, in recorded order, under
 * the new fixed section text (`planned`, `sentInOrder`, `sentSorted`); (2) the "lanes" case — its windows held no
 * failed result and no statement, so carry/3 carried them nothing; carry/4 carries each later window every earlier
 * lane's result (`planned`, `sentInOrder`, `sentSorted`); (3) the session-only run profile binds the new carry bounds
 * (`runProfile`, `sessionProfileDigest`; the combined profile did not move). "turn" (one window) did not move, nor did
 * any case's windows, number of requests sent, labels, order or window failures.
 * M33 X fourth recheck (reads are never carried) moved the "large" and "lanes" values once more, for ONE stated reason:
 * the carried section's fixed text now names what is never carried, whatever it printed — a file read, search or
 * listing by a tool (tool=read), and a command that only reads, lists or checks (ls, cat, grep, nl, git status, git log,
 * test, diff, jq, curl and the like) (`planned`, `sentInOrder`, `sentSorted`). Neither case records a read, so no entry
 * moved: run with the third recheck's section text, the new code reproduces the third recheck's values exactly. The
 * run profile did not move (its carry bounds did not change), nor did "turn", nor any case's windows, number of
 * requests sent, labels, order or window failures.
 */
const MOVED_BY_M33_X = Object.freeze({
  cases: [
    { planned: '24e8b6f26ed774036e5300c530e1a6fe5b42ac1db9c010b450fc3945f9fcf510',
      sentInOrder: '745b1b66c19bb25fdb9ccb13283c23264a01b5b8d2e95f918f8c9b12568e955f',
      sentSorted: 'e5a39526ed52c904ea4892a334223f3403db38162d21b7661c2b0f6eb5810cb2' },
    {},
    { planned: '889272890d5fad6c6128716d4f3a9661e5c837452e7fee754845132cee8bc3d2',
      sentInOrder: 'd0930ccd441fa520db2de325a290fb3a141e83201f177ebfb5619ecdf8a4557b',
      sentSorted: '8af5720515685bcf387a4f0e2058b33458dc926e1b47a757bbcd09b516a168f2' },
  ],
  runProfile: { 'session-only': '8b7929fdeb14831bca8421ee41e81b138fc84149ab1c5e73574212a3e53b98f1',
    combined: '279034603cdcffe9af119b28e54d59bdb9bf8503e7e447d35d51bd0949f44cee' },
  sessionProfileDigest: '8b7929fdeb14831bca8421ee41e81b138fc84149ab1c5e73574212a3e53b98f1',
});
/**
 * M33 C2 (`sonah.challenge/9`, the verbatim quote decides): the ONLY values that moved from M33 X's, for two stated
 * reasons: (1) the "large" and "turn" cases' challenge requests that hold a claim-class item (a claim, a support, a
 * resolution, a written statement) — each such item is shown with its stated quote as `claim` and its narrative text as
 * `reviewersReading`, and each such batch is sent CLAIM_WORDS_NOTE after the unchanged system prompt (`sentInOrder`,
 * `sentSorted`); (2) the run profile, whose challenge version moved (`runProfile`, `sessionProfileDigest`; with the
 * version alone put back to `sonah.challenge/8`, both digests are M33 X's exactly). Rendering every challenge request back
 * as /8 rendered it (no note, candidates as proposed), the new code reproduces M33 X's `sentInOrder` and `sentSorted` of
 * every case exactly. "lanes" holds no claim-class item and did not move; no case's windows, narrative requests
 * (`planned`), number of requests sent, labels, order or window failures moved. M33 C2 repair (still /9): the same
 * values moved again, and only they — each claim-class item shows code's grounded words and their `context`, and the
 * note names them; rendered back as /8, every value is still M33 X's exactly, and the run profiles did not move.
 */
const MOVED_BY_M33_C2 = Object.freeze({
  cases: [
    { sentInOrder: '6000fc16d5747f81a5b43f32fbae1c6b3a820fac9f96339657190a1773cf3621',
      sentSorted: '10dbba85da4a6239138f1049c585ca6f8ab4ec8e2b14e7d7cdb2abe2295de9ad' },
    { sentInOrder: 'e57bc174f24bf0832d07f2121900c50b41c64785ba57f01555f19b7037a9d0ea',
      sentSorted: '83e61b129e79822726b6132bfeda7d63da16bfd0a9156a1f7decc3bffbb50643' },
    {},
  ],
  runProfile: { 'session-only': '87971f957d85f2920ce4c45c8831f39172e650a9feecb86a93b45c9dcc4960d7',
    combined: 'f96d1ccfd9ed4bc26bd922c3595e50cf5c64f14e76dedac2c3e0ec810fed896f' },
  sessionProfileDigest: '87971f957d85f2920ce4c45c8831f39172e650a9feecb86a93b45c9dcc4960d7',
});
/** a2bc39d's capture with exactly the values M33 C, then M33 X, then M33 C2 moved: the capture before M33 H's repair. */
const BEFORE_M33_H = Object.freeze({ cases: BASE_A2BC39D.cases.map((c, at) => ({ ...c, ...MOVED_BY_M33_C.cases[at],
  ...MOVED_BY_M33_X.cases[at], ...MOVED_BY_M33_C2.cases[at] })),
runProfile: MOVED_BY_M33_C2.runProfile, sessionProfileDigest: MOVED_BY_M33_C2.sessionProfileDigest });
/**
 * M33 H repair (`sonah.narrative/13`, `sonah.challenge/10`: an agent passing on what a helper or another agent reported
 * makes it its own claim): the ONLY values that moved from M33 C2's, for three stated reasons: (1) every narrative
 * request's task text and output contract (`planned`, and every sent narrative request); (2) the shared challenge system
 * prompt, so every challenge request (`sentInOrder`, `sentSorted`); (3) the run profile, whose prompt and challenge
 * versions moved (`runProfile`, `sessionProfileDigest`). Rendering every request back as /12 and /9 sent it, and the
 * two versions back in the run profile (m33-h-relay-rule-fixture.js), the new code reproduces M33 C2's values exactly
 * (`BEFORE_M33_H`, the render-back test below). No case's windows, number of requests sent, labels, order or window
 * failures moved.
 */
const MOVED_BY_M33_H = Object.freeze({
  cases: [
    { planned: '0cde45a1cb7d52fe5f68af79c796251d9d23f72205d3144ac06da74597b4c06c',
      sentInOrder: '02da64dd3aa9a4edaccf40187226aa98f19636ca2bbfd9b2c5f85a45b07e3f62',
      sentSorted: 'ab3cbf396a040cdd72b7bfd6eaccaaa60ce16f81c893b98faa6298eff28f926b' },
    { planned: 'eb8af739978489726063a1b62321ede282e44b6090c66a257f8b8ff0938ab024',
      sentInOrder: '5198b1cbdaa5dfa659433d8b79b6f6c206856538d938d93887a7637cfa2377a3',
      sentSorted: 'c50e8b79252f498b7d0bb21412053a8134710dd5568a510462c070b8c3f315ea' },
    { planned: '0a105c0ad7912cea8ac26f29bf4e7d35d49f4fc45e71c76bc134d787246d81a3',
      sentInOrder: '4f364c7711e046a0135bab34ea18f53af1e4c87ea0c2074d3172ecbddb001cd6',
      sentSorted: 'a50a47cb93113f34a7dd269382e06a806d0af8b5b39feaea1f412d51a1434797' },
  ],
  runProfile: { 'session-only': '3b54fa60becd7422545d5a3e5cd012be3fbd6da9fdf7d255b8097063a85393ae',
    combined: '8193162786b032a5611d8a5e578758df3d91c3a88e0e01df50c1512f0aa2ffe6' },
  sessionProfileDigest: '3b54fa60becd7422545d5a3e5cd012be3fbd6da9fdf7d255b8097063a85393ae',
});
/** The capture before the repair with exactly the values the repair moved. */
const BASE = Object.freeze({ cases: BEFORE_M33_H.cases.map((c, at) => ({ ...c, ...MOVED_BY_M33_H.cases[at] })),
  runProfile: MOVED_BY_M33_H.runProfile, sessionProfileDigest: MOVED_BY_M33_H.sessionProfileDigest });
/* OWNER DECISION B (2026-10-01, per-decision instruction completeness, merged beside M33 H) moved no byte of
 * these cases: every window's instruction scope is complete and no case records a queued prompt or an answer. Its own
 * run-profile move was the prompt version alone, which M33 H moves to the same `sonah.narrative/13`. */
/**
 * M33 N (`sonah.narrative/14`, `sonah.challenge/11`: a session-only review's route for an edit against a human
 * instruction): the ONLY values that moved from M33 H's, for two stated reasons: (1) every session-only narrative
 * request's task text and output contract — its three forbidden-edit texts (m33-n-forbidden-edit-fixture.js) — so
 * `planned` and every sent narrative request (`sentInOrder`, `sentSorted`); no challenge request moved (no case proposes a
 * forbidden edit, so no new run is asked, and no other batch's bytes changed); (2) the run profiles, whose prompt and
 * challenge versions moved and whose session-only narrative contract gained `forbiddenEdits` (`runProfile`,
 * `sessionProfileDigest`). Rendering every request back as /13 sent it, and the versions and the member back in the run
 * profiles (m33-n-forbidden-edit-fixture.js), the new code reproduces M33 H's values exactly (`BASE`, the render-back
 * test below). No case's windows, number of requests sent, labels, order or window failures moved.
 */
const MOVED_BY_M33_N = Object.freeze({
  cases: [
    { planned: '8c81210916f75f6c80abb2e86f8243a2749e31fa9a8fb2769ff6fe9887ef89e3',
      sentInOrder: '9347b5d87ea1f4853b7f66bbc4c46562981a791919620cb591d282d4b5ba879b',
      sentSorted: 'af8e68ad8fcc22141a43dbada989fc783c48b966f8a7e5a00975a5f8385d1fee' },
    { planned: '81cc55e8886a9901c9ade39f1a4bc744184af8fac2302233072196a2f0279c57',
      sentInOrder: '4a72d9ebe66fcacd7929f8dedf532b3dd9758c620052953a4ab402a36b0662b2',
      sentSorted: 'b06c2ff66950c12216fa4308636c94b346056d031465e62c45b6ffd7935af27b' },
    { planned: '3f0542d3d172ca9aae375d61d249ef01f39b4fdc48b4859b2157bcc4022d23f5',
      sentInOrder: '022717ab5e2b0f343c5df526fd810cd793a1d7d9a24e5756e35f8c8223323a93',
      sentSorted: 'b2a8c5123d704d9d6f8992fafbbff57471a90ff8788862ba251052542b0d5435' },
  ],
  runProfile: { 'session-only': 'f361c1a308b78db2ca702c22167d3175339da1b97e685d27fb32e5145f7a2e43',
    combined: 'b20c8faf48753a08421f12ae292b4d13066029eea6b84e34c900851ee8997b03' },
  sessionProfileDigest: 'f361c1a308b78db2ca702c22167d3175339da1b97e685d27fb32e5145f7a2e43',
});
/**
 * H1 (`sonah.carry/5`): the ONLY values that moved from M33 N's — the session-only run
 * profile, whose carry version moved (`runProfile['session-only']`, `sessionProfileDigest`). No case's bytes moved: their
 * commands' statuses are typed, and no carried result's tail size changed. With the carry version rendered back
 * (`profileBeforeCarry5`), the profile is M33 N's byte for byte.
 */
const MOVED_BY_H1 = Object.freeze({
  runProfile: { 'session-only': '7fc031139692b07fa4d1fb49f4ca3d0e374a17878e3795cb2479eae733281092',
    combined: MOVED_BY_M33_N.runProfile.combined },
  sessionProfileDigest: '7fc031139692b07fa4d1fb49f4ca3d0e374a17878e3795cb2479eae733281092',
});
/**
 * H5 (`sonah.carry/5`): every command's result is carried, whatever it ran, and the carried
 * section's fixed text says so — so the ONLY values that moved are the requests of the two cases whose windows carry
 * evidence ("large", "lanes"): `planned`, `sentInOrder`, `sentSorted`, at every render-back level. "turn" carries
 * nothing and did not move; no window count, label, order, failure or profile moved.
 */
const MOVED_BY_H5 = Object.freeze({
  now: [
    { planned: '98e950f4414c531a98454a850ca1b8c68e96b1fd7ea1df4a388ee0dd9a7d7bc2', sentInOrder: '0ea6b5ec227141cf45cbc539db678d1aea245c48bcf5d6b62bb992489f822909', sentSorted: '112fcd675894a1db2ccb9fa79502b21d45d736fb43cf9144d658eca9c888fcfc' },
    {},
    { planned: '869c1feb7b0cd00c0bf8edd6358eae3c1c28caac09f92405f19c4d93996052e6', sentInOrder: 'a97b8295efd3ee1c07bebbb64a4330344be60a3b7949546bfdc40243a0dd3737', sentSorted: 'b25976ca0428ae3150878fc91901c45fc2690d03f1b5fdb865f35ed05d03504d' }],
  n13: [
    { planned: '9ffbe588fdd4bfbbc45cf643f56ed88eeb5c8420b4f8e7178a3331b84e947a2b', sentInOrder: '005e6611287a1f3c779241a20ee80bc6f2e4bf31dbd76f6f7c4703c0b9ffdc37', sentSorted: '62c04505628b4f30469a466b1422a3d38fb0b32efb2f2257fcb99c3093ee47a2' },
    {},
    { planned: '92f9af3a5a901b1de0140a167ac35f18daaf3285a43a2ec902d4fce23fcd1f55', sentInOrder: '06bd4d44a3e8b5add0ce71ee21fe0c6bfa50fabf39d068a2a2c773b62aab0b45', sentSorted: 'af6d25e1a97b8c61b21d54ea5d5d181366e4871d4b2f7350fa7867699557ccf5' }],
  n12: [
    { planned: 'd8c48d11643ef882d2b3f46afcd82cf0cf00152a01c41b0d5976270ab83ef6e9', sentInOrder: '48cee67769a3d1beb88bf0783d49707f567df1c13c80e423dd2dce6b4e02f8ec', sentSorted: '9f629e8627ed3c134103e5c87ae5dbc40ce7bf5d62bb89ae9d32e2dd000c9adb' },
    {},
    { planned: '604d6a1d788991029fe57a3d3b55f1a77e01bac8c712d4e62a813ad884662c96', sentInOrder: '0655927563e2c3ffb3cff39f536daf3bf1226cab4c1eb7833b056ee5707b8f85', sentSorted: '0f25293d4805943a431189cca78e612bbbcbab99bc0deb13a095b727eb31fbfd' }],
});
const withMoves = (capture, moved) => ({ ...capture, cases: capture.cases.map((c, at) => ({ ...c, ...moved[at] })) });
/** M33 H's capture with exactly the values M33 N, then H1 and H5, moved: what the code sent before the status fact. */
const BEFORE_STATUS_FACT = Object.freeze({ cases: BASE.cases.map((c, at) => ({ ...c, ...MOVED_BY_M33_N.cases[at], ...MOVED_BY_H5.now[at] })),
  runProfile: MOVED_BY_H1.runProfile, sessionProfileDigest: MOVED_BY_H1.sessionProfileDigest });
/**
 * Status fact (owner decision 2026-10-06; `sonah.narrative/15`, `sonah.challenge/12`, `sonah.carry/6`): the ONLY values
 * that moved from H5's — every case's narrative requests (three task lines: `planned`, and the sent narrative requests),
 * every case's challenge requests (one system sentence: `sentInOrder`, `sentSorted`), and the run profiles, whose three
 * versions moved (`runProfile`, `sessionProfileDigest`). No case's command is uncovered, so no "status:" line is shown.
 * Rendered back (status-fact-fixture.js `modulesBeforeStatusFact`, `profileBeforeStatusFact`), the code reproduces H5's
 * values exactly (`BEFORE_STATUS_FACT`, the render-back test below). No window count, label, order or failure moved.
 */
const MOVED_BY_STATUS_FACT = Object.freeze({
  cases: [
    { planned: 'e339928b3c6c7b972d8ce673c9f7df3e825573ae1acd4d72070a541848958904', sentInOrder: 'e0bc6a469821b145f9e77c0330583b185f5953896b992e694dbd249a04d4ead7', sentSorted: '38f69f7cf856e545ff27ec851fdb8417a53384b8a22ac78f971fe07103917eea' },
    { planned: '9c2a28a65fe18c38bacd34379029718f14e5542b2fa043083e056d493f45a0d4', sentInOrder: '15e2917fc94ee06920b3f65bc29555a459d08f5f815192ee947450235235ee9a', sentSorted: '3da5da120935029eaae2480dfbefc03bfc4af83443e9e04ad3c425cc48cfcf1e' },
    { planned: 'c1952a43cb22c622052417ad012891113b2e72318b2836d918feeba74a88f387', sentInOrder: 'e3a4752182a5fa8c38faf7fbb6bf3b29145c516d09b09b4302e7ca32629ca855', sentSorted: 'afb2323303ab67ff7e76da58d15d44e3fad0f3e7d75e7f0a47d1267417b81dc7' }],
  runProfile: { 'session-only': '47e62d3e1ab1d2819f536bfd8cddfb9fb4365af822370b19bf5b65c381fbff55',
    combined: 'fb50bae84605aa6e72e75d0e5753559c1ca4deea7be2c3311f5850bd4fe3c1cc' },
  sessionProfileDigest: '47e62d3e1ab1d2819f536bfd8cddfb9fb4365af822370b19bf5b65c381fbff55',
});
/** What M33 outcomes repair sends: H5's capture with exactly the values the status fact moved. */
const AFTER_STATUS_FACT = Object.freeze({ cases: BEFORE_STATUS_FACT.cases.map((c, at) => ({ ...c, ...MOVED_BY_STATUS_FACT.cases[at] })),
  runProfile: MOVED_BY_STATUS_FACT.runProfile, sessionProfileDigest: MOVED_BY_STATUS_FACT.sessionProfileDigest });
// The four branch histories below (H3, M3 with M4 and its session route, G3) are each one branch's own pins against M33
// N's capture. Their single-branch render-back tests targeted M33 N's capture, which the merged code no longer reaches
// by text render-backs alone (the outcomes branch's H5 data moves the carried cases at every level), so the merge checks
// them together: every other branch rendered back reproduces the outcomes branch's capture (the integration test below).
/** M33 H's capture with exactly the values M33 N moved: the capture before H3. */
const BEFORE_H3 = Object.freeze({ cases: BASE.cases.map((c, at) => ({ ...c, ...MOVED_BY_M33_N.cases[at] })),
  runProfile: MOVED_BY_M33_N.runProfile, sessionProfileDigest: MOVED_BY_M33_N.sessionProfileDigest });
/**
 * H3 (`sonah.narrative/16`, `sonah.challenge/13`: a claim is every statement the agent
 * makes about the state or the outcome of its work, hedged or not; only an action not taken yet, a question or a
 * restatement of a document or a hand-off brief is not one): the ONLY values that moved from M33 N's, for three stated
 * reasons: (1) every narrative request's task text and output contract, session-only and combined (`planned`, and every
 * sent narrative request); (2) the shared challenge system prompt, so every challenge request (`sentInOrder`,
 * `sentSorted`); (3) the run profiles, whose prompt and challenge versions moved (`runProfile`, `sessionProfileDigest`).
 * Rendering every request back as /14 and /11 sent it, and the two versions back in the run profiles
 * (h3-hedged-claims-fixture.js), the new code reproduces M33 N's values exactly (`BEFORE_H3`, the render-back test
 * below). No case's windows, number of requests sent, labels, order or window failures moved.
 * H3's review repair (2026-10-06; /16 and /13, were /15 and /12) re-pinned these values once, in place: the relay and
 * supportedBy rules' example phrasings are gone and a hedge on a relay is not doubt — the same requests moved, by the
 * same fixture's texts, and the render-back still reproduces the values before H3.
 * The owner's decision of 2026-10-06 (still /13) re-pinned the two cases holding a claim-class item ("large", "turn";
 * "lanes" holds none) once more, in place: CLAIM_WORDS_NOTE lists no kinds of statement (the quoted text may narrow
 * what the words assert and never widens it), so only `sentInOrder` and `sentSorted` moved, by the same fixture's text;
 * the render-back still reproduces the values before H3.
 */
const MOVED_BY_H3 = Object.freeze({
  cases: [
    { planned: 'dd76b94184acb362ecd3cf563a7907c92ff14fc3399954e43af0216e67ff92ad',
      sentInOrder: '64313b0b08c9192a7895d2f63fcb0555c3be15ccce9176930ae6b1d6e54cc7a5',
      sentSorted: '9b30fd2aea7da9c27308cdc20b3039e30afd56e9ce0d49e9ee9ecece2ce1381e' },
    { planned: '6478a9163144010ec5ae29efbdf88cc4f83d5867d471d3a0e0adb161b3ea171e',
      sentInOrder: 'ad03ae2d90807f6dcd19140498888da2fa468ea98f70d2502d46586fe91ca662',
      sentSorted: '2b82c24dafab6b56fdddda81628474e48ecaec463cca420ddb407438655ab9bb' },
    { planned: 'a87e6e7be13caf4f240ff6dfee7a264f7624f5f809532661dd475212731bae3b',
      sentInOrder: '54bc4c02088e1c13ea6c969b0253e75b26f6bbfa5a3f718d770086d66514399b',
      sentSorted: '1b11ee1f1c5600bd88342309d5ee4555533018ee56882c6f1d684d66b3b9d493' },
  ],
  runProfile: { 'session-only': '391e8bb103582b1d94117ab00217ecbe8ddd9459c3d4c5a76a58a7807677fc37',
    combined: '98eb352b6e89901871aae666f50b7201d65f25fd3d558b93b2a49fc94b3cb9f4' },
  sessionProfileDigest: '391e8bb103582b1d94117ab00217ecbe8ddd9459c3d4c5a76a58a7807677fc37',
});
/** What M33 claims repair sends: M33 N's capture with exactly the values H3 moved. */
const AFTER_H3 = Object.freeze({ cases: BEFORE_H3.cases.map((c, at) => ({ ...c, ...MOVED_BY_H3.cases[at] })),
  runProfile: MOVED_BY_H3.runProfile, sessionProfileDigest: MOVED_BY_H3.sessionProfileDigest });
/** M33 H's capture with exactly the values M33 N moved: what the code sent before M33 brittleness M3. */
const AFTER_M33_N = Object.freeze({ cases: BASE.cases.map((c, at) => ({ ...c, ...MOVED_BY_M33_N.cases[at] })),
  runProfile: MOVED_BY_M33_N.runProfile, sessionProfileDigest: MOVED_BY_M33_N.sessionProfileDigest });
/**
 * M33 brittleness M3 (`sonah.narrative/15`, `sonah.challenge/12`: a removal is a forbidden edit too; the M3 review held
 * the deleted-file wording back and re-pinned these three cases' digests, the texts in the fixture's MOVED_BY_M3): the
 * ONLY values that moved from M33 N's, for two stated reasons: (1) every session-only narrative request's task item 6
 * and its output-contract rules (m33-n-forbidden-edit-fixture.js MOVED_BY_M3) — so `planned` and every sent narrative
 * request; no challenge request moved (no case proposes a forbidden edit); (2) the run profiles, whose prompt and
 * challenge versions moved (both `runProfile`s and `sessionProfileDigest`). Rendered back (`modulesBeforeM3`,
 * `profileBeforeM3`), the new code reproduces M33 N's values exactly (`AFTER_M33_N`, the render-back test below).
 */
const MOVED_BY_M3 = Object.freeze({
  cases: [
    { planned: '616f4767a34acfede8aff7c2591766f1921acfef6810e6452c55003b1699de25',
      sentInOrder: 'afc5db790e227f7abcc3fd22002715ef6ab96b6e0a312b227e20b965120a2cd3',
      sentSorted: 'c959a79fb1db0e00a77aca2db8b4815c1186d9c2c5dc074c8c56b8ddf6462264' },
    { planned: 'ffb5aa3e47f2021a1d22c8eaed68d91d6212fcf278d5b72caf80915c308b70da',
      sentInOrder: '8b4c835729d32218755584ce33c195f50d2a3825cc7c042eb5b0fa14421e3ff7',
      sentSorted: '68ab68719b6225f13bcf37d4ad84dd967a833b3a036d1df91a84de4c1c941dfb' },
    { planned: '45cb115d06c836837ee2de79b5a3b80bdb4ad63650185e1a6f5e99e37650ae7a',
      sentInOrder: 'a31ef5e23c77ebdaa9be95690d82a2c38bd6d344b55ec8a10d3bf83ede21fd3d',
      sentSorted: 'cdf6b5fe9ecddcd6987bebd32d2307ce54d5eb807202e6b0f9931398181b9792' },
  ],
  runProfile: { 'session-only': '987a6ff5a71ee5f8cd6373d59cdd8f903316288ddae6043df06ca8643ce56277',
    combined: 'fb50bae84605aa6e72e75d0e5753559c1ca4deea7be2c3311f5850bd4fe3c1cc' },
  sessionProfileDigest: '987a6ff5a71ee5f8cd6373d59cdd8f903316288ddae6043df06ca8643ce56277',
});
/** M33 N's capture with exactly the values M3 moved: what the code sent before M33 brittleness M4. */
const AFTER_M3 = Object.freeze({ cases: AFTER_M33_N.cases.map((c, at) => ({ ...c, ...MOVED_BY_M3.cases[at] })),
  runProfile: MOVED_BY_M3.runProfile, sessionProfileDigest: MOVED_BY_M3.sessionProfileDigest });
/**
 * M33 brittleness M4 (`sonah.challenge/13`, `sonah.code-review/14`: a disclosure is its own proposition): the ONLY values
 * that moved from M3's — the run profiles, by their challenge version alone (both `runProfile`s and
 * `sessionProfileDigest`). No case's requests moved: no session-only request byte changed, and no case proposes a
 * disclosure. Rendered back (`profileBeforeM4`), the new code reproduces M3's values exactly (the render-back test below).
 */
const MOVED_BY_M4 = Object.freeze({
  cases: [{}, {}, {}],
  runProfile: { 'session-only': '80c3f88731ae20c2ffc13ddf1e4f5bacfebd602adf0057c43f9e95519b188405',
    combined: 'bf3e4abb7039eb5e9d02c26e23fe08b32dced14869966ba80af3929555dc7544' },
  sessionProfileDigest: '80c3f88731ae20c2ffc13ddf1e4f5bacfebd602adf0057c43f9e95519b188405',
});
/** M3's capture with exactly the values M4 moved: what the code sent before M4's session route. */
const AFTER_M4 = Object.freeze({ cases: AFTER_M3.cases.map((c, at) => ({ ...c, ...MOVED_BY_M4.cases[at] })),
  runProfile: MOVED_BY_M4.runProfile, sessionProfileDigest: MOVED_BY_M4.sessionProfileDigest });
/**
 * M33 brittleness M4, session route (`sonah.challenge/14`: owner decision 2026-10-06, "disclosed means FYI" on both
 * routes): the ONLY values that moved from M4's are its fixture's `MOVED_BY_M4_SESSION.baseline` — the run profiles, by
 * their challenge version alone (both `runProfile`s and `sessionProfileDigest`). No case's requests moved: no case
 * proposes a forbidden edit, so none sends a forbidden-edit or disclosure batch, and no narrative byte changed. Rendered
 * back (`profileBeforeM4Session`), the new code reproduces M4's values exactly (the render-back test below).
 */
const MOVED_BY_M4_SESSION_BASELINE = MOVED_BY_M4_SESSION.baseline;
/** M4's capture with exactly the values M4's session route moved: what M33 forbidden-edit repair sends. */
const AFTER_M4_SESSION = Object.freeze({ cases: AFTER_M4.cases.map((c, at) => ({ ...c, ...MOVED_BY_M4_SESSION_BASELINE.cases[at] })),
  runProfile: { ...MOVED_BY_M4_SESSION_BASELINE.runProfile }, sessionProfileDigest: MOVED_BY_M4_SESSION_BASELINE.sessionProfileDigest });
/**
 * Owner decision 2026-10-05 (M33 light fixes, G3): the ONLY values that moved from M33 N's — every case's narrative
 * requests (`planned`, `sentInOrder`, `sentSorted`), whose two supportedBy sentences now ask for a result recorded
 * before or after the claim in the same turn, and every challenge request, whose support sentence says the same
 * (m33-support-order-fixture.js). The run profiles did not move (no version moved). Rendered back
 * (`modulesBeforeSupportOrder`), the new code reproduces M33 N's values exactly (the test below).
 */
const MOVED_BY_SUPPORT_ORDER = Object.freeze({
  cases: [
    { planned: '62251579e90aa96421f60c4d21a3654f418ece7e23acb3b73e493c1980a70f46',
      sentInOrder: '45ffc53a1a9dd16f210e2897d73c1c424b9715aef672744fcf508bc3b51db6fd',
      sentSorted: 'e5e5b61459675e4b02d0e3876614bf27e23903ea4620098b896bb6f289de5e8a' },
    { planned: '977c1bf9ef1c95c9b5fc3568ac10fb2749950566ba1a8391384399bb7061d6d1',
      sentInOrder: '38b1037321fc3305b84f7dc431780bf1443c7b4fac61aaa57cd370ada1f2575a',
      sentSorted: '711f133b95028e0b1331bab4f17434b7702ba881b787a85973ff4c15b8849222' },
    { planned: 'de76459ef749ee77558c5575d65df78889f6288483ab4aafa4187fd2e999be81',
      sentInOrder: '1ba32a333ab9cc9de75b7838549855dfcd05608e6e26ce4371a3abd42d56cc23',
      sentSorted: '32d4a002568821f9001657d3a7f578d8e89f4382cc4f98e6bda8a44d289474d7' },
  ],
});
/**
 * M33 integration (2026-10-06; `sonah.narrative/17`, `sonah.challenge/15`, `sonah.carry/7`): the ONLY values that moved
 * from the outcomes branch's capture (`AFTER_STATUS_FACT`) — every case's narrative and challenge requests, which carry
 * H3's, G3's and M3's texts beside the status fact's (`planned`, `sentInOrder`, `sentSorted`), and the run profiles,
 * whose three versions moved (`runProfile`, `sessionProfileDigest`). Every branch's constant above stays as its own
 * history; each branch moved these same values on its own (status fact, H3, M3, G3; M4 and M4's session route the
 * profiles only), so no single one of them describes the merge. Rendered back through every other branch's fixture and
 * with the versions mapped to the outcomes branch's (m33-integration-fixture.js `profileAs`), the code reproduces
 * `AFTER_STATUS_FACT` byte for byte, and through all of them each older baseline (the tests below). No window count,
 * label, order or failure moved.
 */
const MOVED_BY_INTEGRATION = Object.freeze({
  cases: [
    { planned: '455237f80563d8bd4d13c7ffc1b28c19eed75567269b2659cf262c7fea997ad7',
      sentInOrder: '8abbdf7689e96afabbec20fdd927d7ad9968b9bb9e10fdf7cd27095ec30efc3c',
      sentSorted: 'b73dd510691c543af3bf83b2a10a817195e278e15ab1e78508fd69718486ff56' },
    { planned: '36def3ec652410d01c37c9f3a9e2488c5e8c36bd994e3a9f2951fd5b86ee0e18',
      sentInOrder: '02ed9ee87e9218254616e2e5d5e74653b171d20fd145cd83420abe346000320e',
      sentSorted: 'f2146bce714b2ecaa6536e6b64e10913d6e370a8a529afa505acc71f70dc5006' },
    { planned: '7d3496a8c138b55063e09f60e497ef8d8093d1a69beafbafbbd11a135b268914',
      sentInOrder: '7867b5987768d858a6d97e6e767cb4e3b90f1cd42152fcbc771ab972864a3d8d',
      sentSorted: '4176e0054936fbd531d05e81bdce37d0dde094a29ce3bbc36329db8174670679' },
  ],
  runProfile: { 'session-only': 'dc33069c2d9ff94dbfa16553489c64a499b50dfecc02ada7b07c9b93f5db0cef',
    combined: 'af6c501c327a706c0fdc74745fbac05cb139ededa283f52f913c4cccb46964ea' },
  sessionProfileDigest: 'dc33069c2d9ff94dbfa16553489c64a499b50dfecc02ada7b07c9b93f5db0cef',
});
/**
 * M33 integration merged with M33 labels (2026-10-06; `sonah.narrative/18`, m33-integration-fixture.js
 * `LABELS_MERGE_VERSIONS`): the ONLY values that moved from `MOVED_BY_INTEGRATION` — the run profiles, by their prompt
 * version alone (`runProfile`, `sessionProfileDigest`). No case's request moved: none holds an instruction the slicer
 * marks (a queued prompt, an answer, a slash command, an attached file, a typed interruption) or a peer's message, so
 * each sends /17's bytes; no window count, label, order or failure moved. `profileAs` maps /18 as it maps /17, so every
 * render-back below reproduces its older baseline unchanged.
 */
const MOVED_BY_LABELS_MERGE = Object.freeze({
  runProfile: { 'session-only': '6edd3ff15422b7e604b025cc9ea7140af360612e94cface6ccb7fe7f8e045a7a',
    combined: '3d36bd22a80ddca660f2dc6fd74b23e4e82d9ec4785ad9e44505ca22b55f0151' },
  sessionProfileDigest: '6edd3ff15422b7e604b025cc9ea7140af360612e94cface6ccb7fe7f8e045a7a',
});
/**
 * Disclosure narrowed (owner decision 2026-10-06; `sonah.challenge/16`, m33-integration-fixture.js
 * `DISCLOSURE_NARROW_VERSIONS`): the ONLY values that moved from `MOVED_BY_LABELS_MERGE` — the run profiles, by their
 * challenge version alone (`runProfile`, `sessionProfileDigest`; the test below renders them back to /15 and gets
 * MOVED_BY_LABELS_MERGE's). No case's request moved: none proposes a disclosure, so none sends a disclosure run, the only
 * requests whose bytes moved (DISCLOSURE_PROPOSITION and DISCLOSURE_NOTE); no window count, label, order or failure
 * moved. `profileAs` maps /16 as it maps /15, so every render-back below reproduces its older baseline unchanged.
 */
const MOVED_BY_DISCLOSURE_NARROW = Object.freeze({
  runProfile: { 'session-only': '6fc592a161307251da767feacfda8d3ceec28ea4fc8bf08efa80aa018a0c290a',
    combined: '8a1cc6683a5d787207de4e78879466ea4ae9b35832229276388c195efe9fe694' },
  sessionProfileDigest: '6fc592a161307251da767feacfda8d3ceec28ea4fc8bf08efa80aa018a0c290a',
});
/**
 * Stable event ids (C-01 event identity, 2026-10-07; `sonah.narrative/19`, `sonah.challenge/17`, `sonah.carry/8`,
 * m33-integration-fixture.js `STABLE_IDS_VERSIONS`): the ONLY values that moved from `MOVED_BY_DISCLOSURE_NARROW` — the
 * run profiles, by their prompt, challenge and carry versions alone (`runProfile`, `sessionProfileDigest`; the test below
 * renders them back to /18, /16 and /7 and gets MOVED_BY_DISCLOSURE_NARROW's). Re-pinned once in place by the phase 3
 * review (the challenge and carry versions, whose requests and entries show the same ids as the narrative's; first
 * pinned with the narrative version alone: 6d48d5c5… session-only, cc54ce24… combined). No case's request moved: every
 * case is a hand-built session, which records no identity and keeps its positional ids; no window count, label, order or
 * failure moved. `profileAs` maps /19, /17 and /8 as it maps /18, /16 and /7, so every render-back below reproduces its
 * older baseline unchanged.
 */
const MOVED_BY_STABLE_IDS = Object.freeze({
  runProfile: { 'session-only': 'a5a6931e973ffe17c766aeda6fd2e1de79ab732edd1c067f9b5a44668211ebf9',
    combined: '8694c3b1b651a02ac44ec19fe8d13b4091cf0a64751b7c96aadd8e38ecc5fe4c' },
  sessionProfileDigest: 'a5a6931e973ffe17c766aeda6fd2e1de79ab732edd1c067f9b5a44668211ebf9',
});
/**
 * D64 wording (owner decision 2026-10-07; `sonah.narrative/20`, m33-integration-fixture.js `DISCLOSURE_WORDS_VERSIONS`):
 * the ONLY values that moved from `MOVED_BY_STABLE_IDS` — every case's session-only narrative requests, by item 6's
 * sentence and its output-contract rule alone (`planned`, `sentInOrder`, `sentSorted`; rendered back by
 * `modulesBeforeDisclosureWords`), and the run profiles, by their prompt version alone (`runProfile`,
 * `sessionProfileDigest`; rendered back to /19 they are MOVED_BY_STABLE_IDS'). No window count, label, order or failure
 * moved. `profileAs` maps /20 as it maps /19, and every older render-back renders the two texts back first
 * (m33-n-forbidden-edit-fixture.js `beforeM3`), so each reproduces its older baseline unchanged.
 */
const MOVED_BY_DISCLOSURE_WORDS = Object.freeze({
  cases: [
    { planned: 'c7ab880239e4693083f6b1aace6a61b252555bb7beed675963b94fc3029ddadb',
      sentInOrder: 'beb12403e912688563c80edef65165dcf7c495596bf0f3c3fb0a589c29b09f4a',
      sentSorted: '372d7555725e7054a2b8a3454035dae87c63bca3fc01678e6907b8a679ae3cbe' },
    { planned: '7cd06587bb799c42507d89ded2ad3c0d9ebbea2787f9d9ec8715e577b428c99f',
      sentInOrder: 'dd5e9a41c65dd7dd23e03750c7a7b90fa0a4ffcc3b5c4460d05d752477346ab9',
      sentSorted: 'e0bd8748064614f0048b87a415c9887c2d97016d775fd6193a7d0a996e2c44dc' },
    { planned: 'c25d9d993973501b9d41b1920bf71af9a50d53699262f02bf8edcbf56f8572f0',
      sentInOrder: '4170126c0b5038ec63130c20969527cef625d3f0f00868b3aef3de83d327dfd1',
      sentSorted: 'd48aee230af6b186cc8f4a72e4166341b87e4044cf1de3f9f2c0e2cd16d5821a' },
  ],
  runProfile: { 'session-only': '30c3768fded7c2cc0178066321a38c7297d2779ecf184f96455916467f35de7c',
    combined: '9f06d51d4830647c89c3b3e7d2bedd9312aca254747ff8b6b7e2447f0d81cea4' },
  sessionProfileDigest: '30c3768fded7c2cc0178066321a38c7297d2779ecf184f96455916467f35de7c',
});
/** What the code sent before the D64 wording (stable ids'). */
const STABLE_IDS_CURRENT = Object.freeze({ cases: AFTER_STATUS_FACT.cases.map((c, at) => ({ ...c,
  ...MOVED_BY_INTEGRATION.cases[at] })), runProfile: MOVED_BY_STABLE_IDS.runProfile,
sessionProfileDigest: MOVED_BY_STABLE_IDS.sessionProfileDigest });
/** What the code sent before M35 windowing (the D64 wording's). */
const DISCLOSURE_WORDS_CURRENT = Object.freeze({ cases: STABLE_IDS_CURRENT.cases.map((c, at) => ({ ...c,
  ...MOVED_BY_DISCLOSURE_WORDS.cases[at] })), runProfile: MOVED_BY_DISCLOSURE_WORDS.runProfile,
sessionProfileDigest: MOVED_BY_DISCLOSURE_WORDS.sessionProfileDigest });
/**
 * M35 windowing (C-07 "M35 windowing"; `sonah.narrative/21`, `sonah.challenge/18`, `sonah.windows/3`, the carry gone;
 * m33-integration-fixture.js `WINDOWING_VERSIONS`): the ONLY values that moved from `DISCLOSURE_WORDS_CURRENT`. Every
 * case's narrative and challenge requests moved (windows by segment, carried context, trims, aliases), and so the
 * `large` case's windows (its results are trimmed to 2k tokens, so its eight byte-budget windows are one and its
 * oversized result is reviewed), its calls, their labels and its failure. The `lanes` case's fixture moved with it
 * (m33-fast-profile-fixture.js `padUnit`: each unit writes a long file, so it is still four windows); its window
 * count, call count and labels did not move. The run profiles moved: their versions, the windowing member in place of
 * `segmentation` and `carry`, and a session-only request bound of `WINDOW_REQUEST_MAX_BYTES`. A text render-back can no
 * longer reproduce an older capture (every window moved), so the captures before this one are kept as the record and
 * only the run profiles are rendered back (`asBeforeWindowing`).
 */
const MOVED_BY_WINDOWING = Object.freeze({
  cases: [
    { windows: 1, planned: '5ced5a7913f9b5a33aff30eeb1a840d009613c575f277d44f9280398bed98866', sentCount: 11,
      sentInOrder: '878dd959414e069c2d02e305e48578abd356bff7d2d3a4b0de84bf7c36a88dc5',
      sentSorted: '38aa7f538a537504d5064f48cf6d473c1bcadf70d0d9f538e93efb7a1cace42c',
      labels: '432795354bee07b08f6c43cc47f86b271e4253e85bf1fd330f9c181b0e6f33e2', windowFailures: '' },
    { planned: 'ff91938c1eabd0450a225730cecdf1ad46413f1239c2785557c43f6dc90d8eda',
      sentInOrder: 'abda14cfda68adf6fa48b384675d3dbc33147ff431e449c43a58d64c6de55129',
      sentSorted: 'acc90f20188c7dbc44b239d8bb5f1444a314aca0250fb49d38ce0a44978cfd54' },
    { planned: '319882a15d4f412d1886a13ba3c001005bafb47c005437588c9e12c664eb71e5',
      sentInOrder: '60b0456aedde8073e160a28d6013b16300a48d7d8a22b951c2ddc4f90828a424',
      sentSorted: '9b381fe08d53086a9e0fd0a7c92a4d94aa4abc7f290495b19906db4f2791430b' },
  ],
  runProfile: { 'session-only': '8cc67966d991357352feebdc7136da393f38652300ae12e669b1920df9d2e7ba',
    combined: 'bb80e1d0465b510e18eca786a3c4743c12155c3f6cc966c684a7e750c69303d4' },
  sessionProfileDigest: '8cc67966d991357352feebdc7136da393f38652300ae12e669b1920df9d2e7ba',
});
/** What the code sent before M36 phase 1 (M35 windowing's). */
const WINDOWING_CURRENT = Object.freeze({ cases: DISCLOSURE_WORDS_CURRENT.cases.map((c, at) => ({ ...c,
  ...MOVED_BY_WINDOWING.cases[at] })), runProfile: MOVED_BY_WINDOWING.runProfile,
sessionProfileDigest: MOVED_BY_WINDOWING.sessionProfileDigest });
/**
 * M36 phase 1, recording fidelity (D68; m33-integration-fixture.js `RECORDED_FACTS_VERSIONS`:
 * `sonah.narrative/22`, `sonah.challenge/19`): the ONLY values that moved from `WINDOWING_CURRENT` are the run profiles,
 * by their versions alone. The evidence a request carries moved for a real session (whole bodies, statements and
 * reports, newly shown observations, new Codex actions); every case here is hand-built and none of that touches it, so
 * no case's windows, requests, labels or failures moved. Rendered back (`profileBeforeRecordedFacts`), each run profile
 * is M35 windowing's, byte for byte.
 */
const MOVED_BY_RECORDED_FACTS = Object.freeze({
  cases: [{}, {}, {}],
  runProfile: { 'session-only': '6d2cba24a2ce1e3016d2d143b56bf4c7cf0b88390d25747fcef2c83b8bdf8507',
    combined: 'accec054c3a0b243664858393fc1e2658b2ce8950db821570e10db721cb3290b' },
  sessionProfileDigest: '6d2cba24a2ce1e3016d2d143b56bf4c7cf0b88390d25747fcef2c83b8bdf8507',
});
/** What the code sent before M36 phase 2 (phase 1's). */
const RECORDED_FACTS_CURRENT = Object.freeze({ cases: WINDOWING_CURRENT.cases.map((c, at) => ({ ...c,
  ...MOVED_BY_RECORDED_FACTS.cases[at] })), runProfile: MOVED_BY_RECORDED_FACTS.runProfile,
sessionProfileDigest: MOVED_BY_RECORDED_FACTS.sessionProfileDigest });
/**
 * M36 phase 2, the window format (D68 P, L, T, H; C-07 "M36 window format"; m33-integration-fixture.js
 * `FORMAT_VERSIONS`: `sonah.windows/4`, `sonah.narrative/23`, `sonah.challenge/20`, `sonah.challenge-dossier/5`): the
 * ONLY values that moved from `RECORDED_FACTS_CURRENT`. Every case's narrative and challenge requests moved — each
 * RESULT opens with its label line, `large`'s results are cut on whole lines with their omitted lines named — and the run
 * profiles, by their versions alone. No case's windows, call count, labels or failures moved. Rendered back
 * (`profileBeforeFormat`, applied first by `profileBeforeRecordedFacts`), each run profile is phase 1's, byte for byte.
 */
const MOVED_BY_M36_FORMAT = Object.freeze({
  cases: [
    { planned: '3a82788ad8970aa151285ca87d7752c39e36f8c547e5ca047421e1ea8b9fd45a',
      sentInOrder: '3be427ba63ec0090aa47fcb26b50e8842fc6408eb5b10938fb1463e22d897fb4',
      sentSorted: '90d1eecd6695344e4063f414b27458be22a06677c9fdae51c8eda16708254611' },
    { planned: '947312e1b709fad3bfe2de1259d288975fae2ea190e0de0cc4ee0c00a3a3de02',
      sentInOrder: '262a33c035eb1537b136f523f88240f86983a6aebd56bcd640e5cfad2df395d9',
      sentSorted: '0d640eea4cdfc0489e4d54736203dba7a3d69984456e0006e43c55b5d797132d' },
    { planned: '2b77dd77eacb8f060ccae9fbe740c50086becd6eae2cfe6806e3985bb7cdcb3c',
      sentInOrder: '8497e986dfe15604b830f93c3fe736ed2bbbe0ee1e46d1656f9710028763b5d9',
      sentSorted: 'e612569a6d3507b81046630797e2b56e69b2e129d9f0a197359ec0bf45444fac' },
  ],
  runProfile: { 'session-only': '3cb88ed26ac1b3d4b1ec0298264dc34aac91b123e9ad00cf284fee330290e5fb',
    combined: 'a7eb83a41deca1e86546d27f5fc06ac633c6d2d58726ad58f425c8a47dc6aaec' },
  sessionProfileDigest: '3cb88ed26ac1b3d4b1ec0298264dc34aac91b123e9ad00cf284fee330290e5fb',
});
/** What the code sent before M36 phase 3 (phase 2's). */
const FORMAT_CURRENT = Object.freeze({ cases: RECORDED_FACTS_CURRENT.cases.map((c, at) => ({ ...c,
  ...MOVED_BY_M36_FORMAT.cases[at] })), runProfile: MOVED_BY_M36_FORMAT.runProfile,
sessionProfileDigest: MOVED_BY_M36_FORMAT.sessionProfileDigest });
/**
 * M36 phase 3 (D68 K, Q, F; C-07 "M36 packed windows", "M36 evidence re-ask", "M36 carried failures";
 * m33-integration-fixture.js `CONVERSATION_VERSIONS`: `sonah.windows/5`, `sonah.narrative/24`, `sonah.challenge/21`,
 * `sonah.challenge-dossier/6`): the ONLY values that moved from `FORMAT_CURRENT`. Every case's narrative requests moved by
 * item 1's actor sentence and the session-only contract's `evidenceRequests` member and rules (`beforeM36Conversation`),
 * and so its planned and sent digests; the run profiles moved by their versions and the evidence requests' bounds
 * (`profileBeforeConversation`, applied first by `profileBeforeFormat`). No case holds a helper or a proven failure, and
 * none requests evidence: no case's windows, call count, labels or failures moved.
 */
const MOVED_BY_M36_CONVERSATION = Object.freeze({
  cases: [
    { planned: '6bb8cd7940816df6b834e230d672e4dc4cf543736275e73c8a1f4f32f0e7b495',
      sentInOrder: 'ccf10321ad027676f543121cc9bbb1322af3aa69d6ee81a35ed2d2f9c457c4b8',
      sentSorted: '25b99ec474fe1b1c0a5a67bf97612efb769b30ab4d195c23ea8aca5f40c494e4' },
    { planned: '4f9cd05edddeb9ef7e39ae62116263959028258f9b3f8605e277abb9191e93e1',
      sentInOrder: '60e6750ecf155bf321e073e730ca766809dfacd5eda7005562cd814e6a429044',
      sentSorted: 'cee04263f3837c646d718d9b621351959db427521a9ba05c57bc5890758640e9' },
    { planned: '24d143d0d7ff5f1f665cbc71178bc2a397702093060cb51054726a61770ecf71',
      sentInOrder: 'ddc9bf44171e6e382ea4c51da6ede39634d02edac6aa6a97fdf502d6f1970f5d',
      sentSorted: 'c28014ab1ba937228c4bcd21196ed432f3c713914cb8d4b242b7bc97c68b529e' },
  ],
  runProfile: { 'session-only': 'c3e8983bb6a63200903bb0af93d7971f812f8b93b7ebbe3a417d9d8e253f39a0',
    combined: '0d973bf8cd7332cb7aea00b35b723bf1d5c2286db1c572ed10b26a615351e8a0' },
  sessionProfileDigest: 'c3e8983bb6a63200903bb0af93d7971f812f8b93b7ebbe3a417d9d8e253f39a0',
});
/** What the code sent before D69 (M36 phase 3's). */
const M36_CURRENT = Object.freeze({ cases: FORMAT_CURRENT.cases.map((c, at) => ({ ...c,
  ...MOVED_BY_M36_CONVERSATION.cases[at] })), runProfile: MOVED_BY_M36_CONVERSATION.runProfile,
sessionProfileDigest: MOVED_BY_M36_CONVERSATION.sessionProfileDigest });
/**
 * Owner decisions D69 (2026-10-08; m33-integration-fixture.js `D69_VERSIONS`: `sonah.windows/6`, `sonah.narrative/25`,
 * `sonah.challenge/22`, `sonah.challenge-dossier/7`, `sonah.code-review/22`): the ONLY values that moved from
 * `M36_CURRENT` — the run profiles, by their versions alone (`profileBeforeD69`, applied first by
 * `profileBeforeConversation`). No case changes a file twice in a window, withholds an output, or writes outside the
 * recorder's cwd: no case's requests, windows, call count, labels or failures moved.
 */
const MOVED_BY_D69 = Object.freeze({
  runProfile: { 'session-only': '537c900346c66bbde9d7baf3b047860b772d2c97e9f1c59b1167bf1344b3e5fe',
    combined: 'f9957947b9baf62812192fef8253c42404d541a645f51a616322708687718280' },
  sessionProfileDigest: '537c900346c66bbde9d7baf3b047860b772d2c97e9f1c59b1167bf1344b3e5fe',
});
/** What the code sent before the D69 review (D69's). */
const D69_CURRENT = Object.freeze({ ...M36_CURRENT, runProfile: MOVED_BY_D69.runProfile,
  sessionProfileDigest: MOVED_BY_D69.sessionProfileDigest });
/**
 * The D69 review (2026-10-08; m33-integration-fixture.js `D69_REVIEW_VERSIONS`: `sonah.windows/7`, `sonah.narrative/26`,
 * `sonah.challenge/23`, `sonah.challenge-dossier/8`, `sonah.code-review/23`): the ONLY values that moved from
 * `D69_CURRENT` — the run profiles, by their versions alone (`profileBeforeD69Review`, applied first by
 * `profileBeforeD69`). No case cuts a combined result, carries a context over the bound, withholds an output or spells
 * a path outside its recorder's cwd: no case's requests, windows, call count, labels or failures moved.
 */
const MOVED_BY_D69_REVIEW = Object.freeze({
  runProfile: { 'session-only': '0f077fbfc7c9f9f57826d84b18b609327db9270dc406071099222be877652059',
    combined: '830f2917adb9e9fdca1ee5b6c2842bf179067183478187e58ea73751bdbffb19' },
  sessionProfileDigest: '0f077fbfc7c9f9f57826d84b18b609327db9270dc406071099222be877652059',
});
/** D70 review (S0): D70's default model is not a run profile member, so nothing moved since the D69 review. */
/** What the code sent before D71 (S2): the D69 review's. */
const D69_REVIEW_CURRENT = Object.freeze({ ...D69_CURRENT, runProfile: MOVED_BY_D69_REVIEW.runProfile,
  sessionProfileDigest: MOVED_BY_D69_REVIEW.sessionProfileDigest });
/**
 * D71 (S2, the reviewer brief as the checklist; m33-integration-fixture.js `D71_BRIEF_VERSIONS`): the values that moved
 * from `D69_REVIEW_CURRENT`. Every case's narrative requests (the brief as the system prompt, the window in the checklist's
 * reading order and format) and challenge requests (one proposition per item, the session core and its notes, the human
 * block first in the evidence); the run profiles, by their versions and the session-only contract (`profileBeforeD71Brief`
 * renders them back); and the `large` case's calls and labels — its synthetic requirements are not-checked rows now (the
 * fixture's `windowNarrative`), the weakest status, which is never challenged. Nothing renders a request back to the D69
 * review's.
 */
const MOVED_BY_D71_BRIEF = Object.freeze({ cases: [
    { planned: 'aa389ad08b20caee5748aaa459de7cc65b77b857232035eec00704e7da1b5f2c', sentCount: 8, sentInOrder: '99a642ce2c18d0fa79ddc27ce0b6ea1e2dc7867f69187d12f9e6bf06b1204417', sentSorted: 'c503126a388055575930d2d18b3adead6fb2d2ba907ecec2bc057c52856ae596', labels: 'cb235b1eec0f3aeeddf531a2b8de853ca1beeae4c86cb85719ad90a713a58a50' },
    { planned: 'e6928156c9fb87a388b02c927a3d404b58ab3ffe7d50f35356479993b0d64ccc', sentInOrder: 'b3a28f571a77e96ab4689a2d4b205ddf13e1d584f998acee537ddbe613510330', sentSorted: '663218e2f0e45b7a90eb75fb42cc26edf182ab7c0cb7c71188513b1d8c38fd6c' },
    { planned: 'f9c218a0f959a90ecff3c3d4098446e41b456202dd24810d62ddd5ac262ffae3', sentInOrder: '705533e13aef5c45ef361d5de187fa389ccd9cbf98c4b5ec7fe668e84b9ccfd5', sentSorted: '1dc84ae885ad39f894529ac1abb91de58682c06ece371ed39df5f699561a1356' }],
  runProfile: { 'session-only': 'f3abfd20ffe4cd4138fe8261418aa1f8e6343b0265fe84565af5cd6bb9cfcac6',
    combined: '3ffc2c967b35eafbe31b89c0c322ff118028c50554efd5f585cf23886526fe3f' },
  sessionProfileDigest: 'f3abfd20ffe4cd4138fe8261418aa1f8e6343b0265fe84565af5cd6bb9cfcac6',
});
/** What the code sent at D71 (S2). */
const D71_BRIEF_CURRENT = Object.freeze({ ...withMoves(D69_REVIEW_CURRENT, MOVED_BY_D71_BRIEF.cases),
  runProfile: MOVED_BY_D71_BRIEF.runProfile, sessionProfileDigest: MOVED_BY_D71_BRIEF.sessionProfileDigest });
/**
 * D71 (S3, the new channels; m33-integration-fixture.js `D71_CHANNELS_VERSIONS`): the values that moved from
 * `D71_BRIEF_CURRENT`. Every case's narrative requests ("About this window" lists the RESULTs step 4 answers for; the
 * brief's last step is step 6; the brief itself) and challenge requests (the session core's sixth role, the claim note);
 * the run profiles, by their versions and the session-only contract (`profileBeforeD71Channels` renders them back to S2's,
 * byte for byte). No case's calls or labels moved. Nothing renders a request back to S2's.
 */
const MOVED_BY_D71_CHANNELS = Object.freeze({ cases: [
    { planned: '43a547ca814de075a16954ee06f3eff1e57929bfaef5789543253da651d7cb8d', sentInOrder: '766ac96683f45247b2821e62525bb0ab9974b343270bfe72c8101d59639ef7bd', sentSorted: '9466b8d343394cf39ee2197e38e6740458651be1975556802b9096472fb79368' },
    { planned: 'a9b83100ca5f5c0885b5edba90fa611c3c33a839f4d82dcdec897331cf343331', sentInOrder: 'c1688ef65c520252f98c8f2a60fbaaacfc2812c148d934c493f5a5ac7d2acee6', sentSorted: '25eebb31061a854462f7f2ba68a8d69757d36146322387330b9605384f78a0f6' },
    { planned: 'b658f18c44db4344994d29915739708bc79004890e29a4d9ea2c9bec6bf4abcf', sentInOrder: '59955a96c2fdf74a3fafb07ba4ddb30c0bf620e6b07272ccf62944f5f052c6e0', sentSorted: '172e69669bef41d7a87318507971b18eaf964b2977f4aac4ce2c1c10f1036604' }],
  runProfile: { 'session-only': '317af72027b19c400aa5c1d55e34c0d8f82776c3d6d90f9acb204d92c5e62320',
    combined: 'c70fdd72ddbb4732ebb503690565c93f9457b44c791e3f320db0b8112339bd42' },
  sessionProfileDigest: '317af72027b19c400aa5c1d55e34c0d8f82776c3d6d90f9acb204d92c5e62320',
});
/** What the code sent at D71 (S3). */
const D71_CHANNELS_CURRENT = Object.freeze({ ...withMoves(D71_BRIEF_CURRENT, MOVED_BY_D71_CHANNELS.cases),
  runProfile: MOVED_BY_D71_CHANNELS.runProfile, sessionProfileDigest: MOVED_BY_D71_CHANNELS.sessionProfileDigest });
/**
 * S6 (the fixes of the S5 review; m33-integration-fixture.js `D71_FIX_VERSIONS`): the values that moved from
 * `D71_CHANNELS_CURRENT`. Every case's narrative requests (the brief: a choice not to act with no actions, a claim's
 * `restsOn`) and, through their versions, the run profiles (`profileBeforeD71Fix` renders them back to S3's, byte for
 * byte). No case's calls or labels moved. Nothing renders a request back to S3's.
 */
const MOVED_BY_D71_FIX = Object.freeze({ cases: [
    { planned: 'd0853179efba86ebe7a6ed3a8d22d6fb07ff7ab937cb1ccf33a75b7584c7cda0', sentInOrder: '9f14acd13fca95b532cbcc0f6c7f885710233dbdb72d99395e77c7bedd0e1ad5', sentSorted: '096497f77f8e2182517786cbcdf6ad856fa1498b2759d58d897f315ab8070c8c' },
    { planned: 'd49ea1f8f62fbcf56eb88a112daeb0529aeab881b59214c415d536e00ac771b5', sentInOrder: 'fbd036ae2cfc99a588c01af25f629cda2f8d007b83a6ce24c6f10798cfe8c5f3', sentSorted: '4d041ac5f06ffa0c2fdc25b5c4fa74c4ff18903e528dd4cb5980c56062c758e1' },
    { planned: '4df3ea6de34d760393a0184cdd5fffb6602efd3ee731c6e58783a8b95172b845', sentInOrder: 'f4c12d9c61204c01b0d23919a5d76a669b02ee57a76986a6760879b69ca99123', sentSorted: '23f30e47f3f46bf344976529d5704501069328867e5b2cff913cb0e12248e2cd' }],
  runProfile: { 'session-only': 'b9bad2f41d7618e1c85a848f86b403a307bf4fb91dc53f9a9b3d5fb719daf6cf',
    combined: '863cd3c16a1419ceec55f642460ded0e775d1a3964c6b4b5613094b112d1d41d' },
  sessionProfileDigest: 'b9bad2f41d7618e1c85a848f86b403a307bf4fb91dc53f9a9b3d5fb719daf6cf',
});
/** What the code sent at S6. */
const D71_FIX_CURRENT = Object.freeze({ ...withMoves(D71_CHANNELS_CURRENT, MOVED_BY_D71_FIX.cases),
  runProfile: MOVED_BY_D71_FIX.runProfile, sessionProfileDigest: MOVED_BY_D71_FIX.sessionProfileDigest });
/**
 * S7 (m33-integration-fixture.js `S7_VERSIONS`): the values that moved from
 * `D71_FIX_CURRENT`. Every case's narrative requests (the brief's restsOn and step 4 sentences, the failures line) and,
 * through their versions, the run profiles (`profileBeforeS7` renders them back to S6's, byte for byte; the combined one
 * moved by the shared challenge version alone). No case's calls or labels moved. Nothing renders a request back.
 */
const MOVED_BY_S7 = Object.freeze({
  cases: [
    { planned: '1719097a66a213d4724cc5fe6df6be0bd4c8cb64271e6f9b9c9543446adfbcf5', sentInOrder: '8d62aa6a06bc2e0732eb0e00303389e7cb0b5502d6fafa1c0933059f480e6731', sentSorted: '96e37213fb26daf0ae99f1a2497c79ef5cfc43be4d654fe1a1344c49e431981a' },
    { planned: 'a536b8d6443fbe98c0617e5b584664530a07e1d7d5d84464122964a515efcaa1', sentInOrder: '227bc3cbe77c860e0ae309b1c9f3cb63ab4e14518f2914cfdc1bad46a425fca3', sentSorted: 'b16f313a9687379fe5394bfe7508334e5adcd4b5fff566685273b6813b14a8cb' },
    { planned: '4ad75f5ec52eefee9f5208d7df2d7c1f8de413ec4fec20507feb7e04d77a82b6', sentInOrder: 'fcce92b18b3e5a1c71baf1c4dc22c403fab7c9a59cbf69b16dbb84c08a5ccacf', sentSorted: 'c39553f430446752e7120fa6fbfa37aa7042ff7945326367884bebe16df776fa' },
  ],
runProfile: { 'session-only': '6d33b04f05b17d9ecaf40ed7a09df3d0bd99ba027b34c38a7e1af80c33317940', combined: '01d581d66fc0ac9ffbb212575332c3e5466b39b140107f958a843991989621f5' },
sessionProfileDigest: '6d33b04f05b17d9ecaf40ed7a09df3d0bd99ba027b34c38a7e1af80c33317940',
});
/** What the code sent at S7. */
const S7_CURRENT = Object.freeze({ ...withMoves(D71_FIX_CURRENT, MOVED_BY_S7.cases),
  runProfile: MOVED_BY_S7.runProfile, sessionProfileDigest: MOVED_BY_S7.sessionProfileDigest });
/**
 * The D80 integration (owner decision D80, its four items in one step; m33-integration-fixture.js `D80_VERSIONS`): the
 * values that moved from `S7_CURRENT`. Only the run profiles, through their narrative version (and the lean profile's
 * dossier version): `profileBeforeD80` renders them back to S7's, byte for byte. No case's requests, calls or labels
 * moved: no case holds a call the recorder typed with a stopped denial kind, the one text item N moved.
 */
const MOVED_BY_D80 = Object.freeze({
  cases: [{}, {}, {}],
  runProfile: { 'session-only': '20f215be42b5eb196d8b75dce5ffb11cc91caf1f74b1893c232c75b6a86cdfee',
    combined: 'af54b953683655699901a57820e6eddbfbea6a945ef5955160fbaaeeddd31888' },
  sessionProfileDigest: '20f215be42b5eb196d8b75dce5ffb11cc91caf1f74b1893c232c75b6a86cdfee',
});
/** What the code sent at the D80 integration. */
const D80_CURRENT = Object.freeze({ ...withMoves(S7_CURRENT, MOVED_BY_D80.cases),
  runProfile: MOVED_BY_D80.runProfile, sessionProfileDigest: MOVED_BY_D80.sessionProfileDigest });
/**
 * The column fix (owner decisions D83 (2) and D84; m33-integration-fixture.js `FIX_COLUMN_VERSIONS`): the values
 * that moved from `D80_CURRENT`. Every case's requests (the brief says who decided a decision; a challenge request
 * holding a decision, its note and propositions) and, through their versions and the session-only contract's covering
 * role, the run profiles (`profileBeforeFixColumn` renders them back to the D80 integration's, byte for byte). D84
 * moved them again in the same versions: "made without asking you" checks the shown project instruction
 * files too (the brief, DECISION_NOTE, and the session-only contract's instructionReview check role), and on 2026-10-13
 * again: "you settled it" is words that state the choice's own answer (the brief and DECISION_NOTE; no fixture decision
 * is settled, so no proposition moved), and DECISION_NOTE never says to refute a decision those words settle (D84 (3));
 * and the settled-words gain: such a choice is reported settled at the level the words address (the brief and
 * DECISION_NOTE; no proposition moved). No case's windows, calls, labels or run profiles moved.
 */
const MOVED_BY_FIX_COLUMN = Object.freeze({
  cases: [
    { planned: '849f61fb8a6086aae2ba68041505c440fd769e1a36ac5568d0207650918415d6',
      sentInOrder: '25afd589ea1bed73472e631178f21fef24fc518b82e58e8418785f157269c50d',
      sentSorted: 'd1fc336158862b41a5a4fb6beb77134b7b87801d72adf6aa89a8bd9654487816' },
    { planned: 'a32af12b57015825f4076f20fe62d1a0c11162da4ab957685d3a9b7f8db0d012',
      sentInOrder: '4245d7809adb8bff576a4ed3ca56afd2b1f7a8d8572b61dcc25efe628be15522',
      sentSorted: '27b39dfe55ae17d30ad6ba39c8efe58220b2311f03fbb975cb544bb6aa34a763' },
    { planned: 'b81f42a2aeb3107044cbf55901e21a979d0f2aebccbac715045060af01ff6415',
      sentInOrder: '12a3cab282c355ce629d5e6634a085742553049f8ec63df3957c4e704282e4e2',
      sentSorted: '97a60bcecb6e0473e8409c7aeda262ba7b238d0a596cb03bb1fb2a68f10b7863' },
  ],
  runProfile: { 'session-only': '2f87ef10bc31dde50d657a91d44918efe7d34bf9a3085cc048a078217683dbcc',
    combined: '57d3a93bcbd031cca6fe850c1bbd6fb25fd6c556472be65f612823ba7d8a2eb0' },
  sessionProfileDigest: '2f87ef10bc31dde50d657a91d44918efe7d34bf9a3085cc048a078217683dbcc',
});
/** What the code sent at the column fix. */
const FIX_COLUMN_CURRENT = Object.freeze({ ...withMoves(D80_CURRENT, MOVED_BY_FIX_COLUMN.cases),
  runProfile: MOVED_BY_FIX_COLUMN.runProfile, sessionProfileDigest: MOVED_BY_FIX_COLUMN.sessionProfileDigest });
/**
 * The asks fixes (m33-integration-fixture.js `ASKS_FIXES_VERSIONS`): the values that moved from
 * `FIX_COLUMN_CURRENT`. S3: the run profiles, through their narrative version (`profileBeforeAsksFixes` renders them
 * back to the column fix's, byte for byte); no case's challenge refutes a requirement, the one thing that sends S3's
 * re-ask. P1: every case's requests, by the brief's one sentence (ASKS_FIXES_TEXTS), and the session-only run profile,
 * through its agent version. No case's windows, calls or labels moved.
 */
const MOVED_BY_ASKS_FIXES = Object.freeze({
  cases: [
    { planned: '364e58c541590e44e3685373a5712b9a0118c2d82ae0932550b1bd70ab3fe202',
      sentInOrder: '76de4d161572cc513902df8c6d9986cf915b5a93dffad717c4906c1e8eb6471f',
      sentSorted: '955859f4e80c0a3ae485877125d596b85b770681a454bc3727c5a4a1b1efa29d' },
    { planned: 'c5dee7797755749f4f1bdc9c1dfd74aaee4e336d08a3d565959f6d19e70f56b5',
      sentInOrder: '0545b1fe6f79d6899302edb1687be9179d2989ac0f1c0d191ff8dbba7c016d67',
      sentSorted: '71cc4e4092fb717592941e315ed77b706ee8a8f495b9f80998d206b649a876bb' },
    { planned: '2fb2324e7e5f0024af492b308b02a512efeabb8744121628f578f20fcdb8cec8',
      sentInOrder: '5d83900ca2458c0e0a591746b0bed6c9159dca5552dcbfc4b4737f3b72f23bd6',
      sentSorted: '5d43fa8d1dbbc416a419166c17282b1a06343a6245b664d2086777a84623150f' },
  ],
  runProfile: { 'session-only': 'a2916ea8f027b3130a5a51215b9988f81caac16c9f3dc6f7c396b251039e226d',
    combined: 'e968f2a06b5a9b67705505e980d672e8a1be0012d86221a12d2ae69bd567d781' },
  sessionProfileDigest: 'a2916ea8f027b3130a5a51215b9988f81caac16c9f3dc6f7c396b251039e226d',
});
/** What the code sent at the asks fixes. */
const ASKS_FIXES_CURRENT = Object.freeze({ ...withMoves(FIX_COLUMN_CURRENT, MOVED_BY_ASKS_FIXES.cases),
  runProfile: MOVED_BY_ASKS_FIXES.runProfile, sessionProfileDigest: MOVED_BY_ASKS_FIXES.sessionProfileDigest });
/**
 * W1 (m33-integration-fixture.js `W1_VERSIONS`): the values that moved from `ASKS_FIXES_CURRENT`. A: the run profiles,
 * through their narrative version; no case's challenge refutes a decision, the one thing that sends A's checks and its
 * re-ask. B: every case's requests, by the brief's texts (W1_TEXTS: step 3's sentence, step 5, a forbidden edit's
 * instruction role and its contract rule), and the run profiles, through their agent and challenge versions and the
 * session contract's forbidden-edit instruction role. Rendered back (`modulesBeforeW1`, `profileBeforeW1`), every case
 * and run profile is the asks fixes', byte for byte. No case's windows, calls or labels moved.
 */
const MOVED_BY_W1 = Object.freeze({
  cases: [
    { planned: '1ded93db32d7c2f3dfe4d8ac3ecfc9bfee3c99160171fb681e4fd1ff156987cf',
      sentInOrder: '4bdfcf46b409d0c29aa13387bfab48f889ca51a26786ba94ccbfced64dfc32de',
      sentSorted: '5a6de64e7ccc2380c33f1572a498200cbbe1414e70fbddee8e259e72d43c4a80' },
    { planned: '82c5f3ef09882123d898da92db0bd8ed19e017fa160c190811600b74d19c59a1',
      sentInOrder: 'f4d4282bca8d8b67c1e5c051ae538d65e0b6f749700a90618c5e4110ea86506e',
      sentSorted: '4fa5137f7cd7f5edd2c8704aef68c34d6a0b0e3fc7957a0663cab20b6e5691ab' },
    { planned: 'f2263c1dcfca64747623e9bad8b89065949e410e092bf4b8ae2c4baa61498f29',
      sentInOrder: '3bb42352730d0933d91c1f126a5ed90fb099ea38be23329bd7a474e6876fe45f',
      sentSorted: 'd693bb608de65010fa4341292faa1b0bde8254c69b10b9d153372089c2c45e7e' },
  ],
  runProfile: { 'session-only': 'a461c854035e6c61e3d61468eb8d3810ff0d96559362e4a531e43e52d9ac1084',
    combined: '0ab70affeea7f264d63451ded88ebf8233977b8ef4bfa918160ba8b7f2848f64' },
  sessionProfileDigest: 'a461c854035e6c61e3d61468eb8d3810ff0d96559362e4a531e43e52d9ac1084',
});
/** What the code sent at W1. */
const W1_CURRENT = Object.freeze({ ...withMoves(ASKS_FIXES_CURRENT, MOVED_BY_W1.cases), runProfile: MOVED_BY_W1.runProfile,
  sessionProfileDigest: MOVED_BY_W1.sessionProfileDigest });
/**
 * W2 (m33-integration-fixture.js `W2_VERSIONS`): the values that moved from `W1_CURRENT`. 3: every case's requests, by
 * the brief's texts (W2_TEXTS: step 2's compare sentence and its contradictedBy, step 5's written contradiction) and, in
 * a batch holding a claim-class item, CLAIM_NOTE; the run profiles, through their agent and challenge versions and the
 * session contract's written contradiction role. Rendered back (`modulesBeforeW2`, `profileBeforeW2`), every case and run
 * profile is W1's, byte for byte. No case's windows, calls or labels moved.
 */
const MOVED_BY_W2 = Object.freeze({
  cases: [
    { planned: 'c59898f1a1922023e2f89d51f1e7b5cbb850853428bdd5952add5cb75e3d6e57',
      sentInOrder: '5d3846ba30f0c415df758a7cedfbe5ec51528c6367b974aa9c6cf72143d5a214',
      sentSorted: '1717f0cf457f6fda1e6419ca40e45d00c438a39fb2ea11831156e4b2ad89a5a0' },
    { planned: '1d821334f608d3c40c611b37f155c2265c683964d95cb2dfd71908361176a3c5',
      sentInOrder: 'dee3368b61fc7f3cf6d58ff97a36cab8452651b3d6aaa2f990445a4fbc317d73',
      sentSorted: '8ffe3a1e5698fda9bb049fddf7bc15a8de3fbfd79a7426d0bdcc8f088e5b17c6' },
    { planned: '681622ac248c8b3b9eef32dfa89d77f67bea4eadfe2a86f97863b9c502b3b362',
      sentInOrder: '3160bb4ebca0381f0d62a9e678cab8b6bda39e8d5908eb9163818a10999824ef',
      sentSorted: 'c6ff1c4fc6e96afe86d0ec54d051d8fd60559793a5c7846ffed156bb007855ca' },
  ],
  runProfile: { 'session-only': '3ebbe7c1e53f9c60224d47464b0daa234998dcae9a2411d751a695d8aec9bba8',
    combined: '02dd8995299e67b738e76ab5f5215c3d90355b881b357e0317b03f6ce93faffa' },
  sessionProfileDigest: '3ebbe7c1e53f9c60224d47464b0daa234998dcae9a2411d751a695d8aec9bba8',
});
/** What the code sent at W2. */
const W2_CURRENT = Object.freeze({ ...withMoves(W1_CURRENT, MOVED_BY_W2.cases), runProfile: MOVED_BY_W2.runProfile,
  sessionProfileDigest: MOVED_BY_W2.sessionProfileDigest });
/**
 * W3 (m33-integration-fixture.js `W3_VERSIONS`): the values that moved from `W2_CURRENT`. F1(b) and F2: every case's
 * challenge requests holding a claim-class item, by CLAIM_NOTE's changed-since criterion and its failed-result sentence
 * (W3_TEXTS), and the run profiles, through their challenge version. Rendered back (`modulesBeforeW3`, `profileBeforeW3`), every case and run profile is W2's.
 */
const MOVED_BY_W3 = Object.freeze({
  cases: [
    { planned: 'c59898f1a1922023e2f89d51f1e7b5cbb850853428bdd5952add5cb75e3d6e57',
      sentInOrder: 'c41795de751a769d0e53c9582e12423840e2eb1f99f00ca7b9f041ac32a58a2b',
      sentSorted: '6ec6b1232853350d581c92e23b49ae66381e1ae9d3e5df751fb5e84a7f31b4f0' },
    { planned: '1d821334f608d3c40c611b37f155c2265c683964d95cb2dfd71908361176a3c5',
      sentInOrder: '72c3e761cb9e28309c5f0f36c694c5bfcf18aaa9eb6172624731c2556db421c4',
      sentSorted: '17646e1d2dec609bc5071ba90ccc48c121796a6ee0557b9b53a2a56df9bc4828' },
    { planned: '681622ac248c8b3b9eef32dfa89d77f67bea4eadfe2a86f97863b9c502b3b362',
      sentInOrder: '3160bb4ebca0381f0d62a9e678cab8b6bda39e8d5908eb9163818a10999824ef',
      sentSorted: 'c6ff1c4fc6e96afe86d0ec54d051d8fd60559793a5c7846ffed156bb007855ca' },
  ],
  runProfile: { 'session-only': 'cb863ce5980e69ee7d6a53c83ee5261153e6dbe4f4dd3a779e39d77f6c2c9003',
    combined: '9c776ae4d258f34ea0767ab3e028b5170967748aa4c383f30964ed4c1ddf80a6' },
  sessionProfileDigest: 'cb863ce5980e69ee7d6a53c83ee5261153e6dbe4f4dd3a779e39d77f6c2c9003',
});
/** What the code sent at W3. */
const W3_CURRENT = Object.freeze({ ...withMoves(W2_CURRENT, MOVED_BY_W3.cases), runProfile: MOVED_BY_W3.runProfile,
  sessionProfileDigest: MOVED_BY_W3.sessionProfileDigest });
/**
 * The fix review (m33-integration-fixture.js `FIX_REVIEW_VERSIONS`): the values that moved from `W3_CURRENT`. Every
 * case's challenge requests holding a claim-class item, by CLAIM_NOTE's failed-result sentence (FIX_REVIEW_TEXTS), and
 * the run profiles, through their challenge version (/35, then /36 and /37: the forbidden-edit note and the existence
 * check, which no case holds). Rendered back (`modulesBeforeFixReview`, `profileBeforeFixReview`),
 * every case and run profile is W3's.
 */
const MOVED_BY_FIX_REVIEW = Object.freeze({
  cases: [
    { planned: 'c59898f1a1922023e2f89d51f1e7b5cbb850853428bdd5952add5cb75e3d6e57',
      sentInOrder: 'eea8b38d2f661f38ba95e9bd4cc07d0b9a3e3ca7f104a1cbf724a326e9f76042',
      sentSorted: 'bda5c6892e6660f0ec172aee654319c7f09e2ac77076f20aa587f29d7fe91623' },
    { planned: '1d821334f608d3c40c611b37f155c2265c683964d95cb2dfd71908361176a3c5',
      sentInOrder: 'd780a88e6f8e7941858f8ac1005def3f2d384bb7be40b6abbaa64dacccc058f4',
      sentSorted: '5aad1caa857762fb2f4a406d7f1ef26348b1eba997d61bce028e2a7e5c79283b' },
    { planned: '681622ac248c8b3b9eef32dfa89d77f67bea4eadfe2a86f97863b9c502b3b362',
      sentInOrder: '3160bb4ebca0381f0d62a9e678cab8b6bda39e8d5908eb9163818a10999824ef',
      sentSorted: 'c6ff1c4fc6e96afe86d0ec54d051d8fd60559793a5c7846ffed156bb007855ca' },
  ],
  runProfile: { 'session-only': '55909bef6e7ce4b09c49dc671639cdd3dba51b584590ed39e3b6738c6d945fd2',
    combined: '64f066bdc66b3c28ea03aae0f7da4c8eea43da0d07e83381086e310f6269167d' },
  sessionProfileDigest: '55909bef6e7ce4b09c49dc671639cdd3dba51b584590ed39e3b6738c6d945fd2',
});
/** What the code sent at the fix review. */
const FIX_REVIEW_CURRENT = Object.freeze({ ...withMoves(W3_CURRENT, MOVED_BY_FIX_REVIEW.cases),
  runProfile: MOVED_BY_FIX_REVIEW.runProfile, sessionProfileDigest: MOVED_BY_FIX_REVIEW.sessionProfileDigest });
/**
 * D87 (m33-integration-fixture.js `CODE_PASS_VERSIONS`): the values that moved from `FIX_REVIEW_CURRENT` — the run
 * profiles alone, through their challenge version (/38: D87's /35, renumbered at their merge, after the fix
 * review's /37) and (session-only) the code pass's member. No case's request moved: the code pass sends nothing a session
 * review sends. Rendered back (`profileBeforeCodePass`), every run profile is the fix review's.
 */
const MOVED_BY_CODE_PASS = Object.freeze({
  cases: [{}, {}, {}],
  runProfile: { 'session-only': 'b0045ed4bd8edb2c6e3ee00f4e5c1f67e59ad0c632e1f9728402dd86a934fe5c',
    combined: 'e7de010ca95d6c7b6dfcaf42c6a1c5a2be01ae371032ac570341290ec7da696e' },
  sessionProfileDigest: 'b0045ed4bd8edb2c6e3ee00f4e5c1f67e59ad0c632e1f9728402dd86a934fe5c',
});
const CODE_PASS_CURRENT = Object.freeze({ ...withMoves(FIX_REVIEW_CURRENT, MOVED_BY_CODE_PASS.cases),
  runProfile: MOVED_BY_CODE_PASS.runProfile, sessionProfileDigest: MOVED_BY_CODE_PASS.sessionProfileDigest });
/**
 * The D87 review (m33-integration-fixture.js `CODE_PASS_REVIEW_CHALLENGE`): the values that moved from
 * `CODE_PASS_CURRENT` — the session-only run profile alone, through its code-pass member's challenge rule (every pass
 * must uphold). No case moved, nor the combined profile. Rendered back (`profileBeforeCodePassReview`), D87's.
 */
const MOVED_BY_CODE_PASS_REVIEW = Object.freeze({
  cases: [{}, {}, {}],
  runProfile: { 'session-only': 'c010dec10c0df0082568d39952221de40c3a8e99f3b62afa482300300a042890',
    combined: MOVED_BY_CODE_PASS.runProfile.combined },
  sessionProfileDigest: 'c010dec10c0df0082568d39952221de40c3a8e99f3b62afa482300300a042890',
});
const CODE_PASS_REVIEW_CURRENT = Object.freeze({ ...withMoves(CODE_PASS_CURRENT, MOVED_BY_CODE_PASS_REVIEW.cases),
  runProfile: MOVED_BY_CODE_PASS_REVIEW.runProfile, sessionProfileDigest: MOVED_BY_CODE_PASS_REVIEW.sessionProfileDigest });
/**
 * The code step (m33-integration-fixture.js `CODE_STEP_VERSIONS`, `CODE_PASS_PROFILE_D87_REVIEW`): the
 * values that moved from `CODE_PASS_REVIEW_CURRENT` — the run profiles alone, through their challenge
 * version (/39) and (session-only) the code pass's member (its new versions, vocabularies and rules). No case's request
 * moved: the code step sends nothing a session review sends. Rendered back (`profileBeforeCodeStep`), the D87 review's.
 */
const MOVED_BY_CODE_STEP = Object.freeze({
  cases: [{}, {}, {}],
  runProfile: { 'session-only': 'f115e59cdd26c839074201f30064a3ffabad981fe7df70b1ce826cb4746e9dd3',
    combined: '7fd77eeb6acf231135ecdfc5b448a6e86ed6cb9c272bf1fe27a591264b894bad' },
  sessionProfileDigest: 'f115e59cdd26c839074201f30064a3ffabad981fe7df70b1ce826cb4746e9dd3',
});
const CODE_STEP_CURRENT = Object.freeze({ ...withMoves(CODE_PASS_REVIEW_CURRENT, MOVED_BY_CODE_STEP.cases),
  runProfile: MOVED_BY_CODE_STEP.runProfile, sessionProfileDigest: MOVED_BY_CODE_STEP.sessionProfileDigest });
/**
 * The review of the code step (m33-integration-fixture.js `CODE_STEP_REVIEW_VERSIONS`, `CODE_PASS_PROFILE_CODE_STEP`;
 * 2026-10-14): the values that moved from `CODE_STEP_CURRENT` — the run profiles alone, through their challenge version
 * (/40) and (session-only) the code pass's member (code-snapshot/3, code-check/3, code-pass/3, the refutation reasons,
 * the actors, the merge). No case's request moved: the code step sends nothing a session review sends. Rendered back
 * (`profileBeforeCodeStepReview`), the code step's.
 */
const MOVED_BY_CODE_STEP_REVIEW = Object.freeze({
  cases: [{}, {}, {}],
  runProfile: { 'session-only': '7a398695aa5f182adb37276b2388ea517e3bfced7ef856323867732650466ded',
    combined: '0a67c05e2748ef0a7e2beb45e551e14f2804d18fcea153312d5e7fb8c9ebdf7c' },
  sessionProfileDigest: '7a398695aa5f182adb37276b2388ea517e3bfced7ef856323867732650466ded',
});
const CODE_STEP_REVIEW_CURRENT = Object.freeze({ ...withMoves(CODE_STEP_CURRENT, MOVED_BY_CODE_STEP_REVIEW.cases),
  runProfile: MOVED_BY_CODE_STEP_REVIEW.runProfile, sessionProfileDigest: MOVED_BY_CODE_STEP_REVIEW.sessionProfileDigest });
/**
 * The second review of the code step (m33-integration-fixture.js `CODE_STEP_REREVIEW_VERSIONS`,
 * `CODE_PASS_PROFILE_CODE_STEP_REVIEW`; 2026-10-14): the values that moved from `CODE_STEP_REVIEW_CURRENT` — the run
 * profiles alone, through their challenge version (/41) and (session-only) the code pass's member (code-snapshot/4,
 * code-check/4, code-pass/4, the recorded-result operations). No case's request moved: the code step sends nothing a
 * session review sends. Rendered back (`profileBeforeCodeStepRereview`), the review of the code step's.
 */
const MOVED_BY_CODE_STEP_REREVIEW = Object.freeze({
  cases: [{}, {}, {}],
  runProfile: { 'session-only': '23321e71f3b9e46e66c6d7630e1888baab040d47edf3195d697a5e97d2a2049e',
    combined: '6d7e6b6b79d37c33513b43f66420018a41f19dec9f5c9bb5cffc50c268f7a576' },
  sessionProfileDigest: '23321e71f3b9e46e66c6d7630e1888baab040d47edf3195d697a5e97d2a2049e',
});
const CODE_STEP_REREVIEW_CURRENT = Object.freeze({ ...withMoves(CODE_STEP_REVIEW_CURRENT,
  MOVED_BY_CODE_STEP_REREVIEW.cases), runProfile: MOVED_BY_CODE_STEP_REREVIEW.runProfile,
sessionProfileDigest: MOVED_BY_CODE_STEP_REREVIEW.sessionProfileDigest });
/**
 * The third review of the code step (m33-integration-fixture.js `CODE_STEP_THIRD_REVIEW_VERSIONS`,
 * `CODE_PASS_PROFILE_CODE_STEP_REREVIEW`; 2026-10-14): the values that moved from `CODE_STEP_REREVIEW_CURRENT` — the run
 * profiles alone, through their challenge version (/42) and (session-only) the code pass's member (code-snapshot/5,
 * code-check/5, code-pass/5). No case's request moved: the code step sends nothing a session review sends. Rendered
 * back (`profileBeforeCodeStepThirdReview`), the second review's.
 */
const MOVED_BY_CODE_STEP_THIRD_REVIEW = Object.freeze({
  cases: [{}, {}, {}],
  runProfile: { 'session-only': 'f53d21b00a50a70e1ae7c10a561601a0672dcdcd6e4ec6cc28506d88fdaaf64c',
    combined: '6d5c965ebb2924725df129465bca2e55427f01a33c6394d81b45d43d52696189' },
  sessionProfileDigest: 'f53d21b00a50a70e1ae7c10a561601a0672dcdcd6e4ec6cc28506d88fdaaf64c',
});
const CODE_STEP_THIRD_REVIEW_CURRENT = Object.freeze({ ...withMoves(CODE_STEP_REREVIEW_CURRENT,
  MOVED_BY_CODE_STEP_THIRD_REVIEW.cases), runProfile: MOVED_BY_CODE_STEP_THIRD_REVIEW.runProfile,
sessionProfileDigest: MOVED_BY_CODE_STEP_THIRD_REVIEW.sessionProfileDigest });
/**
 * The fourth review of the code step (m33-integration-fixture.js `CODE_STEP_FOURTH_REVIEW_VERSIONS`,
 * `CODE_PASS_PROFILE_CODE_STEP_THIRD_REVIEW`; 2026-10-14): the values that moved from `CODE_STEP_THIRD_REVIEW_CURRENT` —
 * the session-only run profile alone, through the code pass's member (code-snapshot/6). No case's request moved, and
 * the combined run profile, which holds no code-pass member, did not move. Rendered back
 * (`profileBeforeCodeStepFourthReview`), the third review's.
 */
const MOVED_BY_CODE_STEP_FOURTH_REVIEW = Object.freeze({
  cases: [{}, {}, {}],
  runProfile: { 'session-only': '5e497361b6cdce28971e0c94f2e8fedf4b5615858bc47f9c8ff6043dcc5953db',
    combined: '6d5c965ebb2924725df129465bca2e55427f01a33c6394d81b45d43d52696189' },
  sessionProfileDigest: '5e497361b6cdce28971e0c94f2e8fedf4b5615858bc47f9c8ff6043dcc5953db',
});
const CODE_STEP_FOURTH_REVIEW_CURRENT = Object.freeze({ ...withMoves(CODE_STEP_THIRD_REVIEW_CURRENT,
  MOVED_BY_CODE_STEP_FOURTH_REVIEW.cases), runProfile: MOVED_BY_CODE_STEP_FOURTH_REVIEW.runProfile,
sessionProfileDigest: MOVED_BY_CODE_STEP_FOURTH_REVIEW.sessionProfileDigest });
/**
 * The release review (m33-integration-fixture.js `RELEASE_REVIEW_VERSIONS`, `CODE_PASS_PROFILE_CODE_STEP_FOURTH_REVIEW`;
 * 2026-10-14): the values that moved from `CODE_STEP_FOURTH_REVIEW_CURRENT` — the run profiles alone: the session-only
 * one through the code pass's member (code-snapshot/7: with the home folder as the repository, only the paths the
 * session recorded are read) and both through the prompt version (narrative/35: a session-only window leaves out a
 * project instruction file the session wrote). No case's request moved: none of their sessions wrote one. Rendered back
 * (`profileBeforeReleaseReview`), the fourth review's.
 */
const MOVED_BY_RELEASE_REVIEW = Object.freeze({
  cases: [{}, {}, {}],
  runProfile: { 'session-only': '8f0db5fa71327e487818287c3eadb7f6425cad2187748eef9803a835c29b5179',
    combined: '366c486bf41dc8e9fc42224ba280dec913f74324850251ac6d21c0ec9f464258' },
  sessionProfileDigest: '8f0db5fa71327e487818287c3eadb7f6425cad2187748eef9803a835c29b5179',
});
const RELEASE_REVIEW_CURRENT = Object.freeze({ ...withMoves(CODE_STEP_FOURTH_REVIEW_CURRENT,
  MOVED_BY_RELEASE_REVIEW.cases), runProfile: MOVED_BY_RELEASE_REVIEW.runProfile,
sessionProfileDigest: MOVED_BY_RELEASE_REVIEW.sessionProfileDigest });
/**
 * The second release review (m33-integration-fixture.js `SECOND_RELEASE_REVIEW_VERSIONS`,
 * `CODE_PASS_PROFILE_RELEASE_REVIEW`; 2026-10-15): the values that moved from `RELEASE_REVIEW_CURRENT` — the run profiles
 * alone: the session-only one through the code pass's member (code-snapshot/8: a recording names a harness home only in
 * its recorder's own layout; code-check and code-pass /6: a project instruction file's path compared under the working
 * directory) and both through the prompt version (narrative/36). No case's request moved: none of their sessions wrote
 * such a file. Rendered back (`profileBeforeSecondReleaseReview`), the release review's.
 */
const MOVED_BY_SECOND_RELEASE_REVIEW = Object.freeze({
  cases: [{}, {}, {}],
  runProfile: { 'session-only': '8fa0a7cd5fdecfc04a9653017836699573f4d340ce9968d5790bd5140e90bb2a',
    combined: '8ef54b7c2ce2320cd586091947646272a14f6ed3ab3907054f2a74c199afbb7a' },
  sessionProfileDigest: '8fa0a7cd5fdecfc04a9653017836699573f4d340ce9968d5790bd5140e90bb2a',
});
/** What the code sends now. */
const CURRENT = Object.freeze({ ...withMoves(RELEASE_REVIEW_CURRENT, MOVED_BY_SECOND_RELEASE_REVIEW.cases),
  runProfile: MOVED_BY_SECOND_RELEASE_REVIEW.runProfile,
  sessionProfileDigest: MOVED_BY_SECOND_RELEASE_REVIEW.sessionProfileDigest });
/** A capture whose cases are what the code sends now: a run profile rendered back moves no request. */
const withD71Cases = (capture) => ({ ...capture, cases: CURRENT.cases });

/**
 * The run profile members M35 windowing replaced, as d193257 froze them (the D64 wording's): the byte-budget
 * splitter's `segmentation` and the carry's bounds, and the request bounds before the spec's worst-case window call.
 */
const PRE_WINDOWING = Object.freeze({
  segmentation: { standard: { version: 'sonah.windows/2', sourceByteBudget: 196608 },
    'm33-fast': { version: 'sonah.windows/2', sourceByteBudget: 786432, sourceByteFloor: 196608 },
    'm33-lean': { version: 'sonah.windows/2', sourceByteBudget: 196608 } },
  carry: { version: 'sonah.carry/8', resultsBudget: 49152, statementsMax: 6, statementsBudget: 32768, actionBytes: 512,
    outputBytes: 384, failedOutputBytes: 1536, pathBytes: 256, statementBytes: 8192 },
  maxInputBytes: { standard: 524288, 'm33-fast': 1048576, 'm33-lean': 524288 },
  speedProfile: { 'm33-fast': { windowSourceBytes: 786432, windowSourceFloorBytes: 196608 },
    'm33-lean': { windowSourceBytes: 196608, windowSourceFloorBytes: 196608 } },
});
/** A run profile rendered back to the D64 wording's (`WINDOWING_VERSIONS`, `PRE_WINDOWING`), M36 phase 1's versions
 *  first (`profileBeforeRecordedFacts`). */
const asBeforeWindowing = (profile) => {
  const copy = profileBeforeRecordedFacts(profile);
  const name = copy.speedProfile?.name ?? 'standard';
  if (copy.promptVersion === WINDOWING_VERSIONS.prompt.after) copy.promptVersion = WINDOWING_VERSIONS.prompt.before;
  if (copy.challenge?.version === WINDOWING_VERSIONS.challenge.after) copy.challenge.version = WINDOWING_VERSIONS.challenge.before;
  if (copy.challenge?.dossier === WINDOWING_VERSIONS.dossier.after) copy.challenge.dossier = WINDOWING_VERSIONS.dossier.before;
  if (copy.windowing?.version === WINDOWING_VERSIONS.windows.after) {
    const sessionOnly = copy.reviewScope === 'session-only';
    delete copy.windowing;
    copy.segmentation = structuredClone(PRE_WINDOWING.segmentation[sessionOnly ? name : 'standard']);
    if (sessionOnly) {
      copy.carry = structuredClone(PRE_WINDOWING.carry);
      copy.maxInputBytes = PRE_WINDOWING.maxInputBytes[name];
      copy.challenge.maxInputBytes = PRE_WINDOWING.maxInputBytes[name];
    }
    if (copy.speedProfile) {
      Object.assign(copy.speedProfile, PRE_WINDOWING.speedProfile[name] ?? {});
      copy.speedProfile.maxInputBytes = PRE_WINDOWING.maxInputBytes[name];
    }
  }
  return copy;
};

const modules = { runReview: reviewRun.runReview, planWindowRequests: reviewRun.planWindowRequests };
const digests = { canonicalJson, runProfile: reviewRun.runProfile, sessionProfileDigest: sessionReview.sessionProfileDigest };

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
/** The run profile and its digest, each integration version mapped to `target`'s, then through `back` (older renders). */
const profileBack = (target, back = (profile) => profile) => {
  const runProfile = (...args) => back(profileAs(asBeforeWindowing(reviewRun.runProfile(...args)), target));
  return { canonicalJson, runProfile, sessionProfileDigest: (...args) => sha256(canonicalJson(runProfile('session-only', ...args))) };
};
/** Every text render-back but the outcomes branch's: H3's, G3's (the merged supportedBy sentence first) and M3's. */
const beforeOtherBranches = (mods) => modulesBeforeHedgedClaims(modulesBeforeSupportOrder(modulesBeforeM3(mods)));

test('M33 integration: every other branch rendered back, the default review plans and sends exactly what the outcomes branch did', async () => {
  const before = profileBack(PROFILE_TARGETS.outcomes);
  assert.equal(before.sessionProfileDigest(), AFTER_STATUS_FACT.sessionProfileDigest, 'the profile digest is the run profile\'s');
  // M35 windowing moved every case's windows, so the texts rendered back reproduce no capture before it: the capture
  // below is the record (`MOVED_BY_WINDOWING`); the run profile is still rendered back (`asBeforeWindowing`).
  assert.equal(typeof beforeOtherBranches(modules).planWindowRequests, 'function');
  // M4 and M4's session route moved no case's requests (their profiles moved by the challenge version alone, which
  // `profileAs` maps); H3, M3 and G3 moved requests by their texts alone, rendered back above.
  assert.deepEqual(MOVED_BY_M4.cases, [{}, {}, {}]);
  assert.deepEqual(MOVED_BY_M4_SESSION_BASELINE.cases, [{}, {}, {}]);
  for (const moved of [MOVED_BY_H3, MOVED_BY_M3, MOVED_BY_SUPPORT_ORDER])
    assert.deepEqual(moved.cases.map((c) => Object.keys(c).sort().join(',')),
      ['planned,sentInOrder,sentSorted', 'planned,sentInOrder,sentSorted', 'planned,sentInOrder,sentSorted']);
  // What moved, and only that: every case's narrative and challenge requests, and the run profiles.
  assert.deepEqual(MOVED_BY_INTEGRATION.cases.map((c) => Object.keys(c).sort().join(',')),
    ['planned,sentInOrder,sentSorted', 'planned,sentInOrder,sentSorted', 'planned,sentInOrder,sentSorted']);
});

/** A run profile with the D64 wording's narrative version rendered back to /19 (DISCLOSURE_WORDS_VERSIONS). */
const asBeforeDisclosureWords = (profile) => {
  const copy = asBeforeWindowing(profile);
  if (copy.promptVersion === DISCLOSURE_WORDS_VERSIONS.prompt.after) copy.promptVersion = DISCLOSURE_WORDS_VERSIONS.prompt.before;
  return copy;
};

test('D64 wording: every case\'s narrative requests moved by the two proposer sentences alone, the run profiles by their prompt version; rendered back they are stable ids\'', async () => {
  const runProfile = (...args) => asBeforeDisclosureWords(reviewRun.runProfile(...args));
  // M35 windowing: the texts rendered back reproduce no capture before it (every window moved); the capture now is
  // MOVED_BY_WINDOWING's, and the run profiles render back through it to the D64 wording's and then stable ids'.
  assert.equal(typeof modulesBeforeDisclosureWords(modules).runReview, 'function');
  const now = await captureStandard(modules, digests);
  assert.deepEqual(now, CURRENT);
  // The second release review: rendered back (`profileBeforeSecondReleaseReview`), every run profile is the release
  // review's; no case moved, and the combined profile moved by its prompt version alone.
  assert.deepEqual(MOVED_BY_SECOND_RELEASE_REVIEW.cases, [{}, {}, {}]);
  assert.equal(SECOND_RELEASE_REVIEW_VERSIONS.prompt.after, reviewRun.runProfile('combined').promptVersion);
  const secondReleaseBack = (...args) => profileBeforeSecondReleaseReview(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modules, { canonicalJson, runProfile: secondReleaseBack,
    sessionProfileDigest: (...args) => sha256(canonicalJson(secondReleaseBack('session-only', ...args))) }),
  RELEASE_REVIEW_CURRENT);
  // The release review: rendered back (`profileBeforeReleaseReview`, which applies `profileBeforeSecondReleaseReview`
  // first), every run profile is the fourth review's; no case moved, and the combined profile moved by its prompt
  // version alone.
  assert.deepEqual(MOVED_BY_RELEASE_REVIEW.cases, [{}, {}, {}]);
  assert.equal(RELEASE_REVIEW_VERSIONS.prompt.after,
    profileBeforeSecondReleaseReview(reviewRun.runProfile('combined')).promptVersion);
  const releaseBack = (...args) => profileBeforeReleaseReview(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modules, { canonicalJson, runProfile: releaseBack,
    sessionProfileDigest: (...args) => sha256(canonicalJson(releaseBack('session-only', ...args))) }),
  CODE_STEP_FOURTH_REVIEW_CURRENT);
  // The fourth review of the code step: rendered back (`profileBeforeCodeStepFourthReview`, which applies
  // `profileBeforeReleaseReview` first), every run profile is the third review's; no case moved, and the combined
  // profile did not move.
  assert.deepEqual(MOVED_BY_CODE_STEP_FOURTH_REVIEW.cases, [{}, {}, {}]);
  assert.equal(MOVED_BY_CODE_STEP_FOURTH_REVIEW.runProfile.combined, MOVED_BY_CODE_STEP_THIRD_REVIEW.runProfile.combined);
  const stepFourthBack = (...args) => profileBeforeCodeStepFourthReview(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modules, { canonicalJson, runProfile: stepFourthBack,
    sessionProfileDigest: (...args) => sha256(canonicalJson(stepFourthBack('session-only', ...args))) }),
  CODE_STEP_THIRD_REVIEW_CURRENT);
  // The third review of the code step: rendered back (`profileBeforeCodeStepThirdReview`, which applies
  // `profileBeforeCodeStepFourthReview` first), every run profile is the second review's; no case moved.
  assert.deepEqual(MOVED_BY_CODE_STEP_THIRD_REVIEW.cases, [{}, {}, {}]);
  const stepThirdBack = (...args) => profileBeforeCodeStepThirdReview(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modules, { canonicalJson, runProfile: stepThirdBack,
    sessionProfileDigest: (...args) => sha256(canonicalJson(stepThirdBack('session-only', ...args))) }),
  CODE_STEP_REREVIEW_CURRENT);
  // The second review of the code step: rendered back (`profileBeforeCodeStepRereview`, which applies
  // `profileBeforeCodeStepThirdReview` first), every run profile is the review of the code step's; no case moved.
  assert.deepEqual(MOVED_BY_CODE_STEP_REREVIEW.cases, [{}, {}, {}]);
  const stepRereviewBack = (...args) => profileBeforeCodeStepRereview(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modules, { canonicalJson, runProfile: stepRereviewBack,
    sessionProfileDigest: (...args) => sha256(canonicalJson(stepRereviewBack('session-only', ...args))) }),
  CODE_STEP_REVIEW_CURRENT);
  // The review of the code step: rendered back (`profileBeforeCodeStepReview`, which applies
  // `profileBeforeCodeStepRereview` first), every run profile is the code step's; no case moved.
  assert.deepEqual(MOVED_BY_CODE_STEP_REVIEW.cases, [{}, {}, {}]);
  const stepReviewBack = (...args) => profileBeforeCodeStepReview(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modules, { canonicalJson, runProfile: stepReviewBack,
    sessionProfileDigest: (...args) => sha256(canonicalJson(stepReviewBack('session-only', ...args))) }), CODE_STEP_CURRENT);
  // The code step: rendered back (`profileBeforeCodeStep`, which applies `profileBeforeCodeStepReview` first), every run
  // profile is the D87 review's; no case moved.
  assert.deepEqual(MOVED_BY_CODE_STEP.cases, [{}, {}, {}]);
  const stepBack = (...args) => profileBeforeCodeStep(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modules, { canonicalJson, runProfile: stepBack,
    sessionProfileDigest: (...args) => sha256(canonicalJson(stepBack('session-only', ...args))) }), CODE_PASS_REVIEW_CURRENT);
  // The D87 review: rendered back (`profileBeforeCodePassReview`, which applies `profileBeforeCodeStep` first), every
  // run profile is D87's; no case moved.
  assert.deepEqual(MOVED_BY_CODE_PASS_REVIEW.cases, [{}, {}, {}]);
  const passReviewBack = (...args) => profileBeforeCodePassReview(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modules, { canonicalJson, runProfile: passReviewBack,
    sessionProfileDigest: (...args) => sha256(canonicalJson(passReviewBack('session-only', ...args))) }), CODE_PASS_CURRENT);
  // D87: rendered back (`profileBeforeCodePass`), every run profile is the fix review's; no case moved.
  assert.deepEqual(MOVED_BY_CODE_PASS.cases, [{}, {}, {}]);
  const passBack = (...args) => profileBeforeCodePass(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modules, { canonicalJson, runProfile: passBack,
    sessionProfileDigest: (...args) => sha256(canonicalJson(passBack('session-only', ...args))) }), FIX_REVIEW_CURRENT);
  // The fix review: rendered back (`modulesBeforeFixReview`, `profileBeforeFixReview`, which applies
  // `profileBeforeCodePass` first), every case and run profile is W3's.
  const reviewFixBack = (...args) => profileBeforeFixReview(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modulesBeforeFixReview(modules), { canonicalJson, runProfile: reviewFixBack,
    sessionProfileDigest: (...args) => sha256(canonicalJson(reviewFixBack('session-only', ...args))) }), W3_CURRENT);
  // W3: rendered back (`modulesBeforeW3`, `profileBeforeW3`), every case and run profile is W2's.
  const w3Back = (...args) => profileBeforeW3(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modulesBeforeW3(modules), { canonicalJson, runProfile: w3Back,
    sessionProfileDigest: (...args) => sha256(canonicalJson(w3Back('session-only', ...args))) }), W2_CURRENT);
  // W2: rendered back (`modulesBeforeW2`, `profileBeforeW2`), every case and run profile is W1's.
  const w2Back = (...args) => profileBeforeW2(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modulesBeforeW2(modules), { canonicalJson, runProfile: w2Back,
    sessionProfileDigest: (...args) => sha256(canonicalJson(w2Back('session-only', ...args))) }), W1_CURRENT);
  // W1: rendered back (`modulesBeforeW1`, `profileBeforeW1`), every case and run profile is the asks fixes'.
  const w1Back = (...args) => profileBeforeW1(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modulesBeforeW1(modules), { canonicalJson, runProfile: w1Back,
    sessionProfileDigest: (...args) => sha256(canonicalJson(w1Back('session-only', ...args))) }), ASKS_FIXES_CURRENT);
  // D71 (S2): rendered back (`profileBeforeD71Brief`), the run profiles are the D69 review's; every case's requests are
  // D71's (MOVED_BY_D71_BRIEF), so each render-back below holds for the run profiles with D71's cases (`withD71Cases`).
  const briefBack = (...args) => profileBeforeD71Brief(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modules, { canonicalJson, runProfile: briefBack,
    sessionProfileDigest: (...args) => sha256(canonicalJson(briefBack('session-only', ...args))) }),
  withD71Cases(D69_REVIEW_CURRENT));
  // The D69 review: rendered back (`profileBeforeD69Review`), every case is D69's — only the run profiles moved, by
  // their versions.
  const reviewBack = (...args) => profileBeforeD69Review(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modules, { canonicalJson, runProfile: reviewBack,
    sessionProfileDigest: (...args) => sha256(canonicalJson(reviewBack('session-only', ...args))) }), withD71Cases(D69_CURRENT));
  // D69: rendered back (`profileBeforeD69`), every case is M36 phase 3's — only the run profiles moved, by their versions.
  const d69Back = (...args) => profileBeforeD69(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modules, { canonicalJson, runProfile: d69Back,
    sessionProfileDigest: (...args) => sha256(canonicalJson(d69Back('session-only', ...args))) }), withD71Cases(M36_CURRENT));
  // M36 phase 3: rendered back (`modulesBeforeM36Conversation`, `profileBeforeConversation`), every case is phase 2's,
  // byte for byte — only the narrative's two texts and the run profiles moved.
  // D71 (S2): the narrative's texts are the brief's now, so nothing renders a request back: only the run profiles.
  const conversationBack = (...args) => profileBeforeConversation(reviewRun.runProfile(...args));
  assert.deepEqual(await captureStandard(modules, { canonicalJson, runProfile: conversationBack,
    sessionProfileDigest: (...args) => sha256(canonicalJson(conversationBack('session-only', ...args))) }),
  withD71Cases(FORMAT_CURRENT));
  for (const scope of ['session-only', 'combined']) {
    // M36 phase 3 moved it once more (CONVERSATION_VERSIONS: prompt); rendered back (`profileBeforeConversation`) it is
    // phase 2's, byte for byte.
    assert.equal(D69_VERSIONS.prompt.before, CONVERSATION_VERSIONS.prompt.after);
    assert.equal(D69_REVIEW_VERSIONS.prompt.before, D69_VERSIONS.prompt.after);
    // D71 (S2) moved it once more (D71_BRIEF_VERSIONS: prompt); rendered back (`profileBeforeD71Brief`), the D69 review's.
    assert.equal(D71_BRIEF_VERSIONS.prompt.before, D69_REVIEW_VERSIONS.prompt.after);
    // D71 (S3) moved it once more (D71_CHANNELS_VERSIONS: prompt); rendered back (`profileBeforeD71Channels`), S2's.
    assert.equal(D71_CHANNELS_VERSIONS.prompt.before, D71_BRIEF_VERSIONS.prompt.after);
    // S6 moved it once more (D71_FIX_VERSIONS: prompt); rendered back (`profileBeforeD71Fix`), S3's.
    assert.equal(D71_FIX_VERSIONS.prompt.before, D71_CHANNELS_VERSIONS.prompt.after);
    // S7 moved it once more (S7_VERSIONS: prompt); rendered back (`profileBeforeS7`), S6's.
    assert.equal(S7_VERSIONS.prompt.before, D71_FIX_VERSIONS.prompt.after);
    // The D80 integration moved it once more (D80_VERSIONS: prompt); rendered back (`profileBeforeD80`), S7's.
    assert.equal(D80_VERSIONS.prompt.before, S7_VERSIONS.prompt.after);
    // The asks fixes moved it once more (ASKS_FIXES_VERSIONS: prompt); rendered back (`profileBeforeAsksFixes`),
    // the column fix's.
    assert.equal(ASKS_FIXES_VERSIONS.prompt.before, D80_VERSIONS.prompt.after);
    // W1 A moved it once more (W1_VERSIONS: prompt); rendered back (`profileBeforeW1`), the asks fixes'.
    assert.equal(W1_VERSIONS.prompt.before, ASKS_FIXES_VERSIONS.prompt.after);
    // The release review moved it once more (RELEASE_REVIEW_VERSIONS: prompt); rendered back
    // (`profileBeforeReleaseReview`), W1's.
    assert.equal(RELEASE_REVIEW_VERSIONS.prompt.before, W1_VERSIONS.prompt.after);
    // The second release review moved it once more (SECOND_RELEASE_REVIEW_VERSIONS: prompt); rendered back
    // (`profileBeforeSecondReleaseReview`), the release review's.
    assert.equal(SECOND_RELEASE_REVIEW_VERSIONS.prompt.before, RELEASE_REVIEW_VERSIONS.prompt.after);
    assert.equal(reviewRun.runProfile(scope).promptVersion, SECOND_RELEASE_REVIEW_VERSIONS.prompt.after, scope);
    assert.equal(profileBeforeSecondReleaseReview(reviewRun.runProfile(scope)).promptVersion,
      RELEASE_REVIEW_VERSIONS.prompt.after, scope);
    assert.equal(profileBeforeReleaseReview(reviewRun.runProfile(scope)).promptVersion, W1_VERSIONS.prompt.after, scope);
    assert.equal(profileBeforeConversation(reviewRun.runProfile(scope)).promptVersion, FORMAT_VERSIONS.prompt.after, scope);
    // The column fix moved the challenge version (both scopes) and the session agent and contract (session-only);
    // rendered back (`profileBeforeFixColumn`), the D80 integration's.
    assert.equal(FIX_COLUMN_VERSIONS.challenge.before, S7_VERSIONS.challenge.after);
    assert.equal(FIX_COLUMN_VERSIONS.agent.before, S7_VERSIONS.agent.after);
    // W2 moved the agent and challenge versions and the session contract; rendered back (`profileBeforeW2`), W1's.
    assert.equal(W2_VERSIONS.challenge.before, W1_VERSIONS.challenge.after);
    assert.equal(W2_VERSIONS.agent.before, W1_VERSIONS.agent.after);
    // W3 F1(b) moved the challenge version; rendered back (`profileBeforeW3`), W2's.
    assert.equal(W3_VERSIONS.challenge.before, W2_VERSIONS.challenge.after);
    // The fix review moved the challenge version; rendered back (`profileBeforeFixReview`), W3's.
    assert.equal(FIX_REVIEW_VERSIONS.challenge.before, W3_VERSIONS.challenge.after);
    // D87 moved the challenge version once more and (session-only) added the code pass's member; rendered back
    // (`profileBeforeCodePass`), the fix review's.
    assert.equal(CODE_PASS_VERSIONS.challenge.before, FIX_REVIEW_VERSIONS.challenge.after);
    // The D87 review moved the session-only profile's code-pass challenge rule; rendered back
    // (`profileBeforeCodePassReview`), D87's.
    assert.deepEqual(profileBeforeCodeStep(reviewRun.runProfile('session-only')).codePass.challenge,
      CODE_PASS_REVIEW_CHALLENGE.after);
    // The code step moved the challenge version once more and the session-only profile's code-pass member; rendered
    // back (`profileBeforeCodeStep`), the D87 review's.
    assert.equal(CODE_STEP_VERSIONS.challenge.before, CODE_PASS_VERSIONS.challenge.after);
    // The review of the code step moved the challenge version once more and the session-only profile's code-pass
    // member; rendered back (`profileBeforeCodeStepReview`), the code step's.
    assert.equal(CODE_STEP_REVIEW_VERSIONS.challenge.before, CODE_STEP_VERSIONS.challenge.after);
    // The second review of the code step moved the challenge version once more and the session-only profile's
    // code-pass member; rendered back (`profileBeforeCodeStepRereview`), the review of the code step's.
    assert.equal(CODE_STEP_REREVIEW_VERSIONS.challenge.before, CODE_STEP_REVIEW_VERSIONS.challenge.after);
    // The third review of the code step moved the challenge version once more and the session-only profile's
    // code-pass member; rendered back (`profileBeforeCodeStepThirdReview`), the second review's.
    assert.equal(CODE_STEP_THIRD_REVIEW_VERSIONS.challenge.before, CODE_STEP_REREVIEW_VERSIONS.challenge.after);
    // The fourth review of the code step moved the session-only profile's code-pass member (code-snapshot/6); rendered
    // back (`profileBeforeCodeStepFourthReview`), the third review's.
    assert.equal(CODE_STEP_FOURTH_REVIEW_VERSIONS.snapshot.before, 'sonah.code-snapshot/5');
    // The release review moved the session-only profile's code-pass member (code-snapshot/7) and every profile's
    // prompt version (narrative/35); rendered back (`profileBeforeReleaseReview`), the fourth review's.
    assert.equal(RELEASE_REVIEW_VERSIONS.snapshot.before, CODE_STEP_FOURTH_REVIEW_VERSIONS.snapshot.after);
    // The second release review moved the session-only profile's code-pass member (code-snapshot/8, code-check and
    // code-pass /6) and every profile's prompt version (narrative/36); rendered back
    // (`profileBeforeSecondReleaseReview`), the release review's.
    assert.equal(SECOND_RELEASE_REVIEW_VERSIONS.snapshot.before, RELEASE_REVIEW_VERSIONS.snapshot.after);
    assert.equal(sha256(canonicalJson(reviewRun.runProfile(scope))), MOVED_BY_SECOND_RELEASE_REVIEW.runProfile[scope],
      scope);
    assert.equal(sha256(canonicalJson(profileBeforeSecondReleaseReview(reviewRun.runProfile(scope)))),
      MOVED_BY_RELEASE_REVIEW.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeReleaseReview(reviewRun.runProfile(scope)))),
      MOVED_BY_CODE_STEP_FOURTH_REVIEW.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeCodeStepFourthReview(reviewRun.runProfile(scope)))),
      MOVED_BY_CODE_STEP_THIRD_REVIEW.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeCodeStepThirdReview(reviewRun.runProfile(scope)))),
      MOVED_BY_CODE_STEP_REREVIEW.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeCodeStepRereview(reviewRun.runProfile(scope)))),
      MOVED_BY_CODE_STEP_REVIEW.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeCodeStepReview(reviewRun.runProfile(scope)))),
      MOVED_BY_CODE_STEP.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeCodeStep(reviewRun.runProfile(scope)))),
      MOVED_BY_CODE_PASS_REVIEW.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeCodePassReview(reviewRun.runProfile(scope)))),
      MOVED_BY_CODE_PASS.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeCodePass(reviewRun.runProfile(scope)))),
      MOVED_BY_FIX_REVIEW.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeFixReview(reviewRun.runProfile(scope)))), MOVED_BY_W3.runProfile[scope],
      scope);
    assert.equal(sha256(canonicalJson(profileBeforeW3(reviewRun.runProfile(scope)))), MOVED_BY_W2.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeW2(reviewRun.runProfile(scope)))), MOVED_BY_W1.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeW1(reviewRun.runProfile(scope)))),
      MOVED_BY_ASKS_FIXES.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeAsksFixes(reviewRun.runProfile(scope)))),
      MOVED_BY_FIX_COLUMN.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeFixColumn(reviewRun.runProfile(scope)))),
      MOVED_BY_D80.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeD80(reviewRun.runProfile(scope)))), MOVED_BY_S7.runProfile[scope],
      scope);
    // S7 moved it once more (S7_VERSIONS); rendered back (`profileBeforeS7`), S6's.
    assert.equal(sha256(canonicalJson(profileBeforeS7(reviewRun.runProfile(scope)))), MOVED_BY_D71_FIX.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeD71Fix(reviewRun.runProfile(scope)))), MOVED_BY_D71_CHANNELS.runProfile[scope],
      scope);
    assert.equal(sha256(canonicalJson(profileBeforeD71Channels(reviewRun.runProfile(scope)))), MOVED_BY_D71_BRIEF.runProfile[scope],
      scope);
    assert.equal(sha256(canonicalJson(profileBeforeD71Brief(reviewRun.runProfile(scope)))), MOVED_BY_D69_REVIEW.runProfile[scope],
      scope);
    assert.equal(sha256(canonicalJson(profileBeforeD69Review(reviewRun.runProfile(scope)))), MOVED_BY_D69.runProfile[scope],
      scope);
    assert.equal(sha256(canonicalJson(profileBeforeD69(reviewRun.runProfile(scope)))), MOVED_BY_M36_CONVERSATION.runProfile[scope],
      scope);
    assert.equal(sha256(canonicalJson(profileBeforeConversation(reviewRun.runProfile(scope)))),
      MOVED_BY_M36_FORMAT.runProfile[scope], scope);
    assert.equal(profileBeforeFormat(reviewRun.runProfile(scope)).promptVersion, RECORDED_FACTS_VERSIONS.prompt.after, scope);
    assert.equal(profileBeforeRecordedFacts(reviewRun.runProfile(scope)).promptVersion, WINDOWING_VERSIONS.prompt.after, scope);
    assert.equal(asBeforeWindowing(reviewRun.runProfile(scope)).promptVersion, DISCLOSURE_WORDS_VERSIONS.prompt.after, scope);
    assert.equal(sha256(canonicalJson(profileBeforeFormat(reviewRun.runProfile(scope)))),
      MOVED_BY_RECORDED_FACTS.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(profileBeforeRecordedFacts(reviewRun.runProfile(scope)))),
      MOVED_BY_WINDOWING.runProfile[scope], scope);
    // M36 phase 1 moved no case of these hand-built sessions: only the run profiles, by their versions.
    assert.deepEqual(MOVED_BY_RECORDED_FACTS.cases, [{}, {}, {}]);
    assert.equal(sha256(canonicalJson(asBeforeWindowing(reviewRun.runProfile(scope)))),
      MOVED_BY_DISCLOSURE_WORDS.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(runProfile(scope))), MOVED_BY_STABLE_IDS.runProfile[scope], scope);
  }
  // What moved, and only that: every case's narrative requests, and the run profiles.
  assert.deepEqual(MOVED_BY_DISCLOSURE_WORDS.cases.map((c) => Object.keys(c).sort().join(',')),
    ['planned,sentInOrder,sentSorted', 'planned,sentInOrder,sentSorted', 'planned,sentInOrder,sentSorted']);
  assert.equal(DISCLOSURE_WORDS_VERSIONS.prompt.before, STABLE_IDS_VERSIONS.prompt.after);
});

/** A run profile with stable ids' narrative, challenge and carry versions rendered back to /18, /16 and /7
 *  (STABLE_IDS_VERSIONS), the D64 wording's narrative version first (`asBeforeDisclosureWords`). */
const asBeforeStableIds = (profile) => {
  const copy = asBeforeDisclosureWords(profile);
  if (copy.promptVersion === STABLE_IDS_VERSIONS.prompt.after) copy.promptVersion = STABLE_IDS_VERSIONS.prompt.before;
  if (copy.challenge?.version === STABLE_IDS_VERSIONS.challenge.after)
    copy.challenge.version = STABLE_IDS_VERSIONS.challenge.before;
  if (copy.carry?.version === STABLE_IDS_VERSIONS.carry.after) copy.carry.version = STABLE_IDS_VERSIONS.carry.before;
  return copy;
};

test('C-01 stable event ids: the run profiles moved by their narrative, challenge and carry versions alone; rendered back they are the disclosure narrowing\'s', () => {
  // As /19 froze them: the D64 wording's narrative version rendered back first (`asBeforeDisclosureWords`).
  const runProfile = (scope) => asBeforeDisclosureWords(reviewRun.runProfile(scope));
  for (const scope of ['session-only', 'combined']) {
    assert.equal(runProfile(scope).promptVersion, STABLE_IDS_VERSIONS.prompt.after, scope);
    assert.equal(runProfile(scope).challenge.version, STABLE_IDS_VERSIONS.challenge.after, scope);
    assert.equal(runProfile(scope).carry?.version, scope === 'session-only' ? STABLE_IDS_VERSIONS.carry.after
      : undefined, scope);
    assert.equal(sha256(canonicalJson(runProfile(scope))), MOVED_BY_STABLE_IDS.runProfile[scope], scope);
    assert.equal(sha256(canonicalJson(asBeforeStableIds(reviewRun.runProfile(scope)))),
      MOVED_BY_DISCLOSURE_NARROW.runProfile[scope], scope);
  }
});

test('Disclosure narrowed: the run profiles moved by their challenge version alone; rendered back to /15 they are the labels merge\'s', () => {
  const { before, after } = DISCLOSURE_NARROW_VERSIONS.challenge;
  const asBefore = (profile) => {
    const copy = asBeforeStableIds(profile);
    if (copy.challenge.version === after) copy.challenge.version = before;
    return copy;
  };
  for (const scope of ['session-only', 'combined']) {
    assert.equal(asBeforeStableIds(reviewRun.runProfile(scope)).challenge.version, after, scope);
    assert.equal(sha256(canonicalJson(asBefore(reviewRun.runProfile(scope)))), MOVED_BY_LABELS_MERGE.runProfile[scope], scope);
  }
});

test('Status fact: rendered back as /14, /11 and carry/5 sent it, the default review plans and sends exactly what H5 did', async () => {
  // Every other branch's texts are rendered back first (`beforeOtherBranches`), and the versions mapped to the outcomes
  // branch's (`profileAs`); then the status fact's.
  const before = profileBack(PROFILE_TARGETS.outcomes, profileBeforeStatusFact);
  assert.equal(before.sessionProfileDigest(), BEFORE_STATUS_FACT.sessionProfileDigest, 'the profile digest is the run profile\'s');
  // M35 windowing: the texts rendered back reproduce no capture before it (every window moved); BEFORE_STATUS_FACT is
  // the record.
  assert.equal(typeof modulesBeforeStatusFact(beforeOtherBranches(modules)).runReview, 'function');
  // What moved, and only that: every case's narrative and challenge requests, and the run profiles.
  assert.deepEqual(MOVED_BY_STATUS_FACT.cases.map((c) => Object.keys(c).sort().join(',')),
    ['planned,sentInOrder,sentSorted', 'planned,sentInOrder,sentSorted', 'planned,sentInOrder,sentSorted']);
});

test('M33 H repair: rendered back as /12 and /9 sent it, the default review plans and sends exactly what M33 C2 did', async () => {
  // Every branch's texts are rendered back first (H3's, G3's and M3's, then the status fact's; G3's and M3's again inside
  // M33 N's, a no-op), the versions mapped to the outcomes branch's and back (/15 → /14, /12 → /11, carry/6 → carry/5 →
  // carry/4), then M33 N's (/14 → /13, /11 → /10), then M33 H's.
  const before = profileBack(PROFILE_TARGETS.outcomes, (profile) => profileBeforeRelayRule(profileBeforeForbiddenEdit(
    profileBeforeCarry5(profileBeforeStatusFact(profile)))));
  const back = modulesBeforeRelayRule(modulesBeforeForbiddenEdit(modulesBeforeStatusFact(beforeOtherBranches(modules))));
  assert.equal(before.sessionProfileDigest(), BEFORE_M33_H.sessionProfileDigest, 'the profile digest is the run profile\'s');
  assert.equal(before.sessionProfileDigest('standard'), BEFORE_M33_H.sessionProfileDigest, 'standard named is the default');
  // M35 windowing: the texts rendered back (`back`) reproduce no capture before it (every window moved);
  // withMoves(BEFORE_M33_H, MOVED_BY_H5.n12) is the record.
  assert.equal(typeof back.runReview, 'function');
});

test('M33 N: rendered back as /13 and /10 sent it, the default review plans and sends exactly what M33 H did', async () => {
  const before = profileBack(PROFILE_TARGETS.outcomes, (profile) => profileBeforeForbiddenEdit(profileBeforeCarry5(
    profileBeforeStatusFact(profile))));
  assert.equal(before.sessionProfileDigest(), BASE.sessionProfileDigest, 'the profile digest is the run profile\'s');
  // M35 windowing: the texts rendered back reproduce no capture before it (every window moved);
  // withMoves(BASE, MOVED_BY_H5.n13) is the record.
  assert.equal(typeof modulesBeforeForbiddenEdit(modulesBeforeStatusFact(beforeOtherBranches(modules))).runReview, 'function');
  // What moved, and only that: every case's narrative requests and the run profiles.
  assert.deepEqual(MOVED_BY_M33_N.cases.map((c) => Object.keys(c).sort().join(',')),
    ['planned,sentInOrder,sentSorted', 'planned,sentInOrder,sentSorted', 'planned,sentInOrder,sentSorted']);
});

test('M33 J the default review plans and sends exactly what a2bc39d did — but for the bytes M33 C, M33 X, M33 C2 and M33 H moved', async () => {
  assert.deepEqual(await captureStandard(modules, digests), CURRENT);
  // Every other value is a2bc39d's: the windows, the requests sent, their labels and order, the failures — but for
  // what M35 windowing moved (MOVED_BY_WINDOWING: the `large` case's windows, calls, labels and failure).
  for (const [at, c] of BASE_A2BC39D.cases.entries())
    for (const field of ['name', 'windows', 'sentCount', 'labels', 'windowFailures'])
      if (!Object.hasOwn(MOVED_BY_WINDOWING.cases[at], field)) assert.equal(CURRENT.cases[at][field], c[field]);
  assert.deepEqual(MOVED_BY_WINDOWING.cases.map((c) => Object.keys(c).sort().join(',')), [
    'labels,planned,sentCount,sentInOrder,sentSorted,windowFailures,windows', 'planned,sentInOrder,sentSorted',
    'planned,sentInOrder,sentSorted']);
  // M33 X moved only the cases whose windows carry something ("large" and, under sonah.carry/4, "lanes"); "turn" is M33 C's.
  assert.deepEqual(MOVED_BY_M33_X.cases.map((c) => Object.keys(c).length > 0), [true, false, true]);
  // M33 C2 moved only challenge requests, of the cases holding a claim-class item ("large", "turn"): never a narrative one.
  assert.deepEqual(MOVED_BY_M33_C2.cases.map((c) => Object.keys(c).sort().join(',')),
    ['sentInOrder,sentSorted', 'sentInOrder,sentSorted', '']);
  // M33 H's repair moved every case's narrative and challenge requests, and nothing else of any case.
  assert.deepEqual(MOVED_BY_M33_H.cases.map((c) => Object.keys(c).sort().join(',')),
    ['planned,sentInOrder,sentSorted', 'planned,sentInOrder,sentSorted', 'planned,sentInOrder,sentSorted']);
});

test('M33 J naming the standard profile is the default, byte for byte', async () => {
  assert.equal(typeof profiles.reviewSpeedProfile, 'function', 'review-profiles.js exports reviewSpeedProfile');
  assert.deepEqual(await captureStandard(modules, digests, { speedProfile: 'standard' }, ['standard']), CURRENT);
});

test('M33 J the profiles are frozen literals; standard is today\'s constants', () => {
  const { REVIEW_SPEED_PROFILES, REVIEW_SPEED_PROFILE_NAMES, CHALLENGE_TIERS, reviewSpeedProfile } = profiles;
  assert.deepEqual(REVIEW_SPEED_PROFILE_NAMES, ['standard', 'm33-fast', 'm33-lean']);
  assert.deepEqual(CHALLENGE_TIERS, ['uniform', 'tiered']);
  // M35 windowing: every profile's windows are the spec's (no window source budget or re-cut floor) and its request
  // bound the spec's worst-case window call.
  assert.deepEqual(REVIEW_SPEED_PROFILES, {
    standard: { name: 'standard', maxInputBytes: WINDOW_REQUEST_MAX_BYTES,
      windowConcurrency: 3, maxCallsInFlight: 6, challenge: 'uniform' },
    'm33-fast': { name: 'm33-fast', maxInputBytes: WINDOW_REQUEST_MAX_BYTES,
      windowConcurrency: 12, maxCallsInFlight: 12, challenge: 'tiered' },
    // M33 K: m33-fast's lanes and tiers, a dossier for the single-pass run.
    'm33-lean': { name: 'm33-lean', maxInputBytes: WINDOW_REQUEST_MAX_BYTES,
      windowConcurrency: 12, maxCallsInFlight: 12, challenge: 'tiered', singlePassEvidence: 'dossier' },
  });
  const frozen = (value) => value === null || typeof value !== 'object'
    || (Object.isFrozen(value) && Object.values(value).every(frozen));
  for (const value of [REVIEW_SPEED_PROFILES, REVIEW_SPEED_PROFILE_NAMES, CHALLENGE_TIERS]) assert.ok(frozen(value));
  const standard = reviewSpeedProfile('standard');
  assert.equal(standard, REVIEW_SPEED_PROFILES.standard);
  assert.equal(reviewSpeedProfile(), standard, 'standard is the default');
  assert.equal(WINDOW_REQUEST_MAX_BYTES, 1_620_000, 'the spec\'s worst-case call: 450k tokens of 3.6 bytes');
  // The combined scope keeps its own bound (D82 step 10: the PR route that used it is removed; B5 P14).
  assert.equal(CHALLENGE_PROFILE.maxInputBytes, MAX_REVIEW_INPUT_BYTES);
  assert.equal(standard.windowConcurrency, reviewRun.WINDOW_CONCURRENCY);
  assert.equal(standard.maxCallsInFlight, sessionReview.MAX_CALLS_IN_FLIGHT);
  assert.equal(CHALLENGE_PROFILE.passes, 3);
  assert.equal(CHALLENGE_PROFILE.requiredSurvivals, 2);
  for (const unknown of ['fast', 'M33-FAST', '', null, 7, {}]) assert.throws(() => reviewSpeedProfile(unknown), RangeError);
});

test('M33 J the fast run profile differs from standard, names the profile and binds its values', () => {
  const standard = reviewRun.runProfile('session-only');
  const fast = reviewRun.runProfile('session-only', 'm33-fast');
  // M35 windowing: the windowing member in place of `segmentation` and the carry bounds, in every profile alike.
  // M36 phase 3 (D68 Q): and a session-only review's evidence requests' bounds.
  // D87: and the code pass's member, in every profile alike.
  assert.deepEqual(Object.keys(standard).sort(), ['challenge', 'codePass', 'evidenceRequests', 'judgeFailureCodes',
    'maxInputBytes', 'narrativeSchema', 'promptVersion', 'proposalReasks', 'reviewAgent', 'reviewScope',
    'windowIncompleteReasons', 'windowing'],
  'the standard profile is today\'s object, the windowing in place of the segmentation and the carry');
  assert.deepEqual(fast.evidenceRequests, standard.evidenceRequests);
  assert.deepEqual(fast.codePass, standard.codePass);
  assert.deepEqual(fast.windowing, standard.windowing);
  assert.deepEqual(standard.windowing, WINDOWING_PROFILE);
  assert.equal(canonicalJson(reviewRun.runProfile('session-only', 'standard')), canonicalJson(standard));
  assert.notEqual(canonicalJson(fast), canonicalJson(standard));
  assert.deepEqual(fast.speedProfile, profiles.REVIEW_SPEED_PROFILES['m33-fast']);
  assert.equal(fast.maxInputBytes, WINDOW_REQUEST_MAX_BYTES);
  assert.equal(fast.challenge.maxInputBytes, WINDOW_REQUEST_MAX_BYTES);
  assert.deepEqual(fast.challengeTiers, { decide: { passes: 3, requiredSurvivals: 2 }, single: { passes: 1, requiredSurvivals: 1 } });
  const frozen = (value) => value === null || typeof value !== 'object'
    || (Object.isFrozen(value) && Object.values(value).every(frozen));
  assert.ok(frozen(fast));
  assert.equal(canonicalJson(reviewRun.runProfile('session-only', 'm33-fast')), canonicalJson(fast), 'the same every time');
  assert.throws(() => reviewRun.runProfile('combined', 'm33-fast'), RangeError, 'm33-fast is a session-only profile');
  assert.throws(() => reviewRun.runProfile('session-only', 'SYNTHETIC_PROFILE'), RangeError);
  // The window checkpoints of the two profiles never share a key.
  assert.equal(sessionReview.sessionProfileDigest('standard'), CURRENT.sessionProfileDigest);
  assert.notEqual(sessionReview.sessionProfileDigest('m33-fast'), CURRENT.sessionProfileDigest);
  assert.match(sessionReview.sessionProfileDigest('m33-fast'), /^[a-f0-9]{64}$/);
});
