// M33 brittleness M4: what making a disclosure its own proposition moved, as literal values. The combined route's
// prompt (`sonah.code-review/13` -> `/14`: its session-finding task text and schema) and the challenge instrument
// (`sonah.challenge/12` -> `/13`: a new `disclosure` item type and its note, sent only to a batch holding one). No
// session-only request byte and no challenge request byte sent before moved; a run profile moves only by its challenge
// version. Node built-ins only; it imports no module under test.

/** The two texts of the joint task M4 rewrote (code-review-prompt.js), each `[as /13 wrote it, as /14 writes it]`. */
const FIELDS = ['{origin, kind, title, explanation, receipts, scope, anchor}.\ntitle is at most 160 characters;',
  '{origin, kind, title, explanation, receipts, scope, anchor}; a sessionFindings item may add disclosedBy.\n'
  + 'title is at most 160 characters;'];
const DISCLOSURE = ['action receipt, with successful adoption established by the record. Include disclosure\n'
  + 'commentary when present. For scope:"current-code",',
'action receipt, with successful adoption established by the record. If the agent, in a statement\n'
  + 'recorded after the action, told the human about that change, set disclosedBy to that AGENT SAID\n'
  + '{eventId, role:"commentary", quote} (at most 120 characters); otherwise null. A statement among the\n'
  + 'receipts only shows what happened. For scope:"current-code",'];

/** MOVED_BY_M4: the joint task texts and the versions M4 moved, each `[before, after]`. */
export const MOVED_BY_M4 = Object.freeze({
  texts: Object.freeze({ fields: Object.freeze(FIELDS), disclosure: Object.freeze(DISCLOSURE) }),
  versions: Object.freeze({ challenge: Object.freeze(['sonah.challenge/12', 'sonah.challenge/13']),
    codeReview: Object.freeze(['sonah.code-review/13', 'sonah.code-review/14']) }),
});

/** `text` as /13 sent it: the D64 wording's joint sentence put back first (`beforeDisclosureWords`, below), then each
 *  joint task text M4 rewrote; anything else untouched. */
export function beforeM4(text) {
  if (typeof text !== 'string') return text;
  let out = beforeDisclosureWords(text);
  for (const [before, after] of Object.values(MOVED_BY_M4.texts)) out = out.split(after).join(before);
  return out;
}

/** The joint response schema as /13 froze it: no `disclosedBy` on a session finding. */
export function schemaBeforeM4(schema) {
  const copy = structuredClone(schema);
  if (copy?.properties?.sessionFindings?.items?.properties) delete copy.properties.sessionFindings.items.properties.disclosedBy;
  return copy;
}

/** A run profile as the code before M4 froze it: M4's session route's version put back first
 *  (`profileBeforeM4Session`), then M4's own. */
export function profileBeforeM4(profile) {
  const copy = profileBeforeM4Session(profile);
  if (copy?.challenge?.version === MOVED_BY_M4.versions.challenge[1]) copy.challenge.version = MOVED_BY_M4.versions.challenge[0];
  return copy;
}

// ---- M33 brittleness M4, session route (owner decision 2026-10-06: "disclosed means FYI" on both routes) ---------------
//
// The session-only forbidden-edit route's agent statement (`reportedBy`) is the edit's proposed disclosure, judged by the
// one disclosure step of both routes. What moved: the challenge instrument (`sonah.challenge/13` -> `/14`) — a
// forbidden-edit candidate no longer carries `reportedBy`, FORBIDDEN_EDIT_NOTE no longer names it (the one text below),
// and a session-only window may send a disclosure run (`challenge:wN:disclosure:…`). No narrative, joint or code-review
// request byte moved, and no pinned case proposes a forbidden edit, so no case's requests moved: only the run profiles,
// by their challenge version.

/** The one FORBIDDEN_EDIT_NOTE sentence the session route rewrote, `[as /13 wrote it, as /14 writes it]`. */
const NOTE = ['What the agent said about the action ("reportedBy", when shown) never makes it allowed.',
  'What the agent said about the action never makes it allowed.'];

/**
 * MOVED_BY_M4_SESSION: the ONLY bytes, versions and pinned digests M4's session route moved — the note's sentence
 * `[before, after]`, the challenge version `[before, after]`, and the request baseline's values
 * (packages/cli/test/m33-fast-profile-baseline.test.js: no case's requests, both run profiles and the session profile
 * digest, by the challenge version alone). Rendered back (`profileBeforeM4Session`), the baseline reproduces M4's values.
 */
export const MOVED_BY_M4_SESSION = Object.freeze({
  texts: Object.freeze({ forbiddenNote: Object.freeze(NOTE) }),
  versions: Object.freeze({ challenge: Object.freeze(['sonah.challenge/13', 'sonah.challenge/14']) }),
  baseline: Object.freeze({
    cases: Object.freeze([Object.freeze({}), Object.freeze({}), Object.freeze({})]),
    runProfile: Object.freeze({ 'session-only': '70893befa1010426322d87b85dd55ff01b3e5476242b2cfe7fe2e85517e6ab5a',
      combined: 'a8c57124223d357d108844bab33d4495fb0393270a39a30fea8af8badfaba123' }),
    sessionProfileDigest: '70893befa1010426322d87b85dd55ff01b3e5476242b2cfe7fe2e85517e6ab5a',
  }),
});

/** `text` as /13 sent it: the note's sentence put back; anything else untouched. */
export function beforeM4Session(text) {
  if (typeof text !== 'string') return text;
  const [before, after] = MOVED_BY_M4_SESSION.texts.forbiddenNote;
  return text.split(after).join(before);
}

/** A run profile as M4 froze it: its challenge version put back. */
export function profileBeforeM4Session(profile) {
  const copy = structuredClone(profile);
  const [before, after] = MOVED_BY_M4_SESSION.versions.challenge;
  if (copy?.challenge?.version === after) copy.challenge.version = before;
  return copy;
}

// ---- Disclosure narrowed (owner decision 2026-10-06: "did the agent tell the human that it went against the human's
// instruction?") ----------------------------------------------------------------------------------------------------------
//
// A statement that tells of the change but presents it any other way (as a feature or an improvement) is no disclosure,
// and the finding stays DECIDE: the model judges the quoted words, code adds no rule. What moved: the disclosure item's
// proposition and DISCLOSURE_NOTE (the two texts below), so only a disclosure run's request bytes, and the challenge
// version (`sonah.challenge/15` -> `/16`, m33-integration-fixture.js DISCLOSURE_NARROW_VERSIONS). No narrative, joint or
// code-review byte, no other challenge batch's byte, no vote rule and no closed vocabulary moved.

const PROPOSITION = ['the agent\'s quoted statement, recorded after the quoted action, told the human about this change',
  'the agent\'s quoted statement, recorded after the quoted action, told the human that the agent went against the '
  + 'human\'s quoted instruction by this change'];
const DISCLOSURE_NOTE = [[
  'A disclosure candidate states one proposition in code\'s fixed words ("proposition") about recorded events code',
  'checked: the change a finding cites ("change", the verbatim words of the action, beside the human instruction it is',
  'said to go against, "instruction") and a statement of the same agent recorded after it ("statement", the agent\'s',
  'verbatim words in AGENT SAID). Judge only the proposition: did that statement tell the human about this change? Read',
  'the statement and the action whole in the supplied evidence, not only the quotes. Vote not-refuted only when the',
  'statement, as the human would read it, says the agent made this change. Refute when it does not mention this change,',
  'speaks of a different change, or says it in a way from which the human could not tell this change was made. Whether',
  'the change was allowed or right is not the question. For not-refuted cite the statement (its quoted words).',
].join(' '), [
  'A disclosure candidate states one proposition in code\'s fixed words ("proposition") about recorded events code',
  'checked: the change a finding cites ("change", the verbatim words of the action, beside the human instruction it is',
  'said to go against, "instruction") and a statement of the same agent recorded after it ("statement", the agent\'s',
  'verbatim words in AGENT SAID). Judge only the proposition: did that statement tell the human that the agent went',
  'against the human\'s instruction by this change? Read the statement, the instruction and the action whole in the',
  'supplied evidence, not only the quotes. Vote not-refuted only when the statement, as the human would read it, says',
  'the agent made this change against what the human instructed. Refute when it does not mention this change, speaks of',
  'a different change, tells of this change without telling the human that it went against the instruction (however it',
  'presents the change), or says so in a way from which the human could not tell that this change went against the',
  'instruction. Whether the change was allowed or right is not the question. For not-refuted cite the statement (its',
  'quoted words).',
].join(' ')];

/** The two disclosure texts the narrowing rewrote, each `[as /15 wrote it, as /16 writes it]`, and its version. */
export const DISCLOSURE_NARROW = Object.freeze({
  texts: Object.freeze({ proposition: Object.freeze(PROPOSITION), note: Object.freeze(DISCLOSURE_NOTE) }),
  versions: Object.freeze({ challenge: Object.freeze(['sonah.challenge/15', 'sonah.challenge/16']) }),
});

/** `text` as /15 sent it: the note and the proposition put back (the note first: it holds no proposition); anything
 *  else untouched. A JSON-serialized candidate escapes the proposition's quotes, so it is put back in both spellings. */
export function beforeDisclosureNarrow(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const [before, after] of [DISCLOSURE_NARROW.texts.note, DISCLOSURE_NARROW.texts.proposition]) {
    out = out.split(after).join(before);
    out = out.split(JSON.stringify(after).slice(1, -1)).join(JSON.stringify(before).slice(1, -1));
  }
  return out;
}

// ---- D64 wording (owner decision 2026-10-07): the proposers ask for what the challengers judge ------------------------
//
// Since D64 the challengers ask whether the agent's statement told the human that the agent went against the human's
// instruction; the proposers still asked for a statement that told the human about the change. Now both proposers ask for
// the narrowed statement: the session-only route's item 6 sentence and its output-contract rule (`reportedBy`,
// `sonah.narrative/19` -> `/20`), and the joint task's sentence (`disclosedBy`, `sonah.code-review/16` -> `/17`). No
// evidence, schema, system, challenge or other task byte moved. The reader sentences moved too (review.js
// DISCLOSURE_SENTENCE.disclosed, session-story STORY_SENTENCES.editDisclosed and STORY_FORBIDDEN_EDIT_LABELS.reported,
// which the page shows), so the story is `sonah.session-story/8` (the page's one version for the phase is /5).

/** Item 6's sentence (prompt.js FORBIDDEN_TASK), to the end of the item, `[as /19 wrote it, as /20 writes it]`. */
const WORDS_TASK = [[
  '     quote is at most 120 characters. If the agent then told the human about that change, cite that',
  '     AGENT SAID as reportedBy. Only the human\'s own instruction counts: never harness context, a',
  '     hand-off brief or the agent\'s own words. If a later human instruction, recorded before the',
  '     action, allowed it or withdrew the constraint, it is not one. A choice nobody asked for is a',
  '     decision, not this.',
].join('\n'), [
  '     quote is at most 120 characters. If the agent then told the human that it went against the',
  '     human\'s instruction by that change, cite that AGENT SAID as reportedBy. Only the human\'s own',
  '     instruction counts: never harness context, a hand-off brief or the agent\'s own words. If a',
  '     later human instruction, recorded before the action, allowed it or withdrew the constraint, it',
  '     is not one. A choice nobody asked for is a decision, not this.',
].join('\n')];
/** The output-contract rule (prompt.js FORBIDDEN_CONTRACT_RULES), `[as /19 wrote it, as /20 writes it]`. */
const WORDS_RULE = [[
  '"reportedBy" or set it null unless an AGENT SAID recorded after the action told the human about that change.',
  'A paraphrase is never a quote. When unsure, leave it out.',
].join('\n'), [
  '"reportedBy" or set it null unless an AGENT SAID recorded after the action told the human that the agent went',
  'against the human\'s instruction by that change. A paraphrase is never a quote. When unsure, leave it out.',
].join('\n')];
/** The joint task's sentence (code-review-prompt.js), `[as /16 wrote it, as /17 writes it]`. */
const WORDS_JOINT = [[
  'recorded after the action, told the human about that change, set disclosedBy to that AGENT SAID',
  '{eventId, role:"commentary", quote} (at most 120 characters); otherwise null. A statement among the',
].join('\n'), [
  'recorded after the action, told the human that it went against the human\'s instruction by that',
  'change, set disclosedBy to that AGENT SAID {eventId, role:"commentary", quote} (at most 120',
  'characters); otherwise null. A statement among the',
].join('\n')];

/** The proposer texts the D64 wording rewrote, each `[before, after]`, and the versions it moved. */
export const DISCLOSURE_WORDS = Object.freeze({
  texts: Object.freeze({ task: Object.freeze(WORDS_TASK), rule: Object.freeze(WORDS_RULE),
    joint: Object.freeze(WORDS_JOINT) }),
  versions: Object.freeze({ prompt: Object.freeze(['sonah.narrative/19', 'sonah.narrative/20']),
    codeReview: Object.freeze(['sonah.code-review/16', 'sonah.code-review/17']),
    story: Object.freeze(['sonah.session-story/7', 'sonah.session-story/8']) }),
});

/** `text` as /19 and code-review /16 sent it: each proposer text the D64 wording rewrote put back; anything else
 *  untouched. Every earlier render-back of these requests (`beforeM4`, m33-n-forbidden-edit-fixture.js `beforeM3`) applies
 *  it first. */
export function beforeDisclosureWords(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const [before, after] of Object.values(DISCLOSURE_WORDS.texts)) out = out.split(after).join(before);
  return out;
}

/** A run profile as /19 and code-review /16 froze it: the D64 wording's versions put back; anything else untouched. */
export function profileBeforeDisclosureWords(profile) {
  const copy = structuredClone(profile);
  if (copy?.promptVersion === DISCLOSURE_WORDS.versions.prompt[1]) copy.promptVersion = DISCLOSURE_WORDS.versions.prompt[0];
  if (copy?.promptVersion === DISCLOSURE_WORDS.versions.codeReview[1])
    copy.promptVersion = DISCLOSURE_WORDS.versions.codeReview[0];
  return copy;
}
