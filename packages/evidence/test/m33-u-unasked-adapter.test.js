// OWNER DECISION B (2026-10-01; amends D59, C-02, C-06): the canonical session carries the human's in-turn words as
// human instructions where they were recorded, and names the ask every instruction gap is about.
//
//   - A queued prompt and an AskUserQuestion answer (slicer `interjections`) are instruction events `I<turn>-<n>` (n
//     counts them within the turn, in recorded order), authority human, placed by their recorded row exactly as
//     commentary is: after every action recorded before the row, before every action recorded after it, and among the
//     slot's commentary by row. A queued one says so (`queued: true`); an answer names its call (`answerTo`). Neither
//     renumbers this session's commentary.
//   - The instructions-channel `unsupported_message` the slicer still counts for ask-only readers is declared net of
//     the queued prompts read here; an answer read here is no unresolved answer.
//   - The capped, stripped and recorder-shortened ask gaps name their asks (`I<turn>`, `I<turn>-<n>`), as the
//     redaction-withheld gap always did, each counting exactly the events it names.
//   - A session with neither shape and no such gap is byte-identical, and so is every narrative request it makes.
//
// Every row is synthetic (m33-u-unasked-fixture.js). No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { beforeForbiddenEdit as beforeForbiddenEditOnly } from './m33-n-forbidden-edit-fixture.js';
import { beforeStatusFact, sessionBeforeStatusFact } from './status-fact-fixture.js';
import { beforeHedgedClaims } from './h3-hedged-claims-fixture.js';
import { claudeRows, codexRows, load, sessionDigest, humanAsk, call, result, said, QUEUED, ANSWER,
  CODEX_NAME, beforeHumanInteractionFlags, adapt, named, labelOf, beforeStableIds, sessionBeforeStableIds,
  promptDigestsBeforeStableIds, promptDigests } from './m33-u-unasked-fixture.js';
import { INSTRUCTION_GAP_NOTES, INTERJECTION_KINDS } from '../adapters/sonah-ledger.js';
import { beforeRecordedFacts } from './stable-ids-fixture.js';
import { beforeM36Labels, beforeM36Conversation, textBeforeD71Fix, textBeforeS7 } from './m33-integration-fixture.js';
import { INTERJECTION_KINDS as SLICER_INTERJECTION_KINDS } from '../../slicer/src/events.js';
import { instructionReviewScope, windowEnd, gapKey } from '../src/ledger.js';
import { planWindows } from '../src/windows.js';
import { buildNarrativePrompt } from '../src/prompt.js';

// H3 (`sonah.narrative/16`) moved every narrative request by its claims definition alone: its texts are
// rendered back first (/16 → /14), then M33 N's (/14 → /13), so every value pinned here still holds.
const beforeForbiddenEdit = (text) => beforeForbiddenEditOnly(beforeHedgedClaims(text));

// C-01 event identity (stable event ids): an event is named here by its positional label (`labelOf`, the id it had before
// stable ids), never by parsing its id; pins are checked rendered back to those labels (`beforeStableIds`).
const ids = (session) => session.events.map((event) => labelOf(session, event.id));
const instructionGaps = (session) => session.adapterGaps.filter((gap) => gap.channel === 'instructions')
  .map((gap) => (gap.eventIds ? { ...gap, eventIds: gap.eventIds.map((id) => labelOf(session, id)) } : gap));

// Pinned on 269cf6d, before OWNER DECISION B: what a session with neither shape and no capped, stripped or shortened
// ask adapts to, and every narrative request it makes.
const PINNED = {
  claude: { session: 'fffb090c6cdda8bd0f485c1a5997516d05e87ffd9d8b817cf17fb1a8ca8d78c9', prompts: [
    '92c919cec32265d921913a883c0cae312e537d0f837d0de0192ff4dd8378814f',
    '72193472cd9f5b3dba48759b1c43d5013b27eacb531d48d856c52509034a3ecb'] },
  claudeUnanswered: { session: '23cc4752319bc3d2f756cfb0dcb2a2bf177e0c8bead6f53dae05d3183868fcb7' },
  codex: { session: 'de971aac32b0f42cadaa17516f5fe94bb0fc3b69ac8e24cfea7d4d7ea9cd038c', prompts: [
    '79dbcf210298bf315733b4cecc5a2272e89d0152752c8ae644d1b9f016c57011'] },
};

test('U the in-turn instruction kinds are one closed list, re-declared here exactly as the slicer writes them', () => {
  assert.deepEqual(INTERJECTION_KINDS, Object.values(SLICER_INTERJECTION_KINDS));
  assert.ok(Object.isFrozen(INTERJECTION_KINDS) && Object.isFrozen(SLICER_INTERJECTION_KINDS));
});

// M33 H's repair (merged beside OWNER DECISION B; the relay rule in the narrative task text, still `sonah.narrative/13`)
// moved the task text of EVERY narrative request, so the pinned prompts above are 269cf6d's history. The session bytes
// and OWNER DECISION B's own guarantee (a complete window's request is unchanged by it) hold: these are the same
// requests on the merged tree, which differ from 269cf6d's only by M33 H's relay-rule text.
const MOVED_BY_M33_H = { claude: { prompts: [
  '517086c69ab6d8cb8798c02dde13f8aa2a997fbeb51cdab7cc500c0831dd969e',
  'f1e6e6af1d18220ad5188c593079d9ca10172edcff9bd23433ab693ba1d1887e'] }, codex: { prompts: ['494953f8dc0de827b9840efc230d8a928528ebea5668f4d75ac1658ed016f414'] } };

/** H1: each fixture's test command's result is now sourced from its typed status (the
 *  Claude Code verdict, the Codex exit) — `sourceOfResult: 'native'`, no longer `parsed-output`. The session bytes move by
 *  that field alone; no request moves (a request shows the result, unchanged, never its source). */
const MOVED_BY_H1 = Object.freeze({ claude: '93f0c3da386879b26a96ccb1ab10f0e605ae16ab46d89f46b3a9721c4db46b63',
  codex: 'b579331dc53acb0d7982ca13afd2c90d86bb4e84bb7bddab725ea456e6090c50',
  claudeUnanswered: 'aa04b3238101979cd8e28ff0baebc181d1ef4d3c7bfa2da7fa3c026beff6d394' });

/** M1: each fixture's `npm test` is a `bash` command, no longer `test` — its action's
 *  `tool` moves, in the session and in the one request window that shows it (`tool=bash`, no longer `tool=test`). */
const MOVED_BY_M1 = Object.freeze({ claude: '61ed0bccf7099194ca4a8a9013c26e52dd1cf20935bda0cc8c6ee0e8e1541424',
  codex: 'b88c7cc4b988689544602c5f9187613a3a78cf1dc27a5a74b0b3950fbf453905',
  claudeUnanswered: '0c89f2a4aac76ee9f48132556afa1cb41e59c4dd018f842e515162814c257029',
  prompts: { claude: ['d6897379e6637ea195048fb1803ed6625d3f1364d9da41617587f2336741aa5a', MOVED_BY_M33_H.claude.prompts[1]],
    codex: ['2eabeefb9750634238747442f429fb4be3a5488913c9f91603e414c951b65e2d'] } });

/** Status fact (owner decision 2026-10-06): each fixture's typed command status is now also stated on its result
 *  (`lastStatus`, and `coversAll` for a zero one) — the session bytes move by those fields alone: rendered back
 *  (`sessionBeforeStatusFact`) they are M1's. Every narrative request moves by the three task lines alone (no fixture
 *  command is uncovered, so no "status:" line): rendered back (`beforeStatusFact`) each is M1's. */
const MOVED_BY_STATUS_FACT = Object.freeze({ claude: '024e23df58cc9c7a8c85ecbc9ff157836ca121c40d1f761d9a575b44c25bf22c',
  codex: 'd2825ba9f3fb7431d2d59a6f758004d064c110b0eea1fb5157b3c14b4bb2d35b',
  claudeUnanswered: '6a22cb5e45dc26fa3d27661311d7f419401984b702cc6bc9af66f0a43ced156b' });
const backToM1 = (text) => beforeForbiddenEdit(beforeStatusFact(text));
// M33 brittleness L3: the adapter flags a question call from the recorder's schema (`asksHuman`), so the session of a
// recording holding one moves by exactly that flag (rendered back, `beforeHumanInteractionFlags`, it is the pin above).
const MOVED_BY_L3 = { claudeUnanswered: { session: 'd231788a74a9a36fdb3f4b2e24c5117a472c5228a03fa357d0030cacc29cb532' } };
/** M33 integration (2026-10-06): the unanswered-question session as the merged code builds it — the status fact's result
 *  fields (M33 outcomes repair) and L3's `asksHuman` flag (M33 forbidden-edit repair) on one session, which no branch built.
 *  With L3's flag rendered back it is the outcomes branch's digest (the test below). */
const MOVED_BY_INTEGRATION = Object.freeze({
  claudeUnanswered: '100a1b82695668d86ae435e496467c20c6823d0defc1f75a7b4e9de0118687eb' });

/**
 * MOVED_BY_WINDOWING (M35, owner-confirmed spec 2026-10-06; C-07 "M35 windowing"): each fixture's narrative requests —
 * one window each now (a compaction no longer splits one), named by the window's aliases, its actions and results trimmed
 * — so the render-back to M1's requests no longer applies. No session byte moved.
 */
const MOVED_BY_WINDOWING = Object.freeze({ prompts: Object.freeze({
  claude: ['2bb42be232af1bc94d4dd8d54de2deaaf296c3294191a48877aba38e06680623'],
  codex: ['7d53456d7cb3317e417730fac9fa706a7f9907ddb8e82120da0d7c4cd85902c2'] }) });

/** D68 (C-02 "M36 recorded facts"): every invocation carries the recorder's typed facts about it (`recorded`), so each
 *  fixture's session moves by those alone: rendered back (`beforeRecordedFacts`) it is the pin before them, byte for byte.
 *  No narrative request moved (no request reads the facts yet). */
const MOVED_BY_RECORDED_FACTS = Object.freeze({ claude: 'd9e4fa0018de9352c1e2f81ebb231af5bb89e5bf59d5000245a85104ccb0272c', codex: '78e8eab5a03ed7bf61e874060a3cbfd6acc1624bed8c5943350f4fb3bb394f79', claudeUnanswered: '722cd727875e0ddad11df43cc53cc700f7be48edb68ff75e197f3d970d097764' });

/** M36 phase 2, the window format (D68 L; C-07 "M36 window format"): each fixture's narrative request moved by
 *  each RESULT's label line alone (`recorded: …`): rendered back (`beforeM36Labels`) it is MOVED_BY_WINDOWING's. No
 *  session byte moved. */
const MOVED_BY_M36_FORMAT = Object.freeze({ prompts: Object.freeze({
  claude: ['9fbbb36136924529c9a0f0d9786a7f392e43b26f467bf7d2ceef6672a24019ce'],
  codex: ['329d99f609a3c6287d7e317a542190c1cbcbcc625e0aefbc34b2a6d3f6d4a102'] }) });

/** M36 phase 3 (D68 K, Q, F): each fixture's narrative request moved by item 1's actor sentence and the
 *  session-only contract's `evidenceRequests` member and rules alone: rendered back (`beforeM36Conversation`) it is
 *  MOVED_BY_M36_FORMAT's. No session byte moved. */
const MOVED_BY_M36_CONVERSATION = Object.freeze({ prompts: Object.freeze({ claude: ['53324813a5a46e39262985917aee7a8ae717ade6169b16667f939f5b46c86891'], codex: ['4c2f792e10dc7899a05450649c44a7b9a43b1cbf825a8b4b61d0fa975d8c191b'] }) });

/** D71 (S2, the reviewer brief as the checklist): each fixture's narrative request — the window in the checklist's reading
 *  order, its RESULTs' typed outcomes, its numbered agent messages. No session byte moved. */
const MOVED_BY_D71_BRIEF = Object.freeze({ prompts: Object.freeze({ claude: ['ea5868f05952c119b9ce522c25c73896cdd741e006e9eff4ccb6b235d0db719a'], codex: ['bc4f9348bf23a467db48307d4ba55a7aedabf15d9f369582770b98186d0bbd58'] }) });

/** D71 (S3, the new channels): each fixture's narrative request moved again — "About this window" lists the RESULTs
 *  step 4 answers for, the brief's last step is step 6. No session byte moved. */
const MOVED_BY_D71_CHANNELS = Object.freeze({ prompts: Object.freeze({ claude: ['c688e7e6eefcd2de42aa1aaf876ff10274cd542c644f514157efd7a9dae3d2de'], codex: ['4c65c424cb8a64ba6d36d59f37475dc5e5256f95c1dde8e664714c6f2f8630a5'] }) });

/** S6 (S5 review L5): each fixture's narrative request moved by a RESULT's output-no-status words alone: rendered back
 *  (`textBeforeD71Fix`), it is S3's above, byte for byte. No session byte moved. */
const MOVED_BY_D71_FIX = Object.freeze({ prompts: Object.freeze({ claude: ['e2f14758b243be421a1eeba9449c059c40a2d1933da96b1e10d3e5607273494e'], codex: MOVED_BY_D71_CHANNELS.prompts.codex }) });

/** S7: each fixture's narrative request moved by S7's fixed texts alone (the failures
 *  line's words): rendered back (`textBeforeS7`), it is S6's above, byte for byte. No session byte moved. */
const MOVED_BY_S7 = Object.freeze({ prompts: Object.freeze({ claude: ['04de82382d1f3e21703b4c33f9ea6803e281715d1ff6c59ff5057275a3027798'], codex: ['c5526187e5e5b0a9b468e42c094e36de9c36eff4b0e15caa22622ebcaf2957ca'] }) });

test('U a session with neither shape is byte-identical, and so is every request a complete window makes', async (t) => {
  // M33 N (`sonah.narrative/14`) moved every session-only narrative request by exactly its three forbidden-edit texts:
  // rendered back (`beforeForbiddenEdit`), each is M33 H's above, byte for byte. The status fact's texts come out first.
  // C-01 event identity: rendered back to the positional ids (`sessionBeforeStableIds`, `promptDigestsBeforeStableIds`,
  // which also proves no request moved beyond its ids), every pin below holds.
  const claude = await load(t, claudeRows());
  const claudeNow = sessionBeforeStableIds(claude.session);
  assert.equal(sessionDigest(claudeNow), MOVED_BY_RECORDED_FACTS.claude);
  const claudeBack = beforeRecordedFacts(claudeNow);
  assert.equal(sessionDigest(claudeBack), MOVED_BY_STATUS_FACT.claude);
  assert.equal(sessionDigest(sessionBeforeStatusFact(claudeBack)), MOVED_BY_M1.claude);
  // M35: the requests are pinned by MOVED_BY_WINDOWING (M1's, rendered back, were two windows); M36 phase 2 by
  // MOVED_BY_M36_FORMAT, the labels alone.
  // D71 (S2): a session-only request carries only the window in the checklist's reading order (MOVED_BY_D71_BRIEF); nothing
  // renders it back to M36 phase 3's (MOVED_BY_M36_CONVERSATION, kept as the pins these replace).
  // D71 (S3): and moved once more by the new channels (MOVED_BY_D71_CHANNELS). S6: and by the output-no-status words alone
  // (MOVED_BY_D71_FIX; rendered back, S3's).
  // S7: and by its fixed texts alone (MOVED_BY_S7; rendered back, S6's).
  assert.deepEqual(promptDigests(claude.session), MOVED_BY_S7.prompts.claude);
  assert.deepEqual(promptDigests(claude.session, textBeforeS7), MOVED_BY_D71_FIX.prompts.claude);
  assert.deepEqual(promptDigests(claude.session, textBeforeD71Fix), MOVED_BY_D71_CHANNELS.prompts.claude);
  assert.notDeepEqual(MOVED_BY_D71_CHANNELS.prompts.claude, MOVED_BY_D71_BRIEF.prompts.claude);
  assert.notDeepEqual(MOVED_BY_D71_BRIEF.prompts.claude, MOVED_BY_M36_CONVERSATION.prompts.claude);
  assert.equal(MOVED_BY_M1.prompts.claude.length, 2);
  const codex = await load(t, codexRows(), { name: CODEX_NAME });
  const codexNow = sessionBeforeStableIds(codex.session);
  assert.equal(sessionDigest(codexNow), MOVED_BY_RECORDED_FACTS.codex);
  const codexBack = beforeRecordedFacts(codexNow);
  assert.equal(sessionDigest(codexBack), MOVED_BY_STATUS_FACT.codex);
  assert.equal(sessionDigest(sessionBeforeStatusFact(codexBack)), MOVED_BY_M1.codex);
  // D71 (S2): a session-only request carries only the window in the checklist's reading order (MOVED_BY_D71_BRIEF); nothing
  // renders it back to M36 phase 3's (MOVED_BY_M36_CONVERSATION, kept as the pins these replace).
  // D71 (S3): and moved once more by the new channels (MOVED_BY_D71_CHANNELS). S6: and by the output-no-status words alone
  // (MOVED_BY_D71_FIX; rendered back, S3's).
  // S7: and by its fixed texts alone (MOVED_BY_S7; rendered back, S6's).
  assert.deepEqual(promptDigests(codex.session), MOVED_BY_S7.prompts.codex);
  assert.deepEqual(promptDigests(codex.session, textBeforeS7), MOVED_BY_D71_FIX.prompts.codex);
  assert.deepEqual(promptDigests(codex.session, textBeforeD71Fix), MOVED_BY_D71_CHANNELS.prompts.codex);
  assert.notDeepEqual(MOVED_BY_D71_CHANNELS.prompts.codex, MOVED_BY_D71_BRIEF.prompts.codex);
  assert.notDeepEqual(MOVED_BY_D71_BRIEF.prompts.codex, MOVED_BY_M36_CONVERSATION.prompts.codex);
  // An answer with no typed sidecar is unresolved as before: the session keeps its bytes. (Its window requests move
  // only where `complete` flips: window 1 is recorded before the unresolved answer, so its scope is now complete.)
  const unanswered = await load(t, claudeRows({ ask: true, sidecar: null }));
  // M33 brittleness L3: its question call now carries the adapter's `asksHuman` flag, and nothing else moved; the status
  // fact moved its result's fields. With the flag rendered back (`beforeHumanInteractionFlags`) it is the status fact's,
  // and with both rendered back M1's.
  const unansweredNow = sessionBeforeStableIds(unanswered.session);
  assert.equal(sessionDigest(unansweredNow), MOVED_BY_RECORDED_FACTS.claudeUnanswered);
  const unansweredBack = beforeRecordedFacts(unansweredNow);
  assert.equal(sessionDigest(unansweredBack), MOVED_BY_INTEGRATION.claudeUnanswered);
  // (L3's own digest is not reproduced by rendering the status fact back: its branch also lacked H1's and M1's moves,
  // which no render-back undoes. With the flag rendered back, the outcomes branch's digest is, below.)
  assert.equal(sessionDigest(beforeHumanInteractionFlags(unansweredBack)), MOVED_BY_STATUS_FACT.claudeUnanswered);
  assert.equal(sessionDigest(sessionBeforeStatusFact(beforeHumanInteractionFlags(unansweredBack))), MOVED_BY_M1.claudeUnanswered);
  // M35: one window, ending after the unresolved answer: incomplete as a whole (its `completeFor` range is OWNER
  // DECISION B's).
  const windows = planWindows(unanswered.session);
  assert.deepEqual(windows.map((w) => instructionReviewScope(unanswered.session, { upTo: windowEnd(w) }).complete), [false]);
});

test('U a queued prompt is an instruction event at its recorded row, and renumbers no commentary', async (t) => {
  const { session } = await load(t, claudeRows({ queuedPrompt: QUEUED }));
  assert.deepEqual(ids(session), ['I1', 'C1-0-1', 'A1-0', 'A1-0-r', 'I1-1', 'A1-1', 'A1-1-r', 'C1-2-6', 'B1-0',
    'I2', 'A2-0', 'A2-0-r', 'C2-1-10']);
  const event = session.event(named(session, 'I1-1'));
  assert.equal(event.kind, 'instruction');
  assert.equal(event.authority, 'human');
  // M34 labels: its marker, not `queued: true`.
  assert.deepEqual(event.markers, ['queued']);
  assert.equal(Object.hasOwn(event, 'queued'), false);
  assert.equal(event.turn, 'T1');
  assert.deepEqual(event.supersedes, []);
  assert.deepEqual(session.textSpansOf(event, 'text'), [QUEUED]);
  assert.deepEqual(instructionReviewScope(session, { upTo: 7 }).instructions.map((i) => labelOf(session, i.eventId)),
    ['I1', 'I1-1']);
  // The one unsupported instructions row the slicer counted was this prompt, read here: no loss is left to declare.
  assert.deepEqual(instructionGaps(session), []);
  assert.deepEqual(planWindows(session).map((w) => instructionReviewScope(session, { upTo: windowEnd(w) }).complete), [true]);
});

test('U a queued prompt the adapter did not read stays a declared loss, uncounted by what was read', async (t) => {
  // M34 labels: one with no origin on a typed recorder is not provably the human's, and is not read. Release fix 3b
  // (2026-10-12): its label gives it to the harness, so it is harness context, no declared loss (a row the labeller
  // leaves unlabelled keeps its declaration: m33-u-human-interjections.test.js).
  const { session } = await load(t, claudeRows({ queuedPrompt: '<system-reminder>x</system-reminder>', queuedPayload: {} }));
  assert.ok(!ids(session).some((id) => /^I\d+-\d+$/.test(id)));
  assert.deepEqual(instructionGaps(session), []);
});

test('U an answer is an instruction event after the question\'s result, naming its call', async (t) => {
  const { session } = await load(t, claudeRows({ ask: true }));
  assert.deepEqual(ids(session).slice(8), ['I2', 'C2-0-8', 'A2-0', 'A2-0-r', 'I2-1', 'A2-1', 'A2-1-r', 'C2-2-13']);
  const event = session.event(named(session, 'I2-1'));
  assert.equal(event.authority, 'human');
  assert.equal(event.answerTo, named(session, 'A2-0'));
  assert.equal(event.queued, undefined);
  assert.deepEqual(session.textSpansOf(event, 'text'), [ANSWER]);
  assert.deepEqual(instructionGaps(session), [], 'the answer was incorporated');
  const [window] = planWindows(session);
  assert.equal(instructionReviewScope(session, { upTo: windowEnd(window) }).complete, true);
  const { evidencePrompt } = buildNarrativePrompt({ session, window });
  assert.match(beforeStableIds(session, evidencePrompt), /^\[I2-1\] HUMAN INSTRUCTION · authority=human · sequence=12 · role=instruction · answer to \[A2-0\]$/m);
});

test('U capped, stripped and shortened ask gaps name their asks and count exactly them', async (t) => {
  const capped = await load(t, claudeRows({ longAsk: true }), { legacyCap: true });
  assert.deepEqual(instructionGaps(capped.session).map((g) => [g.note, g.count, g.eventIds]),
    [[INSTRUCTION_GAP_NOTES.capped_before_review, 1, ['I1']]]);
  // M6: a long pasted fence is kept whole — no strip, no gap. A persisted ledger an
  // earlier Sonah stripped still names its ask.
  const fence = `\`\`\`\n${'const pasted = 1;\n'.repeat(120)}\`\`\``;
  const whole = await load(t, [humanAsk(`Fix the parser.\n${fence}\nThanks.`), call('b1', 'Bash', { command: 'node --test' }),
    result('b1', 'ok'), said('Done.')]);
  assert.deepEqual(instructionGaps(whole.session), []);
  const persisted = structuredClone(whole.ledger);
  persisted.ask[0] = { ...persisted.ask[0], text: 'Fix the parser.\n[code block, 122 lines, 2166 chars]\nThanks.',
    elided: [{ what: 'code block', chars: 2166 }] };
  assert.deepEqual(instructionGaps(adapt(persisted, 'm33-u-stripped'))
    .map((g) => [g.note, g.count, g.eventIds]), [[INSTRUCTION_GAP_NOTES.stripped_before_review, 1, ['I1']]]);
  // The recorder's own elision (a kind no version of Sonah writes), on a hand-built ledger.
  const ledger = structuredClone(capped.ledger);
  ledger.ask[0].elided = [...ledger.ask[0].elided, { what: 'recorder elision', chars: 10 }];
  const shortened = adapt(ledger, 'm33-u');
  assert.deepEqual(instructionGaps(shortened).map((g) => [g.note, g.count, g.eventIds]),
    [[INSTRUCTION_GAP_NOTES.recorder_shortened, 1, ['I1']], [INSTRUCTION_GAP_NOTES.capped_before_review, 1, ['I1']]]);
  // A capped queued prompt is named by its own id; decisions before it keep a complete history.
  const long = `${QUEUED}\n${'Keep the parser small. '.repeat(1200)}`;
  const queuedCap = await load(t, claudeRows({ queuedPrompt: long }), { legacyCap: true });
  assert.deepEqual(instructionGaps(queuedCap.session).map((g) => [g.note, g.count, g.eventIds]),
    [[INSTRUCTION_GAP_NOTES.capped_before_review, 1, ['I1-1']]]);
  const [first] = planWindows(queuedCap.session);
  const { evidencePrompt } = buildNarrativePrompt({ session: queuedCap.session, window: first });
  assert.match(evidencePrompt, /^complete: false\ncompleteFor: earliest action sequence 1 through 3$/m);
});

test('U a Codex capped ask is named too: windows and decisions before it keep a complete history', async (t) => {
  const { session } = await load(t, codexRows({ longAsk: true }), { name: CODEX_NAME, legacyCap: true });
  assert.deepEqual(ids(session), ['I1', 'C1-0-1', 'A1-0', 'A1-0-r', 'C1-1-4', 'I2', 'A2-0', 'A2-0-r', 'C2-1-8']);
  assert.deepEqual(instructionGaps(session).map((g) => [g.note, g.count, g.eventIds]),
    [[INSTRUCTION_GAP_NOTES.capped_before_review, 1, ['I2']]]);
  const [window] = planWindows(session);
  assert.equal(instructionReviewScope(session, { upTo: windowEnd(window) }).complete, false);
  const { evidencePrompt } = buildNarrativePrompt({ session, window });
  assert.match(evidencePrompt, /^complete: false\ncompleteFor: earliest action sequence 1 through 4$/m,
    'A1-0 (sequence 2) precedes the capped ask; A2-0 (sequence 6) follows it');
});

test('U two closed causes of one ask are two losses, never de-duplicated into one', async (t) => {
  // An ask both capped (over the budget) and partly withheld by redaction: two gaps naming I1, two identities.
  const secret = ['gh', 'p_', 'W3e3SplitToken', 'AbcdefGhij', 'KlmnPqrs12', '3456'].join('');
  const rows = claudeRows({ longAsk: true });
  rows[0] = { ...rows[0], message: { ...rows[0].message, content: `${rows[0].message.content}\nUse ${secret} to publish.` } };
  const { session } = await load(t, rows, { legacyCap: true });
  const gaps = instructionGaps(session);
  assert.deepEqual(gaps.map((g) => [g.note, g.eventIds]), [[INSTRUCTION_GAP_NOTES.capped_before_review, ['I1']],
    [INSTRUCTION_GAP_NOTES.redaction_withheld, ['I1']]]);
  assert.equal(new Set(gaps.map(gapKey)).size, 2);
  // A copy of one declaration is still that one loss.
  assert.equal(gapKey({ ...gaps[0] }), gapKey(gaps[0]));
});

test('U an in-turn instruction the adapter cannot place is declared in the existing vocabulary, never dropped', async (t) => {
  const { ledger } = await load(t, claudeRows({ queuedPrompt: QUEUED }));
  // Its row was read, but its entry cannot be placed: the unsupported row it came from stays declared (unlocated).
  for (const broken of [{ beforeEvent: -1 }, { turn: 'one' }, { record: 0 }, { text: 7 }, { source: null }]) {
    const copy = structuredClone(ledger);
    Object.assign(copy.interjections[0], broken);
    const session = adapt(copy, 'm33-u');
    assert.ok(!ids(session).includes('I1-1'), JSON.stringify(broken));
    assert.deepEqual(instructionGaps(session).map((g) => [g.code, g.count, g.eventIds]),
      [['unsupported_message', 1, undefined]], JSON.stringify(broken));
    assert.equal(instructionReviewScope(session, { upTo: 7 }).complete, false, 'and it blocks every window, as before');
  }
  // An entry of a kind this adapter does not know is never read as one it does: declared, on top of the row count.
  const copy = structuredClone(ledger);
  copy.interjections[0].kind = 'mystery';
  assert.deepEqual(instructionGaps(adapt(copy, 'm33-u')).map((g) => [g.code, g.count]),
    [['unsupported_message', 2]]);
  // An answer naming no call this ledger recorded is not placed either.
  const answered = await load(t, claudeRows({ ask: true }));
  const orphan = structuredClone(answered.ledger);
  orphan.interjections[0].call = { turn: 2, seq: 9 };
  const session = adapt(orphan, 'm33-u');
  assert.ok(!ids(session).includes('I2-1'));
  assert.deepEqual(instructionGaps(session).map((g) => [g.code, g.count]), [['unsupported_message', 1]]);
});
