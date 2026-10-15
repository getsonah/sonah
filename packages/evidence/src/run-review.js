// The review run: session + diff -> windows -> narrative pass -> grounding -> one report.
//
// The model transport is INJECTED. This module makes no network call and spawns no process, so
// the whole pipeline is testable with a fake judge that throws if called unexpectedly.

import { planWindows, carriedContext, carriedRecord, carriedIds, aliasTable, mapEventIds, windowSettingsOf,
  windowingProfileOf, windowParts } from './windows.js';
import { EVIDENCE_REQUEST_LIMITS, EVIDENCE_REQUEST_MEMBER, EVIDENCE_REQUEST_REFUSALS, requestsOf, withoutRequests,
  serveEvidence, emptyEvidenceRecord, addRound, withServed, servedSoFar } from './evidence-requests.js';
import { verifyReceipts, verifyReceipt, repairReceipt, decisionIdentity, receiptProjection, shownSession } from './session.js';
import { identityDigest } from '../contracts/canonical.js';
import { requestImages, deliveredView, clearedView } from './images.js';
import { buildChallengeDossier, buildNarrativePrompt, NARRATIVE_SCHEMA, SESSION_NARRATIVE_SCHEMA, PROMPT_VERSION,
  narrativeSchemaOf, restatusRequest, recolumnRequest } from './prompt.js';
import { reviewAgentProfile } from './review-agent.js';
import { buildLedger, honestStatuses, sessionCoverageFacts, coverageFrom, withheldRejection,
  withheldCauseCounts, declaredCauses, JUDGE_FAILURE_CODES, RUN_FAILURE_CODES, windowEnd,
  resolutionShape, resolutionChallengeable, RESOLUTION_CHALLENGE_OUTCOMES, RESOLUTION_REJECTIONS,
  WRITTEN_LABELS, WRITTEN_WITHHELD_CAUSES, WRITTEN_CONTRADICTION_REJECTIONS, findingReceiptCheck,
  PROMISE_STATUSES, SUPPORT_REJECTIONS, UNSETTLED_CHALLENGE, markHelperStatements, FORBIDDEN_EDIT_ITEM_TYPE,
  FORBIDDEN_EDIT_REJECTIONS, FORBIDDEN_EDIT_REVERTED_MARK, FORBIDDEN_WITHHELD_CAUSE, DISCLOSURE_ITEM_TYPE,
  DISCLOSURE_REJECTIONS, oneSession, REQUIREMENT_STATUSES, LEGACY_REQUIREMENT_STATUSES, REQUIREMENT_UNCHECKED_REASONS,
  REQUIREMENT_UNREVIEWED_TEXT, RESTS_ON_REJECTIONS, NOT_CLAIM_REJECTIONS, CLOSING_LINE_UNREVIEWED, CONTRADICTION_ROLES,
  CONTRADICTION_SOURCES, FAILURE_HANDLINGS, FAILURE_UNCHECKED_REASONS, FAILURE_REJECTIONS, FAILURE_ITEM_TYPE,
  FAILURE_OUTCOMES, resultOutcome, REQUIREMENT_FACTS, PROMISE_UNCHECKED_REASONS, CHALLENGE_ENDED, UNRUN_WRITE_REASON,
  quotesOnlyUnrunWrite, constraintWithSourceRole, reviewWithSourceRoles, REQUIREMENT_RESTATUS_WITHHELD,
  DECISION_RECOLUMN_WITHHELD, DECISION_COLUMN_REFUTED, groundDecision, codeContradictionSource, SUPPORT_ASKED,
  OWN_WRITTEN_SOURCE, RESTS_ON_REPAIRED, DECISION_RECOLUMN_RECORD } from './ledger.js';
import { checkedRequirement, claimRestsOn, windowAsks, notClaimsCheck, closingCoverage, windowFailures, failuresCheck }
  from './checklist.js';
import { supportCheck, supportShape } from './claims.js';
import { statusUncovered } from './status-fact.js';
import { challengeItems, mergeChallengeRuns, CHALLENGE_PROFILE, requestFits, reviewInputBytes, verbatimWords,
  forbiddenEditProposition, challengeOutcome, disclosureAsks, disclosureOutcomes, disclosureCounts, REFUTING_VOTES,
  refutingVotesOf } from './challenge.js';
import { FORBIDDEN_CHANNEL, forbiddenShape, forbiddenListOf, readForbiddenEdit, forbiddenChallengeItem,
  forbiddenFindingCandidate, forbiddenEditIdentity } from './forbidden.js';
import { WRITTEN_CHANNEL, WRITTEN_ITEM_TYPE, writtenChatClaim, asWrittenStatement, readWrittenStatement,
  writtenChallengeCandidate, publishedStatement, writtenShape, shownWrittenBodies, WRITTEN_CONTRADICTION_ROLES }
  from './written.js';
import { CHALLENGE_TIER_BOUNDS, REVIEW_SPEED_PROFILES, challengeProfileOf, dossierChallenge, isStandardProfile, reviewSpeedProfile,
  requestBoundOf, tieredChallenge } from './review-profiles.js';
import { CODE_PASS_PROFILE } from './code-pass.js';

/**
 * H1b. How much of a proposal the response contract does not admit a window's record keeps: the value
 * itself only when it is no deeper and no larger than these bounds, else nothing. A proposal the contract
 * admits is bounded by the contract (at most seven levels); one it does not could be as deep as the
 * transport's parser accepts, and a report holding it could not be serialized. The scan is iterative
 * (no depth reaches the call stack) and stops at either bound, so a cycle a direct caller builds ends too.
 */
export const RECORD_LIMITS = Object.freeze({ depth: 32, containers: 4096 });

/** Is `value` within RECORD_LIMITS? Deterministic: a fixed traversal, the same answer for the same value. */
function recordable(value) {
  const stack = [[value, 0]];
  let containers = 0;
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (node === null || typeof node !== 'object') continue;
    if (depth >= RECORD_LIMITS.depth || ++containers > RECORD_LIMITS.containers) return false;
    for (const child of Array.isArray(node) ? node : Object.values(node)) stack.push([child, depth + 1]);
  }
  return true;
}

/** H1b: the closed reason code keeps in place of a `resolvedBy` that is not exactly a resolution pair. */
const [MALFORMED_RESOLUTION] = RESOLUTION_REJECTIONS;

/**
 * M33 (C-06 "M33 self-corrected claims"). A claim as its channel's response contract reads it: without
 * its `resolvedBy`. The resolution is judged apart from the claim — by code, then (C-06 refreeze) as its
 * own challenge item — so the contradiction decides "exactly as without a resolution": a resolution that
 * is malformed, cites a source its window was not shown, sits on a claim with no contradiction, or
 * carries a model rating at any depth (H1b) is a rejected resolution, never an unreadable, withheld or
 * unpublished claim. The rating is never read as anything: the resolution it rides in is discarded whole.
 */
export function claimCore(claim) {
  if (!plain(claim) || !Object.hasOwn(claim, 'resolvedBy')) return claim;
  const { resolvedBy: _judgedApart, ...core } = claim;
  return core;
}

/**
 * M33 C (C-06 "M33 claims are facts"). A claim as its readability and its supply are judged: without its
 * `resolvedBy` (`claimCore`) and without its `supportedBy`. Each is judged apart from the claim — a
 * resolution by code and as its own challenge item, a support by code (`supportCheck`) and (M33 C repair) as its
 * own challenge item — so a bad one is a rejected resolution or support, never an unreadable or withheld claim.
 */
export function claimBare(claim) {
  const core = claimCore(claim);
  if (!plain(core) || !Object.hasOwn(core, 'supportedBy')) return core;
  const { supportedBy: _judgedApart, ...bare } = core;
  return bare;
}

/** M33 C: the closed reason a window keeps in place of a `supportedBy` that is not exactly a receipt, and (M33 C
 *  recheck) the one a published contradiction of the same words gives a support it outranks. */
const [SUPPORT_CONTRADICTED, MALFORMED_SUPPORT] = SUPPORT_REJECTIONS;
const [STALE_ASKED, FAILED_ASKED] = SUPPORT_ASKED;

/**
 * H1b. A proposed claim as a window keeps it: its `resolvedBy`, when it has one, is the shaped pair
 * (copied, two fixed levels) or else the closed reason `malformed` — never the value as the model sent
 * it, which could be as deep as the transport's parser accepts. The ledger names that reason itself.
 * M33 C: its `supportedBy` likewise — the receipt copied (`supportShape`, one level) or `malformed`.
 */
function boundedClaim(claim) {
  if (!plain(claim)) return claim;
  const resolution = Object.hasOwn(claim, 'resolvedBy') && claim.resolvedBy != null;
  const support = Object.hasOwn(claim, 'supportedBy') && claim.supportedBy != null;
  if (!resolution && !support) return claim;
  let kept = claim;
  if (resolution) {
    const pair = resolutionShape(claim.resolvedBy);
    kept = { ...claimCore(claim), resolvedBy: pair
      ? { observation: { ...pair.observation }, statement: { ...pair.statement } } : MALFORMED_RESOLUTION };
  }
  // A key already present keeps its place: only its value is replaced.
  return support ? { ...kept, supportedBy: supportShape(claim.supportedBy) ?? MALFORMED_SUPPORT } : kept;
}

/** Was every receipt of a shaped resolution pair supplied to its window, as a source of its role? */
const suppliedResolution = (pair, sourceMap) => [pair.observation, pair.statement].every((receipt) =>
  Object.hasOwn(sourceMap, receipt.eventId) && Array.isArray(sourceMap[receipt.eventId])
  && sourceMap[receipt.eventId].some((source) => source?.role === receipt.role));

/**
 * What a contradicted claim's finding candidate carries of its proposed resolution: nothing when none
 * was proposed; the pair as proposed otherwise (the ledger names a malformed one as such); when the
 * window's source map is known, whether the window was shown both of its sources; and (C-06 refreeze)
 * how its own challenge item ended, when the code that ran the challenge recorded one. The last two
 * are facts only this code computes, never read from the model.
 */
function proposedResolution(claim, sourceMap, outcomes) {
  if (claim?.resolvedBy == null) return {};
  const pair = resolutionShape(claim.resolvedBy);
  // H1b: never the value as proposed — the ledger names the closed reason, and a record keeps it bounded.
  if (!pair) return { resolvedBy: MALFORMED_RESOLUTION };
  const outcome = outcomes instanceof Map ? outcomes.get(claim) : undefined;
  return { resolvedBy: { observation: { ...pair.observation }, statement: { ...pair.statement } },
    ...(sourceMap == null ? {} : { resolutionSupplied: suppliedResolution(pair, sourceMap) }),
    ...(RESOLUTION_CHALLENGE_OUTCOMES.includes(outcome) ? { resolutionChallenge: outcome } : {}) };
}

/** C-06 refreeze: a resolution item's key — its claim's key and this suffix, never a channel key. */
const RESOLUTION_KEY_SUFFIX = ':resolution';
/** How a resolution item's challenge ended, in `RESOLUTION_CHALLENGE_OUTCOMES` words, from the same
 *  fields `challengeItems` states its own rejection reasons from (challenge.js `challengeOutcome`, M33 brittleness M4:
 *  the one mapping every route's runs share). */
const [UPHELD, REFUTED_OUTCOME, UNSETTLED_OUTCOME, UNEXECUTED] = RESOLUTION_CHALLENGE_OUTCOMES;
// S6 (S5 review L3): every reason token a row carries is a name taken from its closed list (ledger.js), never an inline
// literal, so a per-reason count (which iterates the list) can never miss one.
const [, , , , ASK_UNREVIEWED, ASK_REFUTED, ASK_UNSETTLED, ASK_UNEXECUTED] = REQUIREMENT_UNCHECKED_REASONS;
const [RESPONSE_UNGROUNDED, , , , , FAILURE_UNREVIEWED, FAILURE_REFUTED, FAILURE_UNSETTLED, FAILURE_UNEXECUTED]
  = FAILURE_UNCHECKED_REASONS;
const [, , , FAILURE_NOT_CHECKED] = FAILURE_HANDLINGS;
const [NO_DELIVERABLE_BY_END] = REQUIREMENT_FACTS;
const [PROMISE_UNSETTLED, PROMISE_UNEXECUTED] = PROMISE_UNCHECKED_REASONS;
const [DECISION_UNSETTLED, DECISION_UNEXECUTED] = UNSETTLED_CHALLENGE;
/** S6 (S5 review M4): a window's closing-message lines for its readers — `[{ eventId, unreviewed, listed }]`, each a list
 *  of line numbers, only for a message with any — or null (none, or a window with no checklist record). */
function closingLinesOf(record) {
  const closing = plain(record) && plain(record.closing) ? record.closing : null;
  if (!closing) return null;
  const byEvent = new Map();
  const at = (eventId) => byEvent.get(eventId) ?? byEvent.set(eventId, { eventId, unreviewed: [], listed: [] }).get(eventId);
  for (const [key, field] of [['unreviewedLines', 'unreviewed'], ['listedLines', 'listed']])
    for (const entry of Array.isArray(closing[key]) ? closing[key] : [])
      if (plain(entry) && typeof entry.eventId === 'string' && Array.isArray(entry.lines)) at(entry.eventId)[field].push(...entry.lines);
  return byEvent.size ? [...byEvent.values()] : null;
}
/** How a challenge item that was not upheld ended, as the closed reason of its row's own list: `[refuted, unsettled,
 *  unexecuted]` (a list without a refuted reason passes null there). */
const endedAs = (outcome, [refuted, unsettled, unexecuted]) => (outcome === REFUTED_OUTCOME ? refuted
  : outcome === UNSETTLED_OUTCOME ? unsettled : unexecuted);

/**
 * C-06 refreeze: the separate challenge item for a claim's proposed resolution, or null. Only a claim
 * with a cited contradiction whose resolution has already passed every code check
 * (`resolutionChallengeable`: shape, roles, supplied, grounded, order, actor, a run that did not fail,
 * turn, no human instruction between) gets one. It shows the challenger the contradicted claim and the
 * proposed pair — what the resolution is said to correct and what is said to correct it — and asks only
 * whether the resolution holds; the contradiction is its own item, shown exactly as without a resolution.
 */
function resolutionItem(item, { session, pr, repo, sourceMap, verbatim }) {
  const claim = item.candidate;
  if (!plain(claim) || !claim.contradictedBy || claim.resolvedBy == null) return null;
  let candidate;
  try { [candidate] = toCandidates({ claims: [claim] }, session, { sourceMap }).findings; } catch { return null; }
  if (!candidate || !resolutionChallengeable({ repo, session, pr, candidate })) return null;
  const pair = resolutionShape(claim.resolvedBy);
  // M33 C2 repair: shown with its claim's own words as code grounded them (`claimVerbatim`) — the claim's stated
  // receipt is this item's.
  return { key: `${item.key}${RESOLUTION_KEY_SUFFIX}`, type: 'resolution', claim, verbatim, candidate: {
    text: claim.text, stated: { ...claim.stated }, contradictedBy: { ...claim.contradictedBy },
    resolvedBy: { observation: { ...pair.observation }, statement: { ...pair.statement } } } };
}

/** The finding kind a claim with a cited contradiction proposes (`toCandidates`). */
const CLAIM_FINDING_KIND = 'claim_contradicted';
/** D71 (e), (g): a contradicted claim's finding title, by the role of what contradicts it — code's fixed words, never
 *  the model's (a RESULT's is the title it always had). */
export const CONTRADICTION_TITLES = Object.freeze({ observation: 'Claim contradicted by a recorded result',
  instruction: "Claim contradicted by the human's own message", code: "Claim contradicted by a file's recorded content",
  'project-instructions': "Claim contradicted by the project's instruction file" });
/** W2 (owner decision 2026-10-13): the title of a claim a code receipt contradicts from the text the agent's own edit or
 *  write added (ledger.js `codeContradictionSource`: `own_written`), never "a file's recorded content". */
export const OWN_WRITTEN_TITLE = 'Claim contradicted by what the agent itself wrote';

/** The texts a window was shown of one receipt's event and role (its C-05 source map), in the map's order. */
const shownTexts = (sourceMap, receipt) => (sourceMap != null && plain(receipt) && typeof receipt.eventId === 'string'
  && Object.hasOwn(sourceMap, receipt.eventId) && Array.isArray(sourceMap[receipt.eventId])
  ? sourceMap[receipt.eventId].filter((source) => source?.role === receipt.role && typeof source.text === 'string')
    .map((source) => source.text) : []);

/**
 * M33 C2 repair (C-06 "M33 the verbatim quote decides"): a chat claim's own words, grounded BEFORE it is asked by the
 * very check its publication applies to its stated receipt — a claim a result contradicts by its finding's receipt
 * check (`findingReceiptCheck`: strict, then the one W3-3 near-miss repair, `repairReceipt`), a claim without by the
 * strict check its promise is grounded by (`groundedExtras`). Returns `{ quote, context? }` (challenge.js
 * `verbatimWords`): the exact source substring that check returned — never the narrative model's string — and the one
 * text this window was shown that holds it; or null when the receipt does not ground, so the claim could never
 * publish and is never asked. A strictly grounded quote keeps its bytes. Pure; never throws.
 */
function claimVerbatim(session, sourceMap, claim) {
  if (!plain(claim) || !plain(claim.stated)) return null;
  let grounded = null;
  try { grounded = claim.contradictedBy ? repairReceipt(session, claim.stated) : verifyReceipt(session, claim.stated); }
  catch { grounded = null; }
  const quote = grounded?.ok === true ? grounded.receipt?.quote : undefined;
  return typeof quote === 'string' && quote ? verbatimWords(quote, shownTexts(sourceMap, claim.stated)) : null;
}

/**
 * M33 (I2). A contradicted claim's receipts, as its finding cites them: what the agent said, then the
 * recorded result that contradicts it — copies, so no check changes the claim. The one list both the
 * finding (`toCandidates`) and the claim's own count (`groundedExtras`) check, so the two can never
 * check different receipts.
 */
const contradictionReceipts = (claim) => [{ ...claim.stated }, { ...claim.contradictedBy }];

/** Narrative output -> the candidate shapes the grounder validates. `sourceMap` is the window's
 *  (C-05 model-input source-map inclusion), when the caller has one. `resolutionOutcomes` (C-06
 *  refreeze): how each claim's resolution item ended in this window's challenge, keyed by the claim
 *  object, when a challenge ran — a code fact, never a model field. */
export function toCandidates(narrative, sessionOrKey, { sourceMap = null, resolutionOutcomes = null } = {}) {
  // The transport never chooses actor identity. Native child provenance on every cited action
  // resolves it; a mixed or unknown actor stays null for the grounder to reject. The string
  // form remains for synthetic callers that construct a single-actor candidate directly.
  const actorOf = (actions) => typeof sessionOrKey === 'string' ? sessionOrKey
    : sessionOrKey?.actorForActions?.(actions.map((id) => sessionOrKey.event(id)))?.sessionKey ?? null;
  // D71 (d): a choice not to act that cites no action takes its actor from the agent's own words it is anchored on (the
  // grounder admits it only on a session-only review: ledger.js `groundDecision`).
  const statementActorOf = (stated) => (typeof sessionOrKey === 'string' ? sessionOrKey
    : plain(stated) && typeof stated.eventId === 'string'
      ? sessionOrKey?.actorForStatement?.(sessionOrKey.event(stated.eventId))?.sessionKey ?? null : null);
  const decisions = (narrative?.decisions ?? []).map((d) => ({
    ...d, // Retain forbidden fields so direct callers cannot launder a rated candidate.
    actorSession: d.notActing === true && Array.isArray(d.actions) && !d.actions.length ? statementActorOf(d.stated)
      : actorOf(d.actions ?? []),
    dimension: d.dimension,
    chosen: d.chosen,
    value: d.value ?? null,
    valueReceipt: d.valueReceipt ? { ...d.valueReceipt } : null,
    actions: d.actions ?? [],
    instructionReview: d.instructionReview ?? null,
    stated: d.stated ? { ...d.stated } : null,
    constrainedBy: d.constrainedBy != null
      ? { ...d.constrainedBy, instruction: d.constrainedBy.instruction ? { ...d.constrainedBy.instruction } : null,
          settles: d.constrainedBy.settles,
          settledValueQuote: d.constrainedBy.settledValueQuote ?? null }
      : null,
  }));

  // W2: a code receipt is titled by the recorded region that holds its quote (`codeContradictionSource`).
  const titleOf = (against) => (against?.role === 'code' && typeof sessionOrKey?.event === 'function'
    && codeContradictionSource(sessionOrKey, against) === OWN_WRITTEN_SOURCE ? OWN_WRITTEN_TITLE
    : CONTRADICTION_TITLES[against?.role] ?? CONTRADICTION_TITLES.observation);
  // Only a claim with a cited contradiction becomes a finding. A claim on its own is not an
  // accusation, and "I could not find a contradiction" is not evidence of one.
  const findings = (narrative?.claims ?? [])
    .filter((c) => c.contradictedBy)
    .map((c) => ({
      origin: 'session-review',
      kind: CLAIM_FINDING_KIND,
      title: `${titleOf(c.contradictedBy)}: ${String(c.text).slice(0, 120)}`,
      explanation: String(c.text),
      scope: 'session-effect',
      anchor: null,
      receipts: contradictionReceipts(c),
      // D71 (e), (g): a contradiction a session-only answer cites from recorded evidence other than a RESULT; code checks
      // which source it is and whether it holds (ledger.js `contradictionSourceOf`). Absent on every other candidate.
      ...(plain(c.contradictedBy) && c.contradictedBy.role !== 'observation'
        ? { contradictionRole: c.contradictedBy.role } : {}),
      // M33 (C-06): a proposed self-correction rides beside the accusation, never inside its receipts.
      ...proposedResolution(c, sourceMap, resolutionOutcomes),
    }));

  return { decisions, findings };
}

const CHANNELS = ['decisions', 'pivots', 'claims', 'requirements'];
const TYPES = { decisions: 'decision', pivots: 'pivot', claims: 'claim', requirements: 'requirement' };
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
// M33 (C-06 "M33 written statements"): `writtenClaims` is read apart from the four channels. Its absence
// is no written statement; whatever it holds, it never makes the narrative unreadable (`splitWritten`).
// M33 N (C-06 "M33 forbidden edits"): so is `forbiddenEdits`, admitted only where it is asked for — a session-only
// review (`forbidden`); a combined review's answer carrying it is outside its contract, exactly as before.
const narrativeShape = (value, forbidden = false) => plain(value)
  && Object.keys(value).every((key) => CHANNELS.includes(key) || key === WRITTEN_CHANNEL
    // M36 phase 3 (D68 Q): a session-only answer may carry its evidence requests, read apart (evidence-requests.js).
    // D71 (S2): and the closing message's lines that assert nothing (`notClaims`), read apart.
    // D71 (S3, c): and its failure rows (`failures`), read apart.
    || (forbidden && (key === FORBIDDEN_CHANNEL || key === EVIDENCE_REQUEST_MEMBER || key === NOT_CLAIMS_MEMBER
      || key === FAILURES_MEMBER)))
  && CHANNELS.every((key) => Array.isArray(value[key]));

/** D71 (S2): the session-only answer member listing the closing message's lines that assert
 *  nothing (checklist.js `notClaimsCheck`). Never a channel of proposals: it is checked structurally and counted. */
const NOT_CLAIMS_MEMBER = 'notClaims';
/** D71 (S3, owner decision D71 c): the session-only answer member of failure rows — one per RESULT the window lists as
 *  failed, unrun or unfinished (checklist.js `failuresCheck`); read apart from the four channels, checked, challenged as
 *  their own item type and published as the checklist's failures section. */
const FAILURES_MEMBER = 'failures';

/** D71 (S3, c): a failure list as it came — none when absent, one row no check can read when it is not a list. */
const failureRowsOf = (answer) => (!plain(answer) || answer[FAILURES_MEMBER] === undefined ? []
  : Array.isArray(answer[FAILURES_MEMBER]) ? answer[FAILURES_MEMBER] : [answer[FAILURES_MEMBER]]);
/** D71 (S3, c): two answers' failure rows as one list: `base`'s rows, then each of `other`'s for a RESULT `base` names no
 *  row for. Rows are keyed by the RESULT they name; a row with no such key comes along as it is (its own check counts it). */
function mergedFailureRows(base, other) {
  const named = new Set(base.filter((row) => plain(row) && typeof row.eventId === 'string').map((row) => row.eventId));
  return [...base, ...other.filter((row) => !(plain(row) && typeof row.eventId === 'string' && named.has(row.eventId)))];
}

/** A narrative's `writtenClaims` as a list: none when absent, and one proposal no check can read when it
 *  is not a list. */
const writtenListOf = (narrative) => {
  const listed = narrative[WRITTEN_CHANNEL];
  return listed === undefined ? [] : Array.isArray(listed) ? [...listed] : [null];
};

/**
 * M33 (C-06 "M33 written statements"). A valid narrative's four channels, and apart from them the written
 * statements it proposed: its `writtenClaims`, then every chat claim whose stated receipt quotes what
 * one of the agent's own writes wrote, as its window (`sourceMap`) was supplied it ("reclassified as this
 * class, not unread"; `writtenChatClaim`), counted. A `writtenClaims` that is not a list is one proposal
 * no check can read.
 */
function splitWritten(narrative, session, sourceMap) {
  const written = writtenListOf(narrative);
  const claims = [];
  let reclassified = 0;
  for (const claim of narrative.claims) {
    if (writtenChatClaim(claim, session, sourceMap)) { written.push(asWrittenStatement(claim)); reclassified++; }
    else claims.push(claim);
  }
  return { narrative: { ...Object.fromEntries(CHANNELS.map((channel) => [channel, narrative[channel]])), claims },
    written, reclassified };
}

/**
 * Every proposal a valid narrative makes in its four channels, as a window keeps it — after its written
 * statements are read apart (`splitWritten`, or the `split` already made of it). H1b: a claim's
 * `resolvedBy` is bounded to its shaped pair or the closed reason `malformed` (`boundedClaim`), so
 * nothing the model nested reaches a record.
 */
function proposalsOf(narrative, session, sourceMap, split = splitWritten(narrative, session, sourceMap)) {
  return CHANNELS.flatMap((channel) => split.narrative[channel].map((candidate, index) => ({
    key: `${channel}:${index}`, type: TYPES[channel], candidate: channel === 'claims' ? boundedClaim(candidate) : candidate,
  })));
}

/** Is `candidate` of `channel` outside the response contract? A claim is read without its `resolvedBy`
 *  (`claimCore`), so a bad resolution never makes its claim unreadable — M33 C: nor its `supportedBy`
 *  (`claimBare`), so a bad support never does either. */
const unreadableIn = (channel, candidate, schema = NARRATIVE_SCHEMA) =>
  !matches(channel === 'claims' ? claimBare(candidate) : candidate, schema.properties[channel].items);

/** A proposal outside the response contract: no check can read it (`kind_rejected`). D71 (S2): against the contract its
 *  request carried — a session-only answer's (SESSION_NARRATIVE_SCHEMA: the checklist's requirement statuses and
 *  receipts, a claim's `restsOn`), or a combined answer's (NARRATIVE_SCHEMA, unchanged). */
function unreadableProposal(item, schema = NARRATIVE_SCHEMA) {
  return unreadableIn(item.key.split(':')[0], item.candidate, schema);
}
/** The session-only reader (a re-ask and a served re-ask are session-only: PROPOSAL_REASKS, D68 Q). */
const unreadableSessionProposal = (item) => unreadableProposal(item, SESSION_NARRATIVE_SCHEMA);

/**
 * D79 (owner decision 2026-10-11): the identity a decision proposal has for the two re-asks' merges (`reaskedAnswer`,
 * `servedAnswer`) is its wording-free structure — the sorted set of cited actions, its instruction receipt
 * (`constrainedBy.instruction`: the event and the quote, or none), its stated receipt (the event and the quote, or
 * none) and whether it is a choice not to act (`notActing`) — never the model's `dimension`, `value` or `valueReceipt`,
 * which a resample restates (`decisionIdentity` hashes them, so a re-ask's decisions were published beside their
 * first-answer twins). Keyed by structure, a re-ask's restatement of a decision reads as present, and is published
 * once. The same actions in another order or repeated are the same set;
 * "none" is one meaning however it is spelled (absent or null); any other `notActing` than `true` is acting. Null when
 * the structure cannot be read (an action that is not a string, a receipt that is not an object of strings): such a
 * proposal is added, never dropped, and its own checks reject it. Published decision ids (`decisionIdentity`,
 * `mergeWindowOutputs`) are unchanged. Never throws.
 */
function decisionStructure(candidate) {
  const { actions, constrainedBy } = candidate;
  if (!Array.isArray(actions) || actions.some((id) => typeof id !== 'string')) return null;
  const instruction = placingReceipt(constrainedBy == null ? null
    : plain(constrainedBy) ? constrainedBy.instruction : undefined);
  const stated = placingReceipt(candidate.stated);
  if (instruction === undefined || stated === undefined) return null;
  const structure = [[...new Set(actions)].sort(), instruction, stated, candidate.notActing === true];
  return `decision:${JSON.stringify(structure)}`;
}

/** D79: the two fields that place a receipt in the recording — its event and its quote — or null for none (absent or
 *  null); undefined when it is not a receipt a check could read. */
const placingReceipt = (value) => (value == null ? null
  : plain(value) && typeof value.eventId === 'string' && typeof value.quote === 'string' ? [value.eventId, value.quote]
    : undefined);

/**
 * D79 review: the channel whose merge identity two different proposals of ONE answer can share. A decision's structure
 * (`decisionStructure`) holds nothing the model says the decision is, so two decisions one answer gives on the same
 * actions and receipts (which script is run; which flag it is run with) have one structure. It is checked only against
 * the OTHER answer's readable decisions — the first answer's kept ones (`reaskedAnswer`), the re-ask's (`servedAnswer`)
 * — never against its own answer's: a re-ask's restatement of a decision the other answer holds is that decision (D79),
 * and two decisions of one answer stay two, as in a window that was never asked again (an exact repeat is one published
 * decision across the review, `mergeWindowOutputs`), so a decision the first answer grounded is never lost because the
 * re-ask left it out (C-07 "M36 packed windows, carried failures and the evidence re-ask" 10). Within one answer, two
 * decisions can share a structure while their dimensions differ: they are two decisions, so they stay two.
 */
const acrossAnswersOnly = (channel) => channel === 'decisions';

/**
 * Review-WP2: one receipt of a statement's identity, exactly — every field it carries, by name, in a fixed
 * order — or null when it cites none (absent or null). Undefined when it is not a receipt a check could
 * read (a field that is not a string): then no identity can be computed. Reads one level.
 */
function exactReceipt(value) {
  if (value == null) return null;
  if (!plain(value)) return undefined;
  const fields = Object.keys(value).sort();
  return fields.every((field) => typeof value[field] === 'string') ? fields.map((field) => [field, value[field]]) : undefined;
}

/**
 * Review-WP2: a claim's resolution, exactly, for its identity: none (absent or null), the shaped pair's two
 * receipts (`resolutionShape`), or the closed reason `malformed` a window keeps in place of anything else
 * (`boundedClaim`). Two fixed levels are read.
 */
function exactResolution(value) {
  if (value == null) return null;
  const pair = resolutionShape(value);
  return pair ? [exactReceipt(pair.observation), exactReceipt(pair.statement)] : MALFORMED_RESOLUTION;
}

/**
 * The exact identity one proposal of a window's answer has — for the two re-asks' merges (`reaskedAnswer`,
 * `servedAnswer`) and for one answer's own repeats (`withoutRepeats`) — or null when none can be computed. A
 * decision by `decisionIdentity` (as `toCandidates` reads it); a chat claim or a written statement by its
 * stated receipt AND (review-WP2) its `contradictedBy` and `resolvedBy` receipts, exactly: two copies of one
 * statement that differ in what they cite against it or for its correction are two proposals, both grounded
 * and challenged, and the existing merge rules pick — `mergeDuplicateFindings` never softens a DECIDE, and a
 * written statement's label only rises to `contradicted` (`mergeWindowOutputs`). D78 (owner decision
 * 2026-10-11): the review's own paraphrase (`text`) is NOT part of it — two claims at the same event with the
 * same role, quote, contradiction, resolution and support are one claim, whatever words the review gave each
 * (a published claim could repeat another so). "None" is one meaning however it is
 * spelled (absent or null). A requirement by its instruction and text and a pivot by its receipt set — the
 * keys `mergeWindowOutputs` reconciles windows by. Never throws.
 */
function proposalIdentity(channel, candidate, { session, repo }) {
  try {
    if (!plain(candidate)) return null;
    // D79: a decision by its wording-free structure (`decisionStructure`), never by `decisionIdentity`'s wording.
    if (channel === 'decisions') return decisionStructure(candidate);
    if (channel === 'claims' || channel === WRITTEN_CHANNEL) {
      const { stated } = candidate;
      if (!plain(stated)) return null;
      const against = exactReceipt(candidate.contradictedBy);
      // A written statement has no resolution (`asWrittenStatement` drops one), and no support.
      const resolution = channel === 'claims' ? exactResolution(candidate.resolvedBy) : null;
      // M33 C: a claim's support is part of what it cites for itself, exactly like its contradiction.
      const support = channel === 'claims' ? exactReceipt(candidate.supportedBy) : null;
      if (against === undefined || support === undefined
          || (Array.isArray(resolution) && resolution.includes(undefined))) return null;
      return `statement:${JSON.stringify([stated.eventId ?? null, stated.role ?? null, stated.quote ?? null,
        against, resolution, ...(support === null ? [] : [support])])}`;
    }
    if (channel === 'requirements')
      return `requirement:${JSON.stringify([candidate.instruction?.eventId ?? null, candidate.text ?? null])}`;
    if (channel === 'pivots') {
      if (!Array.isArray(candidate.receipts)) return null;
      return `pivot:${JSON.stringify([...new Set(candidate.receipts
        .map((r) => JSON.stringify([r?.eventId ?? null, r?.quote ?? null])))].sort())}`;
    }
    return null;
  } catch { return null; }
}

/**
 * How a window's answers are read for a re-ask's merge: each proposal's exact identity (`proposalIdentity`; a chat claim
 * quoting the written body its window was supplied by the written statement it is read as, review-WP2; a forbidden edit
 * by every field) and whether code can read it — against `schema`, the answer contract its request carried (a re-ask
 * is session-only: SESSION_NARRATIVE_SCHEMA). One reader for both re-asks (`reaskedAnswer`, `servedAnswer`) and for
 * one answer's own repeats (`withoutRepeats`). D78: a chat claim or written statement whose published record cannot
 * be computed (`recordComputable`) has no identity here, so in all three it never keeps a copy that can be published
 * out; it is kept or added as it came, and its own check rejects it.
 */
function answerReader({ session, repo, sourceMap, schema = SESSION_NARRATIVE_SCHEMA }) {
  const context = { session, repo };
  const roles = writtenRolesOf(schema);
  // A claim quoting the written body its window was shown is a written statement: readable when it
  // has the written statement's contract shape (`writtenShape` via `readWrittenStatement`).
  const statementIn = (claim) => writtenChatClaim(claim, session, sourceMap);
  // Review-WP2: and its identity is that of the written statement it is read as (`splitWritten`), so it
  // and a `writtenClaims` copy of the same statement are one proposal only when they cite the same.
  const identityOf = (channel, candidate) => (channel === FORBIDDEN_CHANNEL ? forbiddenIdentity(candidate)
    : (channel === 'claims' || channel === WRITTEN_CHANNEL)
      && !recordComputable(channel, candidate, repo, statementIn) ? null
    : channel === 'claims' && statementIn(candidate)
      ? proposalIdentity(WRITTEN_CHANNEL, asWrittenStatement(candidate), context)
      : proposalIdentity(channel, candidate, context));
  const readable = (channel, candidate) => (channel === FORBIDDEN_CHANNEL ? forbiddenShape(candidate)
    : channel === WRITTEN_CHANNEL ? writtenShape(candidate, roles)
    : channel === 'claims' && statementIn(candidate) ? writtenShape(asWrittenStatement(candidate), roles)
      : !unreadableIn(channel, candidate, schema));
  return { statementIn, identityOf, readable };
}

/**
 * M33 (C-06 "M33 per-part verdicts"). The answer a window keeps when its first answer held a proposal code
 * cannot read and it was asked once more. A model resample never erases or lowers a grounded proposal:
 * every readable proposal of the FIRST answer is kept, in its order, and the re-ask only adds — each of its
 * readable proposals not already present by exact identity (`proposalIdentity`; a decision: by its structure, D79,
 * against the first answer's decisions only, `acrossAnswersOnly`), after the first answer's,
 * in its own order. Review-WP2: a claim's or a written statement's identity includes what it cites against
 * it and for its correction, so a first-answer copy without a contradiction (or with one that does not
 * ground) never keeps out a re-ask copy that carries one; both are kept and the merge rules pick. D78: the
 * identity leaves out the paraphrase, so the re-ask's other words for a present claim add nothing. A
 * proposal whose identity cannot be computed is added, never dropped for it: its own checks reject it with
 * a stated reason. Every item kept is then challenged and grounded as usual.
 *
 * `recovered` is true when the re-ask is a narrative that holds no unreadable proposal: the window then
 * keeps none, and the first answer's unreadable item itself is never recovered from it. Otherwise — the
 * re-ask failed (`second` null), is no narrative, or holds an unreadable proposal of its own — the first
 * answer's unreadable proposals stay in the kept answer, read exactly as they always were (`kind_rejected`,
 * a check that did not run), so only this window's parts read UNCHECKED (`proposal_unreadable`); nothing
 * unreadable is ever added from the re-ask. Written statements are read apart (`splitWritten`) and never
 * make a window incomplete: the first answer's are kept as they came, and the re-ask adds each one of
 * contract shape that is new. Pure and deterministic; never throws on model output.
 */
export function reaskedAnswer({ first, second, session, repo = { host: 'github.com', id: '0' }, sourceMap = null }) {
  // M33 N: a re-ask is a session-only review's (PROPOSAL_REASKS), whose answer may carry `forbiddenEdits`.
  if (!narrativeShape(second, true)) return { narrative: first, recovered: false };
  const recovered = !proposalsOf(second, session, sourceMap).some(unreadableSessionProposal)
    && !forbiddenListOf(second).some((item) => !forbiddenShape(item));
  const { statementIn, identityOf, readable } = answerReader({ session, repo, sourceMap });
  const present = new Set();
  const remember = (channel, candidate) => {
    const key = identityOf(channel, candidate);
    if (key !== null) present.add(key);
  };
  const kept = Object.fromEntries(CHANNELS.map((channel) => [channel, first[channel]
    .filter((candidate) => !recovered || readable(channel, candidate) || (channel === 'claims' && statementIn(candidate)))]));
  kept[WRITTEN_CHANNEL] = writtenListOf(first);
  // M33 N: the forbidden edits, as the four channels are kept — present only when either answer carried them, so an
  // answer without any reads exactly as it always did. Readable is the response contract's shape (`forbiddenShape`);
  // identity is every field, exactly.
  const forbidden = Object.hasOwn(first, FORBIDDEN_CHANNEL) || Object.hasOwn(second, FORBIDDEN_CHANNEL);
  if (forbidden) kept[FORBIDDEN_CHANNEL] = forbiddenListOf(first).filter((item) => !recovered || forbiddenShape(item));
  const channels = [...CHANNELS, WRITTEN_CHANNEL, ...(forbidden ? [FORBIDDEN_CHANNEL] : [])];
  // Only a readable proposal is present: an unreadable one the first answer still holds never keeps the
  // re-ask's readable proposal of the same identity out.
  for (const channel of channels)
    for (const candidate of kept[channel]) if (readable(channel, candidate)) remember(channel, candidate);
  const additions = [...CHANNELS.map((channel) => [channel, second[channel]]), [WRITTEN_CHANNEL, writtenListOf(second)],
    ...(forbidden ? [[FORBIDDEN_CHANNEL, forbiddenListOf(second)]] : [])];
  for (const [channel, list] of additions)
    for (const candidate of list) {
      if (!readable(channel, candidate)) continue;
      const key = identityOf(channel, candidate);
      if (key !== null && present.has(key)) continue;
      // D79 review: a decision's structure is checked against the first answer's only (`acrossAnswersOnly`).
      if (key !== null && !acrossAnswersOnly(channel)) present.add(key);
      kept[channel].push(candidate);
    }
  // D71 (S2): the closing message's lines that assert nothing — the first answer's list stands (a resample), else the
  // re-ask's; present only when either answer carried one.
  if (Object.hasOwn(first, NOT_CLAIMS_MEMBER)) kept[NOT_CLAIMS_MEMBER] = first[NOT_CLAIMS_MEMBER];
  else if (Object.hasOwn(second, NOT_CLAIMS_MEMBER)) kept[NOT_CLAIMS_MEMBER] = second[NOT_CLAIMS_MEMBER];
  // D71 (S3, c): the failure rows — the first answer's stand (a resample), and the re-ask adds a row only for a RESULT the
  // first answer gave none; present only when either answer carried them.
  if (Object.hasOwn(first, FAILURES_MEMBER) || Object.hasOwn(second, FAILURES_MEMBER))
    kept[FAILURES_MEMBER] = mergedFailureRows(failureRowsOf(first), failureRowsOf(second));
  return { narrative: kept, recovered };
}

/**
 * M36 phase 3 review (owner decision D68 Q; C-07 "M36 packed windows, carried failures and the evidence re-ask" 10). The
 * answer a window keeps when its evidence re-ask answered (`reask`, already in the narrative's shape): the re-ask never
 * replaces the first answer (review-WP), and the served text only adds or corrects. The re-ask's answer is the base —
 * every proposal of it as it came, its unreadable ones too (read as they always are: the proposal re-ask, then
 * `proposal_unreadable`), since it was asked with strictly more evidence than the first: where both answers hold one
 * proposal by exact identity (`proposalIdentity`), the re-ask's copy is the one kept (a requirement's status, a
 * decision's choice the served lines corrected; D78: a claim the re-ask put in other words is that one proposal, so the
 * first answer's paraphrase is not kept beside it). Then every READABLE proposal of the first answer that the re-ask
 * did not repeat is kept after it, in its order — a proposal the first answer grounded in what the window showed is
 * never lost because the re-ask left it out (a contradiction is never dropped, M33 X); every kept item is challenged
 * and grounded as usual. Unlike the proposal re-ask (`reaskedAnswer`, a resample of the same request: the first
 * answer's copy stands), the evidence re-ask's request holds more. `fromFirst` counts the first answer's proposals so
 * kept (the ones a replacing re-ask would have lost). Pure and deterministic; never throws on model output.
 */
export function servedAnswer({ first, reask, session, repo = { host: 'github.com', id: '0' }, sourceMap = null }) {
  const { identityOf, readable } = answerReader({ session, repo, sourceMap });
  const forbidden = Object.hasOwn(first, FORBIDDEN_CHANNEL) || Object.hasOwn(reask, FORBIDDEN_CHANNEL);
  const kept = Object.fromEntries(CHANNELS.map((channel) => [channel, [...reask[channel]]]));
  kept[WRITTEN_CHANNEL] = [...writtenListOf(reask)];
  if (forbidden) kept[FORBIDDEN_CHANNEL] = [...forbiddenListOf(reask)];
  const channels = [...CHANNELS, WRITTEN_CHANNEL, ...(forbidden ? [FORBIDDEN_CHANNEL] : [])];
  const present = new Set();
  for (const channel of channels)
    for (const candidate of kept[channel]) {
      if (!readable(channel, candidate)) continue;
      const key = identityOf(channel, candidate);
      if (key !== null) present.add(key);
    }
  let fromFirst = 0;
  const earlier = [...CHANNELS.map((channel) => [channel, first[channel]]), [WRITTEN_CHANNEL, writtenListOf(first)],
    ...(forbidden ? [[FORBIDDEN_CHANNEL, forbiddenListOf(first)]] : [])];
  for (const [channel, list] of earlier)
    for (const candidate of list) {
      if (!readable(channel, candidate)) continue;
      const key = identityOf(channel, candidate);
      if (key !== null && present.has(key)) continue;
      // D79 review: a decision's structure is checked against the re-ask's only (`acrossAnswersOnly`).
      if (key !== null && !acrossAnswersOnly(channel)) present.add(key);
      kept[channel].push(candidate);
      fromFirst++;
    }
  // D71 (S2): the closing message's lines that assert nothing — the re-ask's list (asked with more), else the first's.
  if (Object.hasOwn(reask, NOT_CLAIMS_MEMBER)) kept[NOT_CLAIMS_MEMBER] = reask[NOT_CLAIMS_MEMBER];
  else if (Object.hasOwn(first, NOT_CLAIMS_MEMBER)) kept[NOT_CLAIMS_MEMBER] = first[NOT_CLAIMS_MEMBER];
  // D71 (S3, c): the failure rows — the re-ask's (asked with more), and each of the first answer's for a RESULT the re-ask
  // gave none, so a row the first answer grounded is never lost.
  if (Object.hasOwn(first, FAILURES_MEMBER) || Object.hasOwn(reask, FAILURES_MEMBER))
    kept[FAILURES_MEMBER] = mergedFailureRows(failureRowsOf(reask), failureRowsOf(first));
  return { narrative: kept, fromFirst };
}

/**
 * D78 (owner decision 2026-10-11): exact repeats of a claim are one claim. The answer a window keeps with one claim
 * per exact identity (`proposalIdentity`: the stated event, role and quote, the contradiction, the resolution and the
 * support, exactly — never the review's paraphrase, `text`): in each of the two statement channels the FIRST readable
 * copy of an identity is kept, as it came, and every later readable copy is dropped before anything is checked, so
 * each kept claim is challenged once and two copies can never end with different statuses. A chat claim quoting a
 * written body its window was shown is read as the written statement it is (`writtenChatClaim`), so it and a
 * `writtenClaims` copy of one statement are one proposal (the `writtenClaims` list is read first, as `splitWritten`
 * orders them). A copy no check can read — outside the contract's shape, or one whose published record cannot be
 * computed (`recordComputable`: its C-06 identity refuses a lone surrogate the transport's parser accepted) — or
 * whose identity cannot be computed is never dropped for it: its own checks reject it with a stated reason, and it
 * never keeps a readable copy out. Every other member of the answer is as it came. `repeats` counts the copies
 * dropped, by the class each is read as (`claims`: a chat claim; `written`: a written statement). Structure only: no
 * word of a claim is read. Pure and deterministic; never throws on model output.
 *
 * D80 (owner decision 2026-10-12): a dropped chat claim's flags are not lost with it — the kept copy takes the union of
 * the two copies' `assumption` (true when either is) and `restsOn` (its own ids, then each of the dropped copy's it
 * lacks), so the one claim checked is the one both copies proposed (`withFlagsOf`). A written statement has neither.
 * The joined ids are then checked as one claim's (`claimRestsOn`, all or nothing): one id it refuses, the dropped
 * copy's included, leaves the claim as if it cited none (counted in `restsOnRejected.claims`), where the merge after
 * the checks (`withoutUnupheldRepeats`) joins only ids each copy's check accepted. Left for the owner (the review of
 * D80 M).
 *
 * Where repeats come from: most from ONE window answer proposing the same statement twice; the two re-asks' merges add
 * no paraphrase of a present claim (`reaskedAnswer`, `servedAnswer`, by the same identity), and across windows a
 * statement repeats only through the carried context (M33 X `carriedRepeats`).
 */
export function withoutRepeats(narrative, { session, repo = { host: 'github.com', id: '0' }, sourceMap = null,
  schema = SESSION_NARRATIVE_SCHEMA } = {}) {
  const repeats = { claims: 0, written: 0 };
  if (!plain(narrative)) return { narrative, repeats };
  const { statementIn, identityOf, readable } = answerReader({ session, repo, sourceMap, schema });
  // Each identity's kept copy: the list it is in, its place there, and whether it is read as a chat claim.
  const present = new Map();
  const once = (channel, list) => {
    const out = [];
    for (const candidate of list) {
      const chat = channel === 'claims' && !statementIn(candidate);
      // A copy whose published record cannot be computed has no identity (`answerReader`): kept, never registered.
      const key = readable(channel, candidate) ? identityOf(channel, candidate) : null;
      const kept = key === null ? undefined : present.get(key);
      if (kept === undefined) {
        if (key !== null) present.set(key, { list: out, at: out.length, chat });
        out.push(candidate);
        continue;
      }
      // D80: the kept copy takes the dropped chat claim's flags (`withFlagsOf`).
      if (kept.chat && chat) kept.list[kept.at] = withFlagsOf(kept.list[kept.at], candidate);
      repeats[chat ? 'claims' : 'written']++;
    }
    return out;
  };
  const kept = { ...narrative };
  // The order of the answer's own keys is kept: a member is replaced in place, never added.
  const written = narrative[WRITTEN_CHANNEL];
  if (Array.isArray(written)) kept[WRITTEN_CHANNEL] = once(WRITTEN_CHANNEL, written);
  if (Array.isArray(narrative.claims)) kept.claims = once('claims', narrative.claims);
  return { narrative: kept, repeats };
}

/**
 * D80: `kept` with the flags of `copy`, another copy of the same claim — `assumption` true when either copy's is,
 * and `restsOn` the kept copy's ids, then each of the copy's it lacks, in the copy's order. `kept` itself when the
 * copy adds nothing, so a copy with the same flags leaves the kept copy as it came. Only lists of ids are joined: a
 * value no check can read stays as it came, for its own check. Pure; never throws.
 */
function withFlagsOf(kept, copy) {
  if (!plain(kept) || !plain(copy)) return kept;
  const assumption = kept.assumption !== true && copy.assumption === true;
  const own = kept.restsOn == null ? [] : kept.restsOn;
  const added = Array.isArray(own) && Array.isArray(copy.restsOn)
    ? [...new Set(copy.restsOn.filter((id) => typeof id === 'string' && !own.includes(id)))] : [];
  if (!assumption && !added.length) return kept;
  return { ...kept, ...(assumption ? { assumption: true } : {}),
    ...(added.length ? { restsOn: [...own, ...added] } : {}) };
}

/**
 * D78: can a readable copy's published record be computed — a written statement's (`publishedStatement`, the check
 * that withholds it `written_unreadable`), or a chat claim's C-06 promise identity over its stated receipt and text
 * (the digest `groundedExtras` computes, which counts a claim it refuses as rejected)? A copy it cannot is unread by
 * its own check and has no identity (`answerReader`): neither re-ask's merge nor `withoutRepeats` keeps it in place of
 * a copy that can be read, and none drops it (review-WP: "one statement that cannot be published never costs another
 * its publication"). Never throws.
 */
function recordComputable(channel, candidate, repo, statementIn) {
  try {
    const statement = channel === WRITTEN_CHANNEL ? candidate
      : statementIn(candidate) ? asWrittenStatement(candidate) : null;
    if (statement !== null) return !publishedStatement(repo, { statement }, undefined).withheld;
    promiseIdentity(repo, { stated: candidate.stated, text: candidate.text });
    return true;
  } catch { return false; }
}

/**
 * M33 (C-06 "M33 per-part verdicts"): how many times a window whose answer holds an unreadable proposal
 * is asked again, by review scope. Frozen, and part of the run profile. A combined review asks none:
 * its joint request also places and grounds the code under review, which a second joint answer would
 * count twice; its unreadable proposals limit their window's parts as they are.
 */
export const PROPOSAL_REASKS = Object.freeze({ combined: 0, 'session-only': 1 });

/**
 * D70 (a), owner decision 2026-10-08: the model a session-only review asks through the claude CLI when the run names
 * none — the CLI's documented long-context selector on the full id (packages/cli/src/review-judge.js
 * `CLI_CONTEXT_SELECTORS`), for EVERY call, never only the calls over the plain id's limit. Cost: Anthropic's pricing
 * page ("Long context pricing", platform.claude.com/docs/en/about-claude/pricing, read 2026-10-08) bills Claude 4.6 and
 * later models, Sonnet 5.5 among them, across the full 1M-token window at standard pricing, so a request below 200,000
 * tokens costs the same either way, and one above it the plain id cannot send at all (the CLI refuses it before any API
 * call: M40). Simplicity: one id is one answer key per request and one attestation rule; choosing per call would need
 * the CLI's own size estimate (characters / 3 against its assumed window), an undocumented internal of one CLI version,
 * in product code. A frozen literal that the scripted runner reads (scripts/session-review.mjs) when the run names no
 * model; a run that names a model asks that one. D70 review (S0): it is NOT a member of any run profile — a transport
 * default is not part of the review's identity, the window checkpoint's digest stays the review's, and the answer key
 * already binds the model value and the argv (answer-cache.js).
 */
export const SESSION_REVIEW_CLAUDE_CLI_MODEL = 'claude-sonnet-5-5[1m]';

/** M33 N: a forbidden edit's exact identity for the bounded re-ask — every field it carries, as JSON — or null. */
function forbiddenIdentity(item) {
  const fields = (value) => (plain(value) ? Object.keys(value).sort().map((key) => [key, value[key]]) : value ?? null);
  try {
    return forbiddenShape(item) ? `forbidden:${JSON.stringify([item.text, fields(item.instruction), fields(item.violation),
      fields(item.reportedBy)])}` : null;
  } catch { return null; }
}

const zeros = (vocabulary) => Object.fromEntries(vocabulary.map((token) => [token, 0]));
const [, WRITTEN_CONTRADICTED] = WRITTEN_LABELS;
/** W2: the roles a written statement's contradiction may quote, as the contract a request carried states them (its
 *  `writtenClaims` contradiction's role: a const or an enum) — a RESULT's alone when it states none. */
function writtenRolesOf(schema) {
  const role = schema?.properties?.writtenClaims?.items?.properties?.contradictedBy?.properties?.role;
  return typeof role?.const === 'string' ? [role.const] : Array.isArray(role?.enum) ? [...role.enum]
    : WRITTEN_CONTRADICTION_ROLES;
}
const [WRITTEN_UNREADABLE] = WRITTEN_WITHHELD_CAUSES;

/**
 * M33 (C-06 "M33 written statements"). One window's written statements, from proposal to published
 * record. Each is read by code (`readWrittenStatement`): withheld and counted by closed cause, or
 * published. One whose contradiction passed every code check is its own challenge item, labelled
 * `contradicted` only when that item survives with two grounded support votes. The window's written items
 * are asked by `ask` in one challenge run of their own — never in a batch with an ordinary proposal or
 * with the other class (a resolution), so a reply about them can cost no item of another class a vote.
 * Written items are batched together within the challenge profile's item and byte limits: a malformed
 * reply voids that pass for every written item in its batch, and the bounded per-pass re-ask asks those
 * slots again.
 * Nothing here can make the window incomplete: the returned challenge record is kept apart from the
 * window's own.
 */
async function writtenStatementsOf({ written, session, sourceMap, repo, ask, until = null, bounds = undefined,
  roles = WRITTEN_CONTRADICTION_ROLES }) {
  const withheld = zeros(WRITTEN_WITHHELD_CAUSES);
  const reads = [];
  written.forEach((item, index) => {
    let read;
    try {
      read = readWrittenStatement(item, { session, sourceMap, until, roles });
      // Review-WP: a statement whose record cannot be computed (its identity digest refuses model text,
      // such as a lone surrogate) is withheld as unreadable before anything is asked about it.
      if (!read.withheld && publishedStatement(repo, read, undefined).withheld) read = { withheld: WRITTEN_UNREADABLE };
    } catch { read = { withheld: WRITTEN_UNREADABLE }; }
    if (read.withheld) withheld[read.withheld]++;
    else reads.push({ key: `${WRITTEN_CHANNEL}:${index}`, item, read });
  });
  const asked = reads.filter(({ read }) => read.contradiction != null);
  let challenge = null;
  const outcomes = new Map();
  if (asked.length) {
    // A challenge that cannot run leaves every contradiction it would have judged unexecuted: the
    // statement is published `unverified`, never lost, and the review never fails for it.
    try {
      // M33 C2 repair: each shown with its own written words as code grounded them (`readWrittenStatement`: the strict
      // check its publication applies), and the one written body its window was shown holding them.
      challenge = await ask(asked.map(({ key, item, read }) => ({ key, type: WRITTEN_ITEM_TYPE,
        candidate: writtenChallengeCandidate(item),
        verbatim: verbatimWords(read.statement.stated.quote, shownWrittenBodies(session, sourceMap, read.statement.stated)) })),
      ':written', bounds);
      const byKey = new Map(challenge.results.map((result) => [result.key, result]));
      for (const { key } of asked) outcomes.set(key, challengeOutcome(byKey.get(key)));
      delete challenge.survivors;
    } catch { challenge = null; outcomes.clear(); }
  }
  const contradictionsRejected = zeros(WRITTEN_CONTRADICTION_REJECTIONS);
  const statements = [];
  for (const { key, read } of reads) {
    // Never throws (`publishedStatement`): one statement that cannot be published is withheld and counted,
    // and costs no other statement its publication.
    const { record, rejected, withheld: unpublished } = publishedStatement(repo, read, outcomes.get(key));
    if (unpublished) { withheld[unpublished]++; continue; }
    if (rejected) contradictionsRejected[rejected]++;
    statements.push(record);
  }
  return { statements, withheld, contradictionsRejected, challenge };
}

// The CLI transport only promises parsed JSON. Enforce the pinned narrative shape locally;
// all object schemas are closed, including receipts and R1 checks. Requirement.status is the
// one explicitly permitted ledger status; model ratings have no place in any candidate.
function matches(value, schema) {
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (!types.some((t) => t === 'integer' ? Number.isSafeInteger(value)
      : t === 'object' ? plain(value) : t === kind)) return false;
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (typeof value === 'string' && (value.length < (schema.minLength ?? 0)
      || value.length > (schema.maxLength ?? Infinity))) return false;
  if (Array.isArray(value) && schema.items && !value.every((v) => matches(v, schema.items))) return false;
  if (plain(value)) {
    if ((schema.required ?? []).some((key) => !Object.hasOwn(value, key))) return false;
    if (Object.keys(value).some((key) => !Object.hasOwn(schema.properties ?? {}, key))) return false;
    if (Object.entries(schema.properties ?? {}).some(([key, child]) => Object.hasOwn(value, key) && !matches(value[key], child))) return false;
  }
  return true;
}

function suppliedCandidate(candidate, channel, sourceMap) {
  if (channel === 'decisions' && !(candidate.actions ?? []).every((id) => Object.hasOwn(sourceMap, id))) return false;
  const supplied = (value) => {
    if (Array.isArray(value)) return value.every(supplied);
    if (!plain(value)) return true;
    if (Object.hasOwn(value, 'eventId') || Object.hasOwn(value, 'quote'))
      return Object.hasOwn(sourceMap, value.eventId) && Array.isArray(sourceMap[value.eventId])
        && sourceMap[value.eventId].some((source) => source.role === value.role);
    return Object.values(value).every(supplied);
  };
  return supplied(candidate);
}

// D58: why one pivot, requirement or claim was not published. `withheld` — its shape was sound
// and a quote it cites did not match the record: the check ran and was inconclusive. `unread` —
// it could not be evaluated at all (a malformed shape, a wrong role, no receipt to check): that
// still leaves the window's grounding incomplete, as it always did.
const WITHHELD = 'withheld', UNREAD = 'unread';

/**
 * D58: a claim no check can read — no text that states anything, or a stated or contradicting receipt of
 * the wrong role. `groundedExtras` counts it as `unread`, which leaves its window's grounding incomplete.
 * M33 (I2): the one test both of a claim's routes apply, so a contradicted claim counted as unread is
 * never also grounded as the `claim_contradicted` finding `toCandidates` would make of it
 * (`ledgerNarrative`): never both published and rejected.
 */
const unreadClaim = (claim) => typeof claim?.text !== 'string' || !claim.text.trim() || claim.stated?.role !== 'commentary'
  // D71 (e), (g): a contradiction may cite a RESULT or another recorded region of a contradiction role (a session-only
  // answer's contract; a combined answer's admits only a RESULT and is unreadable before it gets here).
  || Boolean(claim.contradictedBy && !Object.values(CONTRADICTION_ROLES).includes(claim.contradictedBy.role));

/**
 * M33 (I2). What of a window's narrative the ledger grounds: all of it, except a claim its window cannot
 * read (`unreadClaim`) — counted once, as unread, by `groundedExtras`, and never also proposed as a
 * finding. A claim that is not an object is left as it came, so `toCandidates` treats it exactly as it
 * always did. Applied after the window's challenge ran, never to what a request carries: the proposals
 * challenged and every resolution item (`resolutionItem`, from the unfiltered claim) are unchanged.
 */
const ledgerNarrative = (narrative) => (Array.isArray(narrative?.claims)
  ? { ...narrative, claims: narrative.claims.filter((claim) => !(plain(claim) && unreadClaim(claim))) }
  : narrative);

/**
 * C-06 `PromiseRecord` identity: `sonah.promise-identity/1` over `repo, stated, text`, the stated
 * receipt by its C-06 projection. Code computes it from validated, grounded fields only.
 */
export function promiseIdentity(repo, promise) {
  return identityDigest('sonah.promise-identity/1', { repo, stated: receiptProjection(promise.stated), text: promise.text });
}

/** The same receipt: role, event, quote and revision equal; two stated session keys must agree. */
const sameReceipt = (a, b) => plain(a) && plain(b) && a.role === b.role && a.eventId === b.eventId
  && typeof a.quote === 'string' && a.quote === b.quote && (a.revisionOid ?? null) === (b.revisionOid ?? null)
  && (a.sessionKey == null || b.sessionKey == null || a.sessionKey === b.sessionKey);

/**
 * C-06 (M33): "A claim whose stated receipt is also cited by a surviving `claim_contradicted`
 * finding is that finding, not also an open promise." `findings` are the SURVIVING ones — what the
 * ledger published — so a contradiction that did not ground supersedes nothing. Applied to the
 * merged promises of every window, so it holds within a window and across windows alike.
 * `asFindings` counts the promises the rule took out: each is shown as its finding, never dropped
 * silently. Pure; the order of what is kept is unchanged.
 */
export function promisesBesideFindings(promises, findings) {
  const list = Array.isArray(promises) ? promises : [];
  const cited = (Array.isArray(findings) ? findings : [])
    .filter((finding) => plain(finding) && finding.kind === 'claim_contradicted' && Array.isArray(finding.receipts))
    .flatMap((finding) => finding.receipts);
  const kept = list.filter((promise) => !cited.some((receipt) => sameReceipt(promise?.stated, receipt)));
  return { promises: kept, asFindings: list.length - kept.length };
}

/**
 * M33 C recheck 2 (C-06 "M33 claims are facts"): the statements of every contradiction whose own check did not
 * settle, from challenge records `records` — a window's (`claim` items citing `contradictedBy`) or the combined
 * route's (`session-finding` items of kind `claim_contradicted`) — that ended unsettled or unexecuted
 * (UNSETTLED_CHALLENGE): each one's commentary receipts, as the item cited them. A resolved refutation is a
 * completed check and gives nothing. Only the receipts' events are ever read (`unverifiedBesideFindings`). Pure; a
 * record it cannot read gives nothing.
 */
export function unsettledContradictionStatements(session, records) {
  const out = [];
  for (const record of Array.isArray(records) ? records : []) {
    const reasonOf = new Map((Array.isArray(record?.rejected) ? record.rejected : [])
      .filter((entry) => typeof entry?.key === 'string').map((entry) => [entry.key, entry.reason]));
    for (const result of Array.isArray(record?.results) ? record.results : []) {
      const candidate = result?.candidate;
      if (!plain(candidate) || result.survived === true || !UNSETTLED_CHALLENGE.includes(reasonOf.get(result.key))) continue;
      const said = result.type === 'claim' ? (candidate.contradictedBy ? [candidate.stated] : [])
        : result.type === JOINT_SESSION_FINDING && candidate.kind === CLAIM_FINDING_KIND && Array.isArray(candidate.receipts)
          ? candidate.receipts : [];
      for (const receipt of said) if (receiptLike(receipt) && receipt.role === 'commentary') out.push({ ...receipt });
    }
  }
  return out;
}

/**
 * M33 C event binding (C-06 "M33 claims are facts"): a promise is never "confirmed by a recorded result" in a
 * statement a contradiction cites. A `verified` promise whose stated EVENT is the event of a commentary receipt
 * — the stated event — of a `claim_contradicted` finding in `findings` is published `open`, receipts `[stated]`,
 * whatever words of that statement each quotes: the contradiction wins, exactly as for a claim that cites both
 * (`contradicted`). The caller passes the published findings, of any status, and adds, as findings of that kind,
 * the statements of every contradiction whose own check did not settle (`unsettledContradictionStatements`); a
 * refuted contradiction is a completed check and lowers nothing. (M33 C recheck and recheck 2 compared overlapping
 * words, so a claim and its support in different words of one message — "All parser tests pass. The parser suite
 * is green." — were both an accusation and "confirmed".) The same words in another statement are another event and
 * keep their promise; `promisesBesideFindings` keeps near misses too. Only the status is lowered; `lowered` counts
 * them. `session` is unused (kept for the callers' shape). Pure; a promise it cannot read is kept as it came.
 */
export function unverifiedBesideFindings(session, promises, findings) {
  const list = Array.isArray(promises) ? promises : [];
  const said = new Set((Array.isArray(findings) ? findings : [])
    .filter((finding) => plain(finding) && finding.kind === CLAIM_FINDING_KIND && Array.isArray(finding.receipts))
    .flatMap((finding) => finding.receipts).filter((receipt) => plain(receipt) && receipt.role === 'commentary'
      && typeof receipt.eventId === 'string').map((receipt) => receipt.eventId));
  let lowered = 0;
  const out = list.map((promise) => {
    if (promise?.status !== PROMISE_VERIFIED || !plain(promise.stated) || !said.has(promise.stated.eventId)) return promise;
    lowered++;
    return { ...promise, status: PROMISE_OPEN, receipts: [promise.stated] };
  });
  return { promises: out, lowered };
}

/**
 * M33 (G3). The one deterministic re-route a challenge vote receipt gets besides the quote snap: a
 * receipt that cites an ACTION's id with role `observation` quoted that action's result under the
 * wrong event. It becomes the result's receipt only when every link is typed and exact —
 *   - the cited event is an invocation, the role is `observation`, and no frozen revision is named;
 *   - the session records exactly one observation of that invocation (two are ambiguous);
 *   - that result was supplied to THIS window (`sourceMap`) as an observation; and
 *   - the quote, untouched, is a substring of that supplied result text (no snap on top of it).
 * The moved receipt is then verified from scratch like any other. Anything else is null, and the
 * vote stays rejected exactly as before. Never a guess: no text, order, time or path is joined.
 */
export function resultReceiptRepair(session, sourceMap, receipt) {
  if (!plain(receipt) || receipt.role !== 'observation' || typeof receipt.eventId !== 'string'
      || typeof receipt.quote !== 'string' || receipt.revisionOid !== undefined
      || typeof session?.event !== 'function' || !Array.isArray(session.events) || sourceMap == null) return null;
  const action = session.event(receipt.eventId);
  if (action?.kind !== 'invocation') return null;
  const results = session.events.filter((event) => event?.kind === 'observation' && event.invocation === action.id);
  if (results.length !== 1) return null;
  const [result] = results;
  const supplied = Object.hasOwn(sourceMap, result.id) && Array.isArray(sourceMap[result.id]) ? sourceMap[result.id] : [];
  if (!supplied.some((source) => source?.role === 'observation' && typeof source.text === 'string'
      && source.text.includes(receipt.quote))) return null;
  const verified = verifyReceipt(session, { ...receipt, eventId: result.id });
  if (!verified.ok) return null;
  return { ok: true, eventRepaired: true,
    receipt: { ...verified.receipt, eventRepaired: true, eventRepairedFrom: action.id } };
}

/** M33 X (G01): the claim receipts the action-to-result repair applies to at candidate time. */
const CLAIM_RESULT_FIELDS = Object.freeze(['contradictedBy', 'supportedBy']);

/**
 * M33 X (G01). A proposed claim whose `contradictedBy` or `supportedBy` cites a command's ACTION id with role
 * `observation` — the result quoted under its action's id — with that receipt moved to the action's one result, by the
 * same exact repair a vote gets (`resultReceiptRepair`): only when the session records exactly one result of that
 * action, that result was supplied to this window as an observation, and the quote, untouched, is in it. Only the
 * receipt's `eventId` moves (the role and quote are the model's), so the claim keeps the response contract's shape
 * and is then checked, challenged and grounded like any other. A receipt whose event this window was shown as an
 * observation, or one the repair refuses, is left exactly as proposed. `{ claim, moved }`; never throws.
 */
export function claimResultRepair(session, sourceMap, claim) {
  if (!plain(claim) || sourceMap == null) return { claim, moved: 0 };
  let out = claim, moved = 0;
  for (const field of CLAIM_RESULT_FIELDS) {
    const cited = claim[field];
    if (!plain(cited) || cited.role !== 'observation' || typeof cited.eventId !== 'string') continue;
    const shown = Object.hasOwn(sourceMap, cited.eventId) && Array.isArray(sourceMap[cited.eventId]) ? sourceMap[cited.eventId] : [];
    if (shown.some((source) => source?.role === 'observation')) continue;
    let repaired = null;
    try { repaired = resultReceiptRepair(session, sourceMap, cited); } catch { repaired = null; }
    if (repaired?.ok !== true || typeof repaired.receipt?.eventId !== 'string') continue;
    out = { ...out, [field]: { ...cited, eventId: repaired.receipt.eventId } };
    moved++;
  }
  return { claim: out, moved };
}

/** M33 C: a promise's status (C-06 `PromiseRecord.status`, as code sets it). D71 (S2): and `incomplete`. */
const [PROMISE_OPEN, PROMISE_VERIFIED, PROMISE_INCOMPLETE] = PROMISE_STATUSES;
/** D71 (S2): a promise status's rank when two windows publish one claim — a copy never lowers it (verified above
 *  incomplete above open). */
const PROMISE_RANK = Object.freeze({ [PROMISE_OPEN]: 0, [PROMISE_INCOMPLETE]: 1, [PROMISE_VERIFIED]: 2 });

/**
 * D80 (owner decision 2026-10-12): a support the checker did not uphold leaves a claim's identity. `published` is one
 * window's published claims in publication order, each `{ promise, proposal }`: its PromiseRecord and the claim as the
 * window's answer proposed it (a claim kept although its own check did not settle is published without its proposed
 * basis, so its proposal is read, never the published copy). Two promises neither of which publishes a support receipt
 * (`open` or `incomplete`: none was proposed, or the one proposed was not upheld) are one claim when their claims have
 * one exact identity without the support (`proposalIdentity`: the stated event, role and quote, the contradiction and
 * the resolution, exactly — never the review's paraphrase) and their published stated receipts are the same: the first
 * is kept, with its id, its text and its receipts, and takes the other's flags (`mergedCopy`). A promise with a support
 * receipt (`verified`), one without a proposal, or one whose identity cannot be computed is kept as it came and never
 * merged. `merged` counts the copies merged into an earlier one. Structure only: no word of a claim is read. D78 drops
 * exact repeats before anything is checked (`withoutRepeats`), so the copies merged here differ in the support each
 * proposed, which no check upheld. Pure and deterministic; never throws. A claim D78 left published as two rows is
 * one row.
 */
export function withoutUnupheldRepeats(published) {
  const promises = [], first = new Map();
  let merged = 0;
  for (const entry of Array.isArray(published) ? published : []) {
    const promise = entry?.promise;
    const key = unupheldIdentity(promise, entry?.proposal);
    const at = key === null ? undefined : first.get(key);
    if (at === undefined) {
      if (key !== null) first.set(key, promises.length);
      promises.push(promise);
      continue;
    }
    promises[at] = mergedCopy(promises[at], promise);
    merged++;
  }
  return { promises, merged };
}

/** D80: the identity a published claim with no support receipt has (`withoutUnupheldRepeats`), or null. */
function unupheldIdentity(promise, proposal) {
  try {
    if (!plain(promise) || !plain(promise.stated) || !plain(proposal)
        || ![PROMISE_OPEN, PROMISE_INCOMPLETE].includes(promise.status)) return null;
    const { supportedBy: _notUpheld, ...claim } = proposal;
    const identity = proposalIdentity('claims', claim, {});
    return identity === null ? null : JSON.stringify([identity, receiptProjection(promise.stated)]);
  } catch { return null; }
}

/**
 * D80: the kept promise `kept` with what its copy `copy` adds — `assumption` when either copy is marked one, and
 * `restsOn` the union of their ids (the kept copy's first). The status is the one those flags give a claim with no
 * support receipt: `incomplete` when it rests on any action whose check never completed, else `open`, so a copy never
 * lowers it (C-06: a copy across windows never does either). A `reason` (a copy kept although its own check did not
 * settle, S6) is the kept copy's own, whatever the other copy's check found: the row shows the kept copy's text, the
 * one that check did not settle (the review of D80 M). It stays while the claim is `open`; an `incomplete` claim
 * carries none, as S6 publishes a claim with a reason only `open`. Its id, stated receipt, text and receipts are the
 * kept copy's. Pure.
 */
function mergedCopy(kept, copy) {
  const ids = (promise) => (Array.isArray(promise?.restsOn) ? promise.restsOn : []);
  const restsOn = [...new Set([...ids(kept), ...ids(copy)])];
  const assumption = kept.assumption === true || copy?.assumption === true;
  const status = restsOn.length ? PROMISE_INCOMPLETE : PROMISE_OPEN;
  const reason = status === PROMISE_OPEN ? kept.reason : undefined;
  const { restsOn: _restsOn, assumption: _assumption, reason: _reason, ...rest } = kept;
  return { ...rest, status, ...(restsOn.length ? { restsOn } : {}), ...(assumption ? { assumption: true } : {}),
    ...(reason !== undefined ? { reason } : {}) };
}

/**
 * `supports` (M33 C): for each surviving claim whose `supportedBy` passed every code check (`supportCheck`) and
 * whose own support item was then upheld by the challenge, that support's grounded receipt, keyed by the claim
 * object: its promise is `verified`. `{ sourceMap, until }` (D80): what the window showed and its end (D59), against
 * which a pivot's receipts are checked for a quote only in a write that may not have happened. D80: `claimsMerged`
 * counts the published copies of a claim merged into an earlier one (`withoutUnupheldRepeats`).
 */
function groundedExtras(session, narrative, repo = null, supports = null, checklist = null,
  { sourceMap = null, until = null } = {}) {
  const pivots = [], requirements = [], promises = [], published = [];
  let pivotsRejected = 0, requirementsRejected = 0, claimsRejected = 0, pivotsRepaired = 0;
  let pivotsWithheld = 0, requirementsWithheld = 0, claimsWithheld = 0;
  const safely = (check) => { try { return check(); } catch { return UNREAD; } };
  for (const pivot of narrative?.pivots ?? []) {
    const outcome = safely(() => {
      if (typeof pivot.abandoned !== 'string' || typeof pivot.adopted !== 'string'
          || !Array.isArray(pivot.receipts) || !pivot.receipts.length) return UNREAD;
      const { verified, rejected, repaired } = verifyReceipts(session, pivot.receipts);
      if (rejected.length || !verified.length) return WITHHELD;
      // D80 (review of D80 Q): a pivot one of whose receipts quotes only the body of a write the slicer parsed from a
      // command that did not run, failed or stopped before it finished (ledger.js `unrunEnd`, `quotesOnlyUnrunWrite`)
      // is withheld, as one whose quote did not match: a write that may not have happened cannot show a change of
      // approach was adopted.
      if (verified.some((receipt) => quotesOnlyUnrunWrite(session, receipt, { sourceMap, until }))) return WITHHELD;
      pivots.push({ ...pivot, receipts: verified });
      // F44: `verifyReceipts` has always reported how many quotes it had to snap to their exact
      // source substring; this caller was throwing the number away, so a pivot repair the reader
      // can see in the published quote was counted nowhere. Only a PUBLISHED pivot counts.
      pivotsRepaired += Number.isSafeInteger(repaired) ? repaired : 0;
      return null;
    });
    if (outcome) pivotsRejected++;
    if (outcome === WITHHELD) pivotsWithheld++;
  }
  for (const req of narrative?.requirements ?? []) {
    const outcome = safely(() => {
      // D71 (S2): a session-only row reads the checklist's statuses; a combined row the legacy ones (unchanged).
      const statuses = checklist ? REQUIREMENT_STATUSES : LEGACY_REQUIREMENT_STATUSES;
      if (req.instruction?.role !== 'instruction' || typeof req.text !== 'string'
          || !statuses.includes(req.status)) return UNREAD;
      const check = verifyReceipt(session, req.instruction);
      if (!check.ok) return WITHHELD;
      if (!checklist) { requirements.push({ ...req, instruction: check.receipt }); return null; }
      // D71 (S2): the row as code checked it (run-review.js `reviewWindow`, checklist.js `checkedRequirement`):
      // its receipts are the ones that held, grounded again here for their published shape, and the closed reason code
      // lowered it for, when it did.
      const grounded = (receipt) => (plain(receipt) ? verifyReceipt(session, receipt) : { ok: false });
      const deliverable = grounded(req.deliverable), shortfall = grounded(req.shortfall);
      const reason = checklist.requirementReasons.get(req) ?? null;
      requirements.push({ text: req.text, instruction: check.receipt, status: req.status,
        ...(deliverable.ok ? { deliverable: deliverable.receipt } : {}), ...(shortfall.ok ? { shortfall: shortfall.receipt } : {}),
        ...(Array.isArray(req.restsOn) && req.restsOn.length ? { restsOn: [...req.restsOn] } : {}),
        ...(reason ? { reason } : {}) });
      return null;
    });
    if (outcome) requirementsRejected++;
    if (outcome === WITHHELD) requirementsWithheld++;
  }
  for (const claim of narrative?.claims ?? []) {
    const outcome = safely(() => {
      // M33 (I2): an unread claim is never also a finding — `ledgerNarrative` applies the same test.
      if (unreadClaim(claim)) return UNREAD;
      // C-06 (M33): a claim a recorded result contradicts is not an open promise: it is the
      // `claim_contradicted` finding `toCandidates` proposes. M33 (I2): so it is withheld exactly when
      // that finding's receipts are rejected — by the finding's own check (`findingReceiptCheck`: one
      // deterministic near-miss repair per receipt) over the same two receipts, never a stricter one. A
      // quote that grounds only after its snap is the published finding, in no withheld or rejected
      // count (its snap is counted in `receiptsRepaired`, as any finding's is); one that cannot is the
      // ledger's rejected finding row and this one withheld claim. Never both.
      if (claim.contradictedBy)
        return findingReceiptCheck(session, CLAIM_FINDING_KIND, contradictionReceipts(claim),
          { contradiction: claim.contradictedBy.role !== 'observation', until: checklist?.windowEnd ?? null }).ok
          ? null : WITHHELD;
      const stated = verifyReceipt(session, claim.stated);
      if (!stated.ok) return WITHHELD;
      // C-06 (M33): a grounded claim that survived the challenge is published as a PromiseRecord, status
      // `open` — nothing here confirms it was kept. M33 C: `verified` when its support — a result recorded after
      // it that passed every code check — was upheld by its own challenge item, cited beside it.
      const support = supports instanceof Map ? supports.get(claim) ?? null : null;
      // D71 (S2): a session-only claim that cites no contradiction and no support, every one of whose cited actions
      // passed `claimRestsOn` (its own, before it, shown, its check never completed), is `incomplete`: "check did not
      // complete". Every id it refused is counted; a refused one leaves the claim as if it cited none.
      let restsOn = [];
      if (checklist && !support && claim.supportedBy == null && Array.isArray(claim.restsOn) && claim.restsOn.length) {
        const rests = claimRestsOn(session, claim, checklist.sourceMap, checklist.windowEnd);
        if (Object.values(rests.rejected).every((n) => n === 0)) restsOn = rests.accepted;
      }
      // S6 (S5 review H1): a claim kept although its own challenge did not settle — published not checked, with why.
      const reason = checklist ? checklist.claimReasons?.get(claim) ?? null : null;
      const promise = { stated: stated.receipt, text: claim.text,
        status: support ? PROMISE_VERIFIED : restsOn.length ? PROMISE_INCOMPLETE : PROMISE_OPEN,
        receipts: support ? [stated.receipt, support] : [stated.receipt], ...(restsOn.length ? { restsOn } : {}),
        // D71 (S3, owner decision D71 f): the reviewer's mark that the claim is an assumption the agent states and works
        // from — counted so the owner can decide on a section of its own; the claim's status is unchanged by it, and no
        // challenge judges the mark. Present only on a marked session-only claim, so every other promise keeps its bytes.
        ...(checklist && claim.assumption === true ? { assumption: true } : {}), ...(reason ? { reason } : {}) };
      // D80: with the claim as the window's answer proposed it — a claim kept although its own check did not settle is
      // published without its basis (`claimProposals`) — for the merge of copies no support receipt tells apart.
      published.push({ promise: { id: promiseIdentity(repo ?? { host: 'github.com', id: '0' }, promise), ...promise },
        proposal: checklist?.claimProposals?.get(claim) ?? claim });
      return null;
    });
    if (outcome) claimsRejected++;
    if (outcome === WITHHELD) claimsWithheld++;
  }
  // D80 (owner decision 2026-10-12): copies of one claim that differ only in a support no check upheld are one promise.
  const unique = withoutUnupheldRepeats(published);
  promises.push(...unique.promises);
  return { pivots, pivotsRejected, pivotsRepaired, requirements, requirementsRejected,
    claimsRejected, promises, pivotsWithheld, requirementsWithheld, claimsWithheld, claimsMerged: unique.merged };
}

// W3-1. What actually went wrong in one window, in code's own words. Closed vocabularies:
// a shortfall a reader cannot be told about in a fixed sentence has no computable rate, and
// the renderer's phrasebook is keyed on exactly these tokens.
// W3e-6 / F214: `input_invalid` — the judge refused the request before sending it, because its
// transport cannot carry the bytes (`invalid_model_input`). Not `model_unavailable`: nothing was sent.
// W3f-1 / F216: `output_limit` — the reply was longer than the transport's output ceiling
// (`model_output_limit`); `response_incomplete` — the provider stopped before the reply was finished
// (`model_response_incomplete`). The model answered in both; it was not unreachable.
export const NARRATIVE_SHORTFALL = Object.freeze([
  'ok', 'budget', 'model_unavailable', 'no_json', 'schema', 'tool_use', 'input_invalid',
  'output_limit', 'response_incomplete',
]);
export const CHALLENGE_SHORTFALL = Object.freeze([
  'budget_exhausted', 'votes_invalid', 'items_unresolved',
]);
/** W3d-1. How a transport failed, as the transport classified it from an exit status or an
 *  error code — never from anything it printed (B5: its text can carry the prompt or a key).
 *  Recorded as `shortfall.transport`, BESIDE the window's failure: the failure reason stays its
 *  closed token, so per-reason rates stay computable. Frozen here, in the evidence package the
 *  CLI transport already depends on, so the transport and the window share one list. */
export const TRANSPORT_SHORTFALL = Object.freeze([
  'timeout', 'exit_nonzero', 'output_limit', 'spawn_failed', 'no_output', 'unknown',
]);

/** The class a failed call carried, or null when it carried none. Outside the list is `unknown`. */
const transportOf = (error) => error?.transportClass == null ? null
  : TRANSPORT_SHORTFALL.includes(error.transportClass) ? error.transportClass : 'unknown';

/** Which shortfall word a window's failure code maps to. `failure` is already a closed set. */
function narrativeShortfall(failure, shape) {
  if (!failure) return 'ok';
  // `unreviewed_scope` is set in exactly one place: a window whose request did not fit.
  if (failure === 'budget_exhausted' || failure === 'unreviewed_scope') return 'budget';
  if (failure === 'model_tool_use') return 'tool_use';
  if (failure === 'model_response_invalid') return shape === 'schema' ? 'schema' : 'no_json';
  if (failure === 'invalid_model_input') return 'input_invalid';
  if (failure === 'model_output_limit') return 'output_limit';
  if (failure === 'model_response_incomplete') return 'response_incomplete';
  return 'model_unavailable';
}

function challengeShortfall(challenge) {
  const votes = (challenge?.results ?? []).flatMap((result) => result.votes ?? []);
  const validVotes = votes.filter((vote) => vote?.valid === true).length;
  const reason = challenge?.complete === true ? null
    : challenge?.budgetExhausted === true ? 'budget_exhausted'
      : votes.some((vote) => vote?.valid !== true) ? 'votes_invalid' : 'items_unresolved';
  // M33 J repair: a tiered window (m33-fast) asked some items three times and others once, so no one
  // pass count describes it: null, and the rendered line states the valid votes without a pass count.
  const passes = challenge?.profile?.tiers !== undefined ? null : challenge?.profile?.passes ?? CHALLENGE_PROFILE.passes;
  return { passes, validVotes, reason };
}

/**
 * W3d-5 / F177. Why one window is incomplete, as closed tokens: one per narrative shortfall a failed
 * call can have, one per half of `groundingComplete`, one per challenge shortfall. Keyed by the
 * closed shortfall words above (asserted equal as sets in test/window-completion-stated.test.js), so
 * no token is ever built from text at the call site and a per-reason rate stays computable.
 */
const NARRATIVE_INCOMPLETE = Object.freeze({ budget: 'narrative:budget', model_unavailable: 'narrative:model_unavailable',
  no_json: 'narrative:no_json', schema: 'narrative:schema', tool_use: 'narrative:tool_use',
  input_invalid: 'narrative:input_invalid', output_limit: 'narrative:output_limit',
  response_incomplete: 'narrative:response_incomplete' });
const GROUNDING_INCOMPLETE = Object.freeze({ session: 'grounding:session', relevance: 'grounding:relevance' });
const CHALLENGE_INCOMPLETE = Object.freeze({ budget_exhausted: 'challenge:budget_exhausted',
  votes_invalid: 'challenge:votes_invalid', items_unresolved: 'challenge:items_unresolved' });
export const WINDOW_INCOMPLETE_REASONS = Object.freeze([...Object.values(NARRATIVE_INCOMPLETE),
  ...Object.values(GROUNDING_INCOMPLETE), ...Object.values(CHALLENGE_INCOMPLETE)]);

/**
 * F177. The recorded reasons one window result is incomplete — derived from the fields its
 * completeness is (`failure === null && groundingComplete && challenge.complete`), not from its
 * `shortfall` alone, so a window is complete exactly when this returns nothing.
 *
 * A failed call is the one cause: an answer never received has no grounding or challenge of its own
 * to fall short, and naming them would blame the evidence for the call — the rule the report's
 * shortfall lines already follow. `shortfall.narrative` is read only to tell a reply outside the
 * response contract from one with no JSON; the failure itself decides that there IS a reason.
 * A record whose `failure` is neither null nor a failure code has no derivable reason; it is
 * incomplete and is counted as unexplained, never guessed at.
 */
export function windowIncompleteReasons(window) {
  const failure = window?.failure;
  if (failure !== null) {
    if (typeof failure !== 'string' || !failure) return [];
    const reason = NARRATIVE_INCOMPLETE[narrativeShortfall(failure, window?.shortfall?.narrative === 'schema' ? 'schema' : null)];
    return reason ? [reason] : [];
  }
  const reasons = [];
  if (window?.groundingComplete !== true) {
    if (window?.sessionGroundingComplete !== true) reasons.push(GROUNDING_INCOMPLETE.session);
    if (window?.relevanceComplete !== true) reasons.push(GROUNDING_INCOMPLETE.relevance);
  }
  if (window?.challenge?.complete !== true) {
    const reason = CHALLENGE_INCOMPLETE[challengeShortfall(window?.challenge).reason];
    if (reason) reasons.push(reason);
  }
  return reasons;
}

/**
 * F177. How many of a review's windows completed, how many fell short for each recorded reason (a
 * window may have more than one), and how many are incomplete with no recorded reason — which must
 * be 0. Tokens and counts only, in the vocabulary's order.
 */
export function windowCompletion(windowResults) {
  const windows = Array.isArray(windowResults) ? windowResults : [];
  const tally = new Map();
  let complete = 0, unexplained = 0;
  for (const window of windows) {
    const reasons = windowIncompleteReasons(window);
    for (const reason of reasons) tally.set(reason, (tally.get(reason) ?? 0) + 1);
    if (window?.failure === null && window.groundingComplete === true && window.challenge?.complete === true) complete++;
    else if (!reasons.length) unexplained++;
  }
  const byReason = Object.fromEntries(WINDOW_INCOMPLETE_REASONS.filter((r) => tally.has(r)).map((r) => [r, tally.get(r)]));
  return { windows: windows.length, complete, byReason, unexplained };
}

/**
 * M33 (C-07). The one word for how a finished window ended, derived exactly as `windowCompletion`
 * counts it: `failed` when its call failed (`failure !== null`), `complete` when it is complete,
 * otherwise `incomplete`. Read off this table, never spelled at a call site.
 */
export const WINDOW_STATES = Object.freeze(['complete', 'incomplete', 'failed']);
/** M33: every value a window's `failure` can hold besides null — a judge failure code, or the one
 *  shortfall this module sets itself for a request too large to send. */
export const WINDOW_FAILURE_CODES = Object.freeze([...JUDGE_FAILURE_CODES, 'unreviewed_scope']);
const [WINDOW_COMPLETE, WINDOW_INCOMPLETE, WINDOW_FAILED] = WINDOW_STATES;
const windowState = (window) => (window?.failure !== null ? WINDOW_FAILED
  : window.groundingComplete === true && window.challenge?.complete === true ? WINDOW_COMPLETE : WINDOW_INCOMPLETE);

/** M33: a run error carries its closed code and no other text (C-07). */
const [IDENTITY_AMBIGUOUS, REVIEW_INTERRUPTED, CHECKPOINT_FAILED] = RUN_FAILURE_CODES;
const runFailure = (code) => Object.assign(new Error(code), { code });

/** A count, or zero: a value that is not a non-negative integer counts nothing. */
const count = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : 0);

/** Every receipt the window's surviving narrative cites, wherever it sits in the shape. `supportChecked` (M33 C):
 *  the claims whose `supportedBy` passed every code check, keyed by the claim object. */
function narrativeReceipts(narrative, supportChecked = null) {
  const found = [];
  const walk = (value) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!plain(value)) return;
    if (typeof value.eventId === 'string' && typeof value.quote === 'string' && typeof value.role === 'string') {
      found.push(value);
      return;
    }
    Object.values(value).forEach(walk);
  };
  // M33: a resolution on a claim no result contradicts is ignored, so it cites nothing here either.
  // A contradicted claim cites its resolution only as the shaped pair (`resolutionShape` reads two
  // fixed levels): a claim's surviving `resolvedBy` was never checked against the response contract
  // (`claimCore`), so it is never walked as it came (H1 fix: no depth reaches the call stack).
  // M33 C: and a claim cites its support only when that support passed every code check (`supportChecked`: so
  // never when a result contradicts the claim), and only as the one shaped receipt (`supportShape`). A support
  // code rejected is counted in `counts.promiseSupport.rejected`, never as a receipt of the window's grounding.
  const claimView = (claim) => {
    if (!plain(claim) || (!Object.hasOwn(claim, 'resolvedBy') && !Object.hasOwn(claim, 'supportedBy'))) return claim;
    const { resolvedBy, supportedBy, ...core } = claim;
    const pair = claim.contradictedBy ? resolutionShape(resolvedBy) : null;
    const support = !claim.contradictedBy && supportChecked instanceof Map && supportChecked.has(claim)
      ? supportShape(supportedBy) : null;
    return { ...core, ...(pair ? { resolvedBy: pair } : {}), ...(support ? { supportedBy: support } : {}) };
  };
  for (const channel of CHANNELS) walk(channel === 'claims' && Array.isArray(narrative?.claims)
    ? narrative.claims.map(claimView) : narrative?.[channel] ?? []);
  return found;
}

/**
 * Ground one window's surviving narrative against the CURRENT session and pull request, and
 * recompute relevance from the current `pr.files`. D60: an answer the judge's cache supplied for
 * the same request bytes is grounded here exactly like a live one — nothing about an answer is
 * ever carried from an earlier review but the answer itself.
 *
 * D59: `upTo` is the window's end (`windowEnd`). Its decisions are checked against the human
 * instructions recorded up to there — the inventory its request carried — so a session that grew
 * after the window grounds the window's answer exactly as before.
 */
function groundNarrative({ session, pr, repo, narrative, upTo = null, sourceMap = null, resolutionOutcomes = null,
  supports = null, supportChecked = null, forbiddenFindings = [], checklist = null }) {
  let decisions = [], findings = [], invalid = false;
  // M33 (I2): a claim `groundedExtras` counts as unread is not also grounded as a finding.
  try { ({ decisions, findings } = narrative ? toCandidates(ledgerNarrative(narrative), session, { sourceMap, resolutionOutcomes })
    : { decisions, findings }); }
  catch { invalid = true; decisions = []; findings = []; }
  // M33 N: and the finding candidates of the window's upheld forbidden edits (code-built, run-review.js), after its claims'.
  if (!invalid && narrative) findings = [...findings, ...forbiddenFindings];
  const effective = invalid ? null : narrative;
  // D71 (d): a session-only window (`checklist`) admits a choice not to act anchored on the agent's words.
  // D83 (3): and a decision whose cited actions are all the agent's housekeeping is not listed (`housekeeping`).
  // D84: and "made without asking you" also checks the project instruction files its window showed.
  const grounded = buildLedger({ repo, session, pr, candidates: decisions, findingCandidates: findings, upTo,
    notActing: checklist !== null, housekeeping: checklist !== null, projectFilesShown: checklist !== null });
  const extras = groundedExtras(session, effective, repo, supports, checklist ? { ...checklist, sourceMap, windowEnd: upTo }
    : null, { sourceMap, until: upTo });
  const cited = verifyReceipts(session, narrativeReceipts(effective, supportChecked));
  // Every part of the narrative's grounding that is a fact about the SESSION, not about the PR.
  // D58 (W3d-3): grounding RAN on a valid narrative. A proposal whose quote did not match the
  // record is withheld and counted (`withheld`), and so (M33 G4, C-06) is a decision whose cited
  // actions resolve to more than one actor, or to none (`ambiguous_authority` with the cause
  // `actor_ambiguous`); a published decision whose column or value could not be determined shows its
  // own UNCHECKED cell (`uncheckedColumns`, `uncheckedValues`). Those checks ran and were
  // inconclusive, so they do not make this false. A proposal no check could evaluate (malformed,
  // rated, citing no action, naming another actor than its actions resolve to) still does — the
  // same rule (`withheldRejection`, `readingCaps`) `buildLedger` applies.
  const capping = (rejection) => !withheldRejection(rejection);
  const sessionGrounded = effective !== null
    && !grounded.rejectedDecisions.some(capping) && !grounded.rejectedFindings.some(capping)
    && extras.pivotsRejected === extras.pivotsWithheld
    && extras.requirementsRejected === extras.requirementsWithheld
    && extras.claimsRejected === extras.claimsWithheld;
  // Counted once per proposal: every withheld decision (a quote that did not match, or an ambiguous
  // actor) and every withheld pivot, requirement and claim. A session finding here is a contradicted
  // claim (`toCandidates`), already counted as the claim, so findings are not counted a second time.
  const withheld = grounded.rejectedDecisions.filter(withheldRejection).length
    + extras.pivotsWithheld + extras.requirementsWithheld + extras.claimsWithheld;
  return { invalid, decisions, findings, grounded, extras, cited, sessionGrounded, withheld };
}

/**
 * How many windows are reviewed at the same time (W3-7). A frozen literal, like every other
 * constant here: no per-repo tuning, no adaptive ramp. M33 J: it is the standard speed profile's
 * `windowConcurrency` (review-profiles.js); a review run under another named profile takes that
 * profile's lanes instead.
 *
 * A 20-file pull request used to cost 59 minutes because window n+1's prompt waited for window
 * n's grounded output. It no longer receives it — its carried context (windows.js) is computed from the
 * recording alone — so the only thing the
 * sequence bought was a reconciliation `mergeWindowOutputs` performs by identity at the merge.
 *
 * Each window still runs its own challenge pass at `CHALLENGE_PROFILE.maxConcurrency`, so one
 * review has at most WINDOW_CONCURRENCY x CHALLENGE_PROFILE.maxConcurrency calls in flight.
 * That bound is declared in `report.instrument.maxCallsInFlight`.
 */
export const WINDOW_CONCURRENCY = REVIEW_SPEED_PROFILES.standard.windowConcurrency;

/**
 * Phase B. Reconcile what the windows produced, IN WINDOW ORDER, by identity — exactly the
 * reconciliation the carried-over context used to perform inside the next window's prompt.
 *
 * Window order, not completion order: the reports of two runs of the same session with the same
 * answers must be the same bytes, and completion order is a property of the network.
 *
 * Findings are NOT reconciled here; the ledger merges duplicate findings on its own terms.
 */
export function mergeWindowOutputs({ repo, perWindow }) {
  const decisions = new Map();
  const requirements = new Map(), requirementWindows = new Map();
  const promises = new Map();
  const pivots = new Map();
  const writtenClaims = new Map();
  const findings = [];
  let unkeyed = 0, pivotsMerged = 0;
  // A candidate whose digest cannot be computed is never dropped for it: it keeps a unique key
  // and goes on to the ledger, which rejects it with a stated reason like any other.
  const identify = (candidate) => {
    try { return decisionIdentity(repo, candidate); } catch { return `unkeyed:${unkeyed++}`; }
  };
  for (const window of perWindow ?? []) {
    // Two windows that proposed the same decision proposed ONE decision. The earlier window's
    // row is the one published, with its receipts: the digest already fixes the dimension,
    // value, actions and stated receipt, so a later copy adds nothing a reader can act on.
    // S6 (S5 review H1): except that a copy a window kept although its own check did not settle (CHALLENGE_ENDED: it
    // publishes "could not tell") gives way to a later copy whose check upheld it — a copy never lowers a decision.
    for (const candidate of window?.decisions ?? []) {
      const key = identify(candidate);
      const prior = decisions.get(key);
      if (prior === undefined || (prior?.[CHALLENGE_ENDED] !== undefined && candidate?.[CHALLENGE_ENDED] === undefined))
        decisions.set(key, candidate);
    }
    findings.push(...(window?.findings ?? []));
    // Silence or a failed window does not close an earlier requirement, and a LATER window's
    // grounded status for the same instruction+requirement replaces the earlier one — the rule
    // the carried context enforced while it was still injected into the next prompt. A Map keeps
    // the row where it was first seen and takes the newest grounded value, so the reconciliation
    // is the same whichever order the answers arrived in.
    // D71 (S2): a checklist row (a session-only review's statuses) is keyed by its instruction and
    // its GROUNDED instruction quote — the session's own bytes, never the model's prose, so two windows' rows of one ask
    // meet — and a grounded done, partly-done or not-done row is never replaced by not-checked; between two such rows
    // the later window's wins (it saw later work). The window that last reported each row is kept for the end-of-
    // recording fact (`requirementWindows`). A legacy row keeps the old key and rule.
    for (const requirement of window?.requirements ?? []) {
      if (!REQUIREMENT_STATUSES.includes(requirement?.status)) {
        requirements.set(JSON.stringify([requirement.instruction?.eventId ?? null, requirement.text]), requirement);
        continue;
      }
      const key = JSON.stringify(['checklist', requirement.instruction?.eventId ?? null,
        requirement.codeMade === true ? null : requirement.instruction?.quote ?? null]);
      const prior = requirements.get(key);
      const keeps = prior && prior.status !== 'not-checked' && requirement.status === 'not-checked';
      if (!keeps) requirements.set(key, requirement);
      requirementWindows.set(key, window?.window?.index ?? null);
    }
    // C-06: one promise per row identity. A promise without one (a caller's own shape) keeps the
    // earlier receipt-and-text key. M33 C: a later copy replaces an earlier one, as always, except that a
    // `verified` promise is never lowered by a copy that is not: its status only rises. Order-free.
    // D71 (S2): `incomplete` ranks between them (PROMISE_RANK): a copy never lowers a promise's status.
    for (const promise of window?.promises ?? []) {
      const key = typeof promise?.id === 'string' ? promise.id
        : JSON.stringify([promise.receipts?.[0]?.eventId ?? null, promise.text]);
      const prior = promises.get(key);
      // S6 (S5 review H1): nor does a copy kept although its own check did not settle (`reason`) replace one of the same
      // status whose check upheld it.
      const rank = (p) => PROMISE_RANK[p?.status] ?? 0;
      const lowers = prior !== undefined && (rank(prior) > rank(promise)
        || (rank(prior) === rank(promise) && prior?.reason === undefined && promise?.reason !== undefined));
      if (!lowers) promises.set(key, promise);
    }
    // F73: two windows that both saw the whole instruction inventory can legitimately publish
    // the SAME pivot, exactly like the shared-requirement case above. A later window's row
    // replaces an earlier one for the same reason a later requirement status does: only the
    // carried context used to reconcile this, and windows no longer see each other's answers.
    // F148: identity is the EVIDENCE — the set of (eventId, quote) receipts it grounded on,
    // sorted, so the same evidence cited in another order still collides. `abandoned` and
    // `adopted` are the model's words for the pivot; keyed on them byte for byte, one pivot
    // phrased two ways by two windows was published twice. The quotes are the grounded ones,
    // already snapped to the recorded text, so they compare as the session's own bytes.
    for (const pivot of window?.pivots ?? []) {
      const key = JSON.stringify([...new Set((pivot.receipts ?? [])
        .map((r) => JSON.stringify([r?.eventId ?? null, r?.quote ?? null])))].sort());
      if (pivots.has(key)) pivotsMerged++;
      pivots.set(key, pivot);
    }
    // M33 (C-06 "M33 written statements"): one statement per identity, kept where first seen. A label
    // only ever rises to `contradicted` on a copy whose contradiction code checked and the challenge
    // upheld; a copy that proposed none, or one that was not upheld, never lowers it. Order-free.
    for (const statement of window?.writtenClaims ?? []) {
      const prior = writtenClaims.get(statement.id);
      if (!prior || (prior.label !== WRITTEN_CONTRADICTED && statement.label === WRITTEN_CONTRADICTED))
        writtenClaims.set(statement.id, statement);
    }
  }
  // D71 (S2): code's own row for a message no row of its window cited is dropped once any other window's row cites
  // that message — "the review named no ask from this message" is a fact about the whole review.
  const citedAsks = new Set([...requirements.values()].filter((row) => row?.codeMade !== true)
    .map((row) => row?.instruction?.eventId));
  for (const [key, row] of [...requirements]) if (row?.codeMade === true && citedAsks.has(row.instruction?.eventId)) {
    requirements.delete(key);
    requirementWindows.delete(key);
  }
  return { decisions: [...decisions.values()], findings,
    requirements: [...requirements.values()],
    requirementWindows: [...requirements.keys()].map((key) => requirementWindows.get(key) ?? null),
    promises: [...promises.values()],
    pivots: [...pivots.values()], pivotsMerged, writtenClaims: [...writtenClaims.values()] };
}

/** M33 N: the label suffix of a window's forbidden-edit run (`challenge:wN:forbidden:…`). */
const FORBIDDEN_SUFFIX = ':forbidden';
/** M33 brittleness M4 session route: the label suffix of a window's disclosure run (`challenge:wN:disclosure:…`), as the
 *  combined route's is `challenge:narrative:wN:disclosure:…`. */
const DISCLOSURE_SUFFIX = ':disclosure';

/** M33 J: the label suffix of a tiered window's single-pass run (`challenge:wN:t1:…`), apart from its
 *  three-pass run's (`challenge:wN:…`) — both read as window N's by the CLI (`windowOfLabel`). */
const SINGLE_PASS_SUFFIX = ':t1';
/** M33 C (was M33 J's "decide-bound" contradicted claim): the items a tiered profile asks in its three-pass
 *  run — EVERY claim, with or without contradictedBy or supportedBy: a claim can become a published finding,
 *  a promise, or a verified one. Every other proposal is asked once. */
const threePass = (item) => item.type === 'claim';

/**
 * M33 C event binding (C-05 "M33 vote binding"): the events `ids` name, and one hop from each — a result's
 * invocation, and every recorded result of an invocation. `resultsOf` maps an invocation id to its results' ids.
 * Structure only: no text, quote, order or time is read.
 */
function ownEvents(session, ids, resultsOf) {
  const own = new Set(ids);
  for (const id of ids) {
    const event = session.event(id);
    if (event?.kind === 'observation' && typeof event.invocation === 'string') own.add(event.invocation);
    for (const result of resultsOf.get(id) ?? []) own.add(result);
  }
  return own;
}

/** M33 C: every recorded result's id by the invocation it answers — computed once per window. */
function resultsByInvocation(session) {
  const out = new Map();
  for (const event of Array.isArray(session?.events) ? session.events : [])
    if (event?.kind === 'observation' && typeof event.invocation === 'string')
      out.set(event.invocation, [...(out.get(event.invocation) ?? []), event.id]);
  return out;
}

/** M33 C repair: a claim's support item — its key (the claim's and this suffix, never a channel key), its type,
 *  and the label suffix of the one challenge run a window asks its support items in. */
const SUPPORT_KEY_SUFFIX = ':support';
const SUPPORT_ITEM_TYPE = 'support';

/**
 * M33 C repair (C-06 "M33 claims are facts"): the separate challenge item for a claim's `supportedBy` that
 * passed every code check (`supportCheck`). It shows the challenger the claim and the result said to confirm
 * it, and asks only whether that result confirms it. The claim is its own item, shown exactly as without a
 * support (`claimBare`), so whether the claim is published never depends on its support.
 */
function supportItem(item, verbatim, changedSince = undefined) {
  const claim = item.candidate;
  // M33 C2 repair: shown with its claim's own words as code grounded them (`claimVerbatim`). W3 F1(b): and the
  // in-repository changes recorded since its run (`changedSince`, claims.js), which its request lists in fixed words.
  return { key: `${item.key}${SUPPORT_KEY_SUFFIX}`, type: SUPPORT_ITEM_TYPE, claim, verbatim,
    ...(Array.isArray(changedSince) && changedSince.length ? { changedSince } : {}),
    candidate: { text: claim.text, stated: { ...claim.stated }, supportedBy: supportShape(claim.supportedBy) } };
}

/** The item type of a joint answer's session finding (code-review.js). */
const JOINT_SESSION_FINDING = 'session-finding';

const receiptLike = (value) => plain(value) && typeof value.eventId === 'string' && typeof value.quote === 'string'
  && typeof value.role === 'string';

/**
 * M33 C (C-05 "M33 vote binding"): what a publication-bound item binds a support vote to, or null for an item
 * that cannot publish anything (a decision, a pivot, a requirement, a claim no result contradicts). `results`:
 * the recorded results it cites as its evidence — a contradicted claim's and a written statement's
 * `contradictedBy`, a support's `supportedBy`, a resolution's `resolvedBy.observation`. `statements`: its own
 * words — a contradicted claim's or a written statement's `stated`, a resolution's `resolvedBy.statement`; a
 * support has none, so what the agent said never confirms it. M33 C repair: and the combined route's joint
 * `claim_contradicted` session finding (code-review.js), its observation receipts and its commentary receipts.
 */
function bindingParts(item) {
  const candidate = item?.candidate;
  if (!plain(candidate)) return null;
  if (item.type === JOINT_SESSION_FINDING) return candidate.kind === CLAIM_FINDING_KIND && Array.isArray(candidate.receipts)
    ? { results: candidate.receipts.filter((r) => receiptLike(r) && r.role === 'observation'),
      statements: candidate.receipts.filter((r) => receiptLike(r) && r.role === 'commentary') } : null;
  // M33 N (C-05 "M33 vote binding"): a forbidden edit is publication-bound; its own events are its instruction's and its
  // action's (and, one hop, that action's recorded results).
  if (item.type === FORBIDDEN_EDIT_ITEM_TYPE) return { results: [candidate.violation].filter(receiptLike),
    statements: [candidate.instruction].filter(receiptLike) };
  // M33 brittleness M4 session route: a disclosure binds to its statement's event alone — the combined route's binding
  // (`supportEvents: [statement]`, code-review.js): a vote counts only when it cites the statement.
  if (item.type === DISCLOSURE_ITEM_TYPE) return { results: [], statements: [candidate.statement].filter(receiptLike) };
  // D71 (S2): a checklist requirement (a session-only status) binds through what its status rests on —
  // its deliverable (done), its shortfall (not-done), or both (partly-done) — or its instruction; a claim that rests on
  // actions (`restsOn`) through its stated words or a cited action. W1 h3 (owner decision 2026-10-13): a partly-done row
  // rests on the part that is met and on the part that is not, so a vote citing its shortfall binds as one citing its
  // deliverable does (before, it bound through the deliverable alone, and a vote upholding the row by its shortfall was
  // rejected `support_unbound`).
  if (item.type === 'requirement') {
    if (!['done', 'partly-done', 'not-done'].includes(candidate.status)) return null;
    const evidence = candidate.status === 'not-done' ? [candidate.shortfall]
      : candidate.status === 'partly-done' ? [candidate.deliverable, candidate.shortfall] : [candidate.deliverable];
    return { results: evidence.filter(receiptLike), statements: [candidate.instruction].filter(receiptLike) };
  }
  if (item.type === 'claim' && !candidate.contradictedBy && Array.isArray(candidate.restsOn) && candidate.restsOn.length)
    return { results: [], statements: [candidate.stated].filter(receiptLike),
      actions: candidate.restsOn.filter((id) => typeof id === 'string') };
  // D71 (S3, c): a failure row binds through its response or the RESULT it answers for (and, one hop, that RESULT's ACTION).
  if (item.type === FAILURE_ITEM_TYPE) return { results: [], statements: [candidate.response].filter(receiptLike),
    actions: [candidate.eventId].filter((id) => typeof id === 'string') };
  const parts = item.type === 'claim' ? (candidate.contradictedBy
    ? { results: [candidate.contradictedBy], statements: [candidate.stated] } : null)
    : item.type === SUPPORT_ITEM_TYPE ? { results: [candidate.supportedBy], statements: [] }
      : item.type === 'resolution' ? { results: [candidate.resolvedBy?.observation], statements: [candidate.resolvedBy?.statement] }
        : item.type === WRITTEN_ITEM_TYPE ? { results: [candidate.contradictedBy], statements: [candidate.stated] } : null;
  return parts && { results: parts.results.filter(receiptLike), statements: parts.statements.filter(receiptLike) };
}

/**
 * M33 C event binding (C-05 "M33 vote binding", the coordinator's decision after its second recheck): for one challenge
 * run's items, each publication-bound item's binding by key — the Set of its own events: the events of its
 * results and its own statements (`bindingParts`), and one hop from each (a result's invocation, an invocation's
 * results: `ownEvents`). A not-refuted vote binds to the item when one of its grounded receipts cites one of them
 * (challenge.js `support_unbound` otherwise). Event level only: no quote is read, and nothing another item of the
 * run cites changes an item's binding — every honest vote that cites its own item's result, the command that
 * produced it, or its own statement counts, whatever else it cites and whatever its batch-mates share. An item
 * that cannot publish (a decision, a pivot, a requirement, a claim no result contradicts) is not bound.
 * (M33 C recheck and recheck 2 bound a vote on an event two items share only through a quote within the item's
 * own and within no other's, let a support, resolution or written item bind nothing on words another quoted
 * identically, and voided votes that also cited a batch-mate's evidence as misfiled. Each rule hid honest votes —
 * nested quotes of one result, the same claim restated in a recap, a refutation naming another item's run — and
 * published NO_FINDINGS for true contradictions, while swaps they were built to stop still got through. They are
 * gone.) *Accepted risk:* a key swap between batch-mates that SHARE an event cannot be told from an honest vote
 * by code without hiding honest votes, so it can uphold the wrong item; a swap between items whose events are
 * disjoint can never uphold the item whose events the swapped vote does not cite. A binding that cannot be
 * computed binds nothing (fails closed).
 */
export function bindingsFor(session, list, resultsOf = resultsByInvocation(session)) {
  const out = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    let parts = null;
    try { parts = bindingParts(item); } catch { parts = null; }
    if (!parts) continue;
    const ids = [...parts.results, ...parts.statements].map((receipt) => receipt.eventId).concat(parts.actions ?? []);
    try {
      const events = ownEvents(session, ids, resultsOf);
      const quoted = uncoveredResults(session, parts.results.map((receipt) => receipt.eventId), resultsOf);
      out.set(item.key, quoted.size ? { events, quoted } : events);
    } catch { out.set(item.key, new Set()); }
  }
  return out;
}

/**
 * Status fact (owner decision 2026-10-06; C-05 "M33 vote binding"): of the results an item cites (`ids`: an observation,
 * or an action whose results it names), those whose zero exit status does not cover every command of their line
 * (status-fact.js `statusUncovered`: exactly the results a request states so of). Structure only: no text is read. A
 * support vote on the item then counts only with an observation receipt on one of them (challenge.js `result_unquoted`):
 * where the status is silent, the result's own output, quoted verbatim, is the only evidence of what the line did.
 */
function uncoveredResults(session, ids, resultsOf) {
  const out = new Set();
  for (const id of ids) {
    const event = session.event(id);
    const results = event?.kind === 'observation' ? [id] : event?.kind === 'invocation' ? resultsOf.get(id) ?? [] : [];
    for (const result of results) if (statusUncovered(session.event(result))) out.add(result);
  }
  return out;
}

/** S3: the label suffix of a window's run that checks the new statuses its re-asks gave (`challenge:wN:restatus:…`). */
const RESTATUS_SUFFIX = ':restatus';
/** S1: the label suffix of a window's one whole-window vote on the requirements its dossier check left unsettled. */
const WINDOW_VOTE_SUFFIX = ':window';
const [RESTATUS_BOUND, RESTATUS_NO_ANSWER, RESTATUS_NO_ROW, RESTATUS_UNGROUNDED, RESTATUS_NOT_CHECKED, RESTATUS_SAME]
  = REQUIREMENT_RESTATUS_WITHHELD;

/**
 * S3 (the asks fixes, 2026-10-13; a root-cause analysis: the checking step lowered right statuses to "not
 * checked"). Each session-only requirement the window's challenge refuted (`refuted`, its items as asked) is put to the
 * reviewer once more, before it is lowered: the window's kept request with the row, what each vote that refuted it said
 * and a fixed closing (prompt.js `restatusRequest`), one call per refuted ask, named `<label>:<its index>`. Every
 * re-ask is sent before any answer is read, in the items' order, so a stored answer replays it (D60). Its answer's one
 * readable requirement row whose instruction is the ask's own (the same human message and words, exactly) gives the new
 * status; the ask (`text`, `instruction`) stays the row's own. Code checks it as any row (checklist.js
 * `checkedRequirement`), and it goes on only when it holds, is not not-checked and is not the status the challenge
 * refuted (precision: a refuted "done" is never published "done" on a second answer). Each that goes on is asked as its
 * own item (`ask`, the run the requirement was checked in: its tier, its dossier), and published only when that check
 * upholds it: `restated`, the item's key to the row it publishes. Everything else stays as before the re-ask:
 * not-checked with `challenge_refuted`. `record` counts what happened (REQUIREMENT_RESTATUS_WITHHELD,
 * RESOLUTION_CHALLENGE_OUTCOMES); `challenge` is the check's own record, kept apart from the window's (like a
 * support's: it never makes a window incomplete), or null when nothing was asked. A failed call or check withholds only
 * its own row. Model output is read structurally only; nothing here reads a word of it.
 */
async function restatedRequirements({ refuted, byKey, request, aliases, judge, session, sourceMap, windowEnd: end,
  requestBound, label, ask }) {
  const withheld = zeros(REQUIREMENT_RESTATUS_WITHHELD);
  const challenged = zeros(RESOLUTION_CHALLENGE_OUTCOMES);
  const record = { refuted: refuted.length, asked: 0, withheld, challenged };
  const sent = refuted.map((item) => {
    const refutations = (byKey.get(item.key)?.votes ?? []).filter((vote) => vote?.valid === true
      && vote.verdict === 'refuted');
    const reask = restatusRequest({ request, row: item.candidate, refutations, aliases,
      label: `${label}:${item.key.split(':')[1]}` });
    if (reask === null || !requestFits(reask, requestBound)) return { item, answer: null };
    record.asked++;
    let answer;
    try { answer = Promise.resolve(judge(reask)).catch(() => undefined); }
    catch { answer = Promise.resolve(undefined); }
    return { item, answer };
  });
  const asked = [];
  for (const { item, answer: pending } of sent) {
    if (pending === null) { withheld[RESTATUS_BOUND]++; continue; }
    const answer = await pending;
    if (!narrativeShape(answer, true)) { withheld[RESTATUS_NO_ANSWER]++; continue; }
    // The row for this ask: the one readable row whose instruction is the ask's own — the same human message and the
    // same words, character for character (one message often holds several asks; precision: never another ask's row).
    const own = item.candidate.instruction;
    const rows = answer.requirements.filter((row) => !unreadableIn('requirements', row, SESSION_NARRATIVE_SCHEMA)
      && plain(row.instruction) && row.instruction.eventId === own?.eventId && row.instruction.quote === own?.quote);
    if (rows.length !== 1) { withheld[RESTATUS_NO_ROW]++; continue; }
    const checked = checkedRequirement(session, { ...rows[0], text: item.candidate.text,
      instruction: item.candidate.instruction }, { sourceMap, windowEnd: end });
    if (checked.reason) { withheld[RESTATUS_UNGROUNDED]++; continue; }
    if (checked.candidate.status === REQUIREMENT_STATUSES[3]) { withheld[RESTATUS_NOT_CHECKED]++; continue; }
    if (checked.candidate.status === item.candidate.status) { withheld[RESTATUS_SAME]++; continue; }
    asked.push({ key: `${item.key}${RESTATUS_SUFFIX}`, of: item.key, type: 'requirement',
      candidate: checked.candidate });
  }
  const restated = new Map();
  if (!asked.length) return { restated, record, challenge: null };
  let challenge = null;
  try { challenge = await ask(asked.map(({ key, type, candidate }) => ({ key, type, candidate }))); }
  catch { challenge = null; }
  const ended = new Map((challenge?.results ?? []).map((result) => [result.key, result]));
  for (const entry of asked) {
    const outcome = challengeOutcome(ended.get(entry.key));
    challenged[outcome]++;
    if (outcome === UPHELD) restated.set(entry.of, entry.candidate);
  }
  if (challenge) delete challenge.survivors;
  return { restated, record, challenge };
}

/** W1 A: the label suffix of a window's run that checks whether the agent made each choice the challenge refuted on who
 *  decided it (`challenge:wN:exists:…`), and of the run that checks the new column its re-ask gave
 *  (`challenge:wN:recolumn:…`; the re-ask itself is `narrative:wN:recolumn:K`). */
const EXISTS_SUFFIX = ':exists';
const RECOLUMN_SUFFIX = ':recolumn';
const [RECOLUMN_BOUND, RECOLUMN_NO_ANSWER, RECOLUMN_NO_ROW, RECOLUMN_COULD_NOT_TELL, RECOLUMN_UNGROUNDED, RECOLUMN_SAME]
  = DECISION_RECOLUMN_WITHHELD;
/** W1 A: does a decision proposal say who decided it (a covering receipt, or an instruction review)? */
const filesColumn = (candidate) => plain(candidate) && (plain(candidate.constrainedBy)
  || plain(candidate.instructionReview));
/** W1 A: a decision proposal without who decided it — the choice alone, which its existence check is asked about. */
function withoutColumn(candidate) {
  const { constrainedBy: _column, instructionReview: _review, ...choice } = candidate;
  return choice;
}
/** W1 A: the choice a decision proposal names, apart from who decided it — D79's structure without its instruction
 *  receipt (`decisionStructure`): the set of its actions, its stated receipt and whether it is a choice not to act. Null
 *  when it cannot be read. */
function choiceStructure(candidate) {
  if (!plain(candidate) || !Array.isArray(candidate.actions) || candidate.actions.some((id) => typeof id !== 'string'))
    return null;
  const stated = placingReceipt(candidate.stated);
  return stated === undefined ? null
    : JSON.stringify([[...new Set(candidate.actions)].sort(), stated, candidate.notActing === true]);
}

/**
 * W1 A (owner decision 2026-10-13: a decision refuted only on who decided it was hidden with its choice). A session-only decision the window's challenge refuted that says who decided it (`refuted`:
 * its items as asked, each with a covering receipt or an instruction review) is no longer simply left out:
 *   1. its choice alone (`withoutColumn`) is asked as its own item, in one run (`ask(list, EXISTS_SUFFIX,
 *      existenceBounds)`), on the existence proposition (challenge.js CHECKLIST_PROPOSITIONS `decision`,
 *      `decisionNotActing`). The review of W1 A (2026-10-14): code cannot tell whether the challenge refuted the
 *      attribution or the choice itself, so the item lists what each refuting vote said (REFUTING_VOTES,
 *      `refutingVotesOf`), and the run's bounds (`existenceBounds`) are as many passes as the decision's own check used,
 *      never fewer than the decide tier's, every one of which must uphold it (unanimous), on the whole window's
 *      evidence. A choice that check does not uphold stays out, as any refuted decision: that is not unsure;
 *   2. each choice it upholds is put to the reviewer once more with what each refuting vote said (prompt.js
 *      `recolumnRequest`, one call per decision, named `<label>:<its index>`, every re-ask sent before any answer is
 *      read, so a stored answer replays it, D60). The answer's one readable decision row whose choice is the decision's
 *      own (`choiceStructure`: the same set of actions, stated receipt and notActing) gives a new column: its
 *      constrainedBy or instructionReview, on the decision's own choice (its dimension, what it chose, its value and
 *      receipts stay the decision's), each cited source given its role from the recording (ledger.js
 *      `constraintWithSourceRole`, `reviewWithSourceRoles`). It goes on only when it names one, its column grounds
 *      under code's checks (ledger.js `groundDecision`, as the window grounds its decisions) and is not the column the
 *      challenge refuted (precision: a refuted column is never published on a second answer);
 *   3. each that goes on is asked as its own item (`ask(list, RECOLUMN_SUFFIX)`, the same run), and published with that
 *      column only when that check upholds it.
 * Every other choice step 1 upheld is published "could not tell" with DECISION_COLUMN_REFUTED (CHALLENGE_ENDED). Returns
 * `recolumned`, the item's key to the candidate it publishes; `record`, the counts (DECISION_RECOLUMN_WITHHELD,
 * RESOLUTION_CHALLENGE_OUTCOMES for each check); and the two checks' own records (`existsChallenge`, `challenge`), kept
 * apart from the window's (like a support's: they never make a window incomplete), each null when nothing was asked or
 * its run failed. A failed call or check withholds only its own decision's new column. Model output is read
 * structurally only; nothing here reads a word of it.
 */
async function recolumnedDecisions({ refuted, byKey, request, aliases, judge, session, windowEnd: end, repo, pr,
  requestBound, label, ask, existenceBounds }) {
  const withheld = zeros(DECISION_RECOLUMN_WITHHELD);
  const existence = zeros(RESOLUTION_CHALLENGE_OUTCOMES);
  const challenged = zeros(RESOLUTION_CHALLENGE_OUTCOMES);
  const [REFUTED_MEMBER, EXISTENCE_MEMBER, ASKED_MEMBER, WITHHELD_MEMBER, CHALLENGED_MEMBER] = DECISION_RECOLUMN_RECORD;
  const record = { [REFUTED_MEMBER]: refuted.length, [EXISTENCE_MEMBER]: existence, [ASKED_MEMBER]: 0,
    [WITHHELD_MEMBER]: withheld, [CHALLENGED_MEMBER]: challenged };
  const recolumned = new Map();
  // The column a decision proposal grounds to, as the window's grounding derives it (`groundNarrative`), or null.
  const columnOf = (decision) => {
    try {
      const [candidate] = toCandidates({ decisions: [decision] }, session).decisions;
      const out = groundDecision({ repo, session, pr, candidate, instructionHistoryComplete: true, upTo: end,
        notActing: true, projectFilesShown: true });
      return out.ok && out.decision.columnState === 'grounded' ? out.decision.column : null;
    } catch { return null; }
  };
  const refutationsOf = (item) => (byKey.get(item.key)?.votes ?? []).filter((vote) => vote?.valid === true
    && vote.verdict === 'refuted');
  let existsChallenge = null;
  try {
    existsChallenge = await ask(refuted.map((item) => ({ key: `${item.key}${EXISTS_SUFFIX}`, type: 'decision',
      candidate: { ...withoutColumn(item.candidate), [REFUTING_VOTES]: refutingVotesOf(refutationsOf(item)) } })),
    EXISTS_SUFFIX, existenceBounds);
  } catch { existsChallenge = null; }
  const existsEnded = new Map((existsChallenge?.results ?? []).map((result) => [result.key, result]));
  if (existsChallenge) delete existsChallenge.survivors;
  const made = [];
  for (const item of refuted) {
    const outcome = challengeOutcome(existsEnded.get(`${item.key}${EXISTS_SUFFIX}`));
    existence[outcome]++;
    if (outcome === UPHELD) made.push(item);
  }
  const sent = made.map((item) => {
    const refutations = refutationsOf(item);
    const reask = recolumnRequest({ request, row: item.candidate, refutations, aliases,
      label: `${label}:${item.key.split(':')[1]}` });
    if (reask === null || !requestFits(reask, requestBound)) return { item, answer: null };
    record[ASKED_MEMBER]++;
    let answer;
    try { answer = Promise.resolve(judge(reask)).catch(() => undefined); }
    catch { answer = Promise.resolve(undefined); }
    return { item, answer };
  });
  const asked = [];
  for (const { item, answer: pending } of sent) {
    if (pending === null) { withheld[RECOLUMN_BOUND]++; continue; }
    const answer = await pending;
    if (!narrativeShape(answer, true)) { withheld[RECOLUMN_NO_ANSWER]++; continue; }
    // The row for this decision: the one readable row whose choice is the decision's own (precision: never another
    // choice's row, and two rows for it are none).
    const own = choiceStructure(item.candidate);
    const rows = answer.decisions.filter((row) => !unreadableIn('decisions', row, SESSION_NARRATIVE_SCHEMA)
      && own !== null && choiceStructure(row) === own);
    if (rows.length !== 1) { withheld[RECOLUMN_NO_ROW]++; continue; }
    const [row] = rows;
    if (!plain(row.constrainedBy) && !plain(row.instructionReview)) { withheld[RECOLUMN_COULD_NOT_TELL]++; continue; }
    const candidate = { ...withoutColumn(item.candidate),
      ...(plain(row.constrainedBy) ? { constrainedBy: constraintWithSourceRole(session, row.constrainedBy) } : {}),
      ...(plain(row.instructionReview)
        ? { instructionReview: reviewWithSourceRoles(session, row.instructionReview) } : {}) };
    const column = columnOf(candidate);
    if (column === null) { withheld[RECOLUMN_UNGROUNDED]++; continue; }
    if (column === columnOf(item.candidate)) { withheld[RECOLUMN_SAME]++; continue; }
    asked.push({ key: `${item.key}${RECOLUMN_SUFFIX}`, of: item.key, type: 'decision', candidate });
  }
  let challenge = null;
  if (asked.length) {
    try { challenge = await ask(asked.map(({ key, type, candidate }) => ({ key, type, candidate })), RECOLUMN_SUFFIX); }
    catch { challenge = null; }
    const ended = new Map((challenge?.results ?? []).map((result) => [result.key, result]));
    for (const entry of asked) {
      const outcome = challengeOutcome(ended.get(entry.key));
      challenged[outcome]++;
      if (outcome === UPHELD) recolumned.set(entry.of, entry.candidate);
    }
    if (challenge) delete challenge.survivors;
  }
  for (const item of made)
    if (!recolumned.has(item.key))
      recolumned.set(item.key, { ...item.candidate, [CHALLENGE_ENDED]: DECISION_COLUMN_REFUTED });
  return { recolumned, record, existsChallenge, challenge };
}

/**
 * One window, from its built request to its grounded record. Nothing in here reads or writes
 * anything another window owns, which is what makes running several of them at once safe.
 * M33 J: `profile` is the review's frozen speed profile (review-profiles.js), standard unless named.
 */
/**
 * M36 phase 3 (owner decision D68 Q; C-07 "M36 evidence re-ask"): a session-only window's answer that requests evidence
 * is answered by at most `EVIDENCE_REQUEST_LIMITS.reasks` DETERMINISTIC re-asks — never a conversation. Each is the
 * window's request (its pre-built bytes, the same system and schema) followed by the served section (evidence-requests.js
 * `serveEvidence`: the sorted, de-duplicated requested lines of events the window's request named, capped by the frozen
 * bytes and the window's remaining work budget, every item not served said by a closed reason) and a fixed closing; the
 * same requested set gives the same bytes, so a stored answer replays it with no call (D60). A re-ask that fails or does
 * not answer in the narrative's shape leaves the first answer standing (its failure is not the window's, and is asked
 * again next review: no failure is stored). M36 phase 3 review: an answer in shape never replaces the first — the two
 * are merged (`servedAnswer`): the re-ask's answer, and after it every readable proposal of the first answer that it did
 * not repeat by exact identity (`evidence.fromFirst`), so a proposal the first answer grounded in shown text is never lost
 * because the re-ask left it out (a contradiction is never dropped, M33 X), and the served text only adds or corrects.
 * The re-ask's request and source map — the window's, with every served span appended (C-05) — are the window's from
 * then on: its grounding, its challenges, the report's grounding of what it proposed (a superset of what the first
 * answer was shown, so the first answer's proposals ground as they did). Returns `{ narrative, request, sourceMap,
 * served, evidence }` (`served` the served spans by id, `evidence` the counts; both null when the answer requested
 * nothing).
 */
async function evidenceReask({ narrative, request, sourceMap, session, repo, window, context = null, settings, aliases,
  judge, requestBound }) {
  let asked = requestsOf(narrative);
  if (!asked) return { narrative: withoutRequests(narrative), request, sourceMap, served: null, blocks: null, evidence: null };
  const evidence = emptyEvidenceRecord();
  let current = { narrative, request, sourceMap, served: null, blocks: null };
  let servedRanges = {};
  const budget = Number.isSafeInteger(window?.workBudget) && Number.isSafeInteger(window?.workBytes)
    ? Math.max(0, window.workBudget - window.workBytes) : 0;
  let bytesLeft = Math.min(EVIDENCE_REQUEST_LIMITS.bytes, budget);
  for (let round = 0; asked; round++) {
    if (round >= EVIDENCE_REQUEST_LIMITS.reasks) {
      evidence.requested += asked.length;
      evidence.refused.reask_limit += asked.length;
      break;
    }
    const result = serveEvidence({ session, settings, aliases, sourceMap: current.sourceMap, requests: asked,
      served: servedRanges, maxBytes: bytesLeft });
    addRound(evidence, result.record);
    if (!result.byEvent.size) break;
    // D71 (S2): the re-ask is the window re-rendered — with the frozen alias table, so every name is
    // the first request's — with every line served so far at its event, and the re-ask's own "Now answer".
    const blocks = new Map(current.blocks ?? []);
    for (const [id, list] of result.byEvent) blocks.set(id, [...(blocks.get(id) ?? []), ...list]);
    const rebuilt = buildNarrativePrompt({ session, window, context, settings, aliases, reviewScope: 'session-only',
      served: { byEvent: blocks, notes: result.notes } });
    const reask = { ...current.request, prompt: rebuilt.prompt, evidencePrompt: rebuilt.evidencePrompt,
      label: `${request.label}:evidence${round > 0 ? round + 1 : ''}` };
    if (!requestFits(reask, requestBound)) {
      evidence.refused.request_bound += result.record.served;
      evidence.served -= result.record.served;
      evidence.servedBytes -= result.record.servedBytes;
      break;
    }
    evidence.reasks++;
    let answer = null;
    // A re-ask that fails leaves the first answer standing; its own failure is not the window's.
    try { answer = await judge(reask); } catch { answer = null; }
    if (!narrativeShape(answer, true)) { evidence.reaskFailed = true; break; }
    servedRanges = servedSoFar(servedRanges, result.served);
    bytesLeft -= result.record.servedBytes;
    const servedMap = withServed(current.sourceMap, result.sources);
    // Never replaced by the re-ask: its answer, then every readable proposal of the answer kept so far it did not repeat.
    const merged = servedAnswer({ first: withoutRequests(current.narrative), reask: withoutRequests(answer), session,
      repo, sourceMap: servedMap });
    current = { narrative: merged.narrative, request: reask, sourceMap: servedMap,
      served: withServed(current.served ?? {}, result.sources), blocks };
    evidence.kept = 'merged';
    evidence.fromFirst += merged.fromFirst;
    asked = requestsOf(answer);
  }
  return { narrative: withoutRequests(current.narrative), request: current.request, sourceMap: current.sourceMap,
    served: current.served, blocks: current.blocks, evidence };
}

/** M36 phase 3 (D68 F, critique c6): a claim whose cited contradiction lies in another session than its statement — by
 *  the events' recorded lineage (ledger.js `oneSession`, the check its finding is grounded by). */
function contradictedFromAnotherSession(session, claim) {
  if (!plain(claim) || !plain(claim.contradictedBy) || !plain(claim.stated)) return false;
  const said = session.event(claim.stated.eventId), seen = session.event(claim.contradictedBy.eventId);
  return Boolean(said && seen) && !oneSession(session, [said, seen]);
}

async function reviewWindow({ session, pr, repo, window, request, sourceMap, promptVersion, slice,
  judge, challengeJudge, reviewScope, profile = REVIEW_SPEED_PROFILES.standard, context = null, settings = null,
  aliases = null, backend = undefined, requestBound = requestBoundOf(profile, reviewScope, backend) }) {
  // Gain I (2026-10-13): every check of a window whose request carries images is sent them too — its evidence names
  // them (prompt.js `IMAGES_ATTACHED`) and its scope is the request's. A window that carries none sends its checks as
  // before.
  if (Array.isArray(request?.images) && request.images.length && typeof challengeJudge === 'function') {
    const plainJudge = challengeJudge;
    challengeJudge = (asked) => plainJudge({ ...asked, images: request.images });
  }
  let narrative = null, failure = null, shape = null;
  let transport = null, resolutionOutcomes = null;
  // M33 (C-06 "M33 written statements"): the window's proposed written statements, how many were chat
  // claims reclassified, and the challenge runner the window's own challenge uses.
  let written = [], reclassified = 0, ask = null;
  // M33 (C-06 "M33 per-part verdicts"): whether this window's answer was asked again for an unreadable
  // proposal, whether that re-ask read in full (`reaskedAnswer`), and whether the answer kept still holds one.
  let proposalReasked = false, proposalRecovered = false, proposalUnreadable = false;
  // D78: the copies of a claim already kept that the window's answer held, dropped before anything was checked
  // (`withoutRepeats`), by class — or null when it held none, so every other window's record keeps its bytes.
  let claimRepeats = null;
  // M33 K: a dossier run's bytes beside the whole evidence's (`{ batches, evidenceBytes, dossierBytes }`), or null.
  let dossierRecord = null;
  // S3: what the re-asks of the requirements the challenge refuted came to (`restatedRequirements`), and the record of
  // the run that checked their new statuses — both null when the window's challenge refuted no requirement.
  let restatusRecord = null, restatusChallenge = null;
  // W1 A: what became of the decisions the challenge refuted on who decided them (`recolumnedDecisions`), and the records
  // of the runs that checked their choices and their new columns — each null when the window has none.
  let recolumnRecord = null, recolumnExistsChallenge = null, recolumnChallenge = null;
  // S1: what the one whole-window vote on the requirements the single-pass dossier check left unsettled came to, and
  // that run's record — both null when the window has none (or its profile shows its single pass no dossier).
  let windowVoteRecord = null, windowVoteChallenge = null;
  // M33 C: each support's grounded receipt that passed every code check, keyed by its claim; how many supports
  // were proposed, and why each was not accepted. (M33 C recheck 2: code withholds no claim before its challenge.)
  const supports = new Map();
  const supportsRejected = zeros(SUPPORT_REJECTIONS);
  let supportsProposed = 0;
  // M33 C repair: how each asked support item ended, keyed by its claim, and the record of the one run that asked
  // them (kept apart from `challenge`).
  const supportOutcomes = new Map();
  let supportChallenge = null;
  // W3 (owner decision 2026-10-13): for a session-only window, the in-repository changes recorded since an earlier
  // support's run (claims.js `changedSince`), keyed by its claim, the claims whose support the record says failed
  // (claims.js `failed`), and how each support asked so ended (SUPPORT_ASKED, by RESOLUTION_CHALLENGE_OUTCOMES), counts
  // only.
  const supportChanges = new Map(), supportFailed = new Set();
  const supportsAsked = reviewScope === 'session-only'
    ? Object.fromEntries(SUPPORT_ASKED.map((counter) => [counter, zeros(RESOLUTION_CHALLENGE_OUTCOMES)])) : null;
  // M35 (windowing): the events this window's carried context holds (never its own: earlier human messages and agent
  // thoughts), how many claim receipts were moved from an action's id to its one result (G01), and how many carried
  // statements were proposed again on their own.
  const carried = new Set(carriedIds(context));
  let claimReceiptsMoved = 0, carriedRepeats = 0;
  // M33 N (C-06 "M33 forbidden edits"): the window's proposed edits against a human instruction — each read by code
  // (`readForbiddenEdit`), the ones that passed every check asked in a three-pass run of their own, and the finding
  // candidates of the upheld ones — and their counts (absent from the record when none was proposed).
  let forbiddenRecord = null, forbiddenFindings = [];
  // M33 brittleness M4 session route (owner decision 2026-10-06): what became of the upheld edits' proposed disclosures
  // (`disclosureCounts`, absent from the record when none was proposed) and the record of the one run that asked them
  // (kept apart from `challenge`, like a support's).
  let disclosureRecord = null, disclosureChallenge = null;
  const upTo = windowEnd(window);
  // D71 (S2): the answer contract this window's request carried, and — for a session-only window —
  // the checklist's own records: why code lowered a requirement row to not-checked (keyed by the row object), the
  // `restsOn` ids it refused, the closing message's `notClaims` and coverage (checklist.js).
  const schema = narrativeSchemaOf(reviewScope);
  const unreadable = (item) => unreadableProposal(item, schema);
  // D80: and the claim each claim kept although its own check did not settle (published without its basis) was proposed
  // as, keyed by the published copy, for the merge of copies of one claim (`withoutUnupheldRepeats`).
  const checklist = reviewScope === 'session-only' ? { requirementReasons: new Map(), claimReasons: new Map(),
    claimProposals: new Map(),
    restsOnRejected: { requirements: zeros(RESTS_ON_REJECTIONS), claims: zeros(RESTS_ON_REJECTIONS) },
    [RESTS_ON_REPAIRED]: { requirements: 0, claims: 0 } } : null;
  let notClaimsAnswer, proposedClaims = [];
  // D71 (S3, c): the window's failure rows as code checked them before the challenge (`failuresCheck`), the items asked of
  // them, and how each asked one ended — keyed by its item key.
  let failureRead = null, failureItems = [];
  const failureEnded = new Map();
  // D71 (S3, d, f): how many choices not to act and claims marked as assumptions the window's answer proposed (counted).
  let notActingProposed = 0, assumptionsProposed = 0;
  // M36 phase 2 (critique c4; C-05 "M36 grounding per shown span"): every quote this window's model returned is grounded
  // inside one span the window showed — the session as its source map lists it (`shownSession`), never the event's whole
  // recorded text. Requests are built before this; nothing here changes a request byte.
  // M36 phase 3 review (D68 K, c6): a window holding several sessions grounds a quote exactly so — in a span of the event
  // its receipt cites, which names the session (`verifyReceipt`); packing never changes what a quote grounds in.
  let shownRecord = shownSession(session, sourceMap);
  // M36 phase 3 (D68 Q): what the window's evidence re-ask served (null: nothing), and its counts.
  let served = null, servedBlocks = null, evidence = null, claimsOtherSession = 0;
  const tiered = tieredChallenge(profile);
  let challenge = { complete: false, attemptedCalls: 0, rejected: [], results: [], profile: challengeProfileOf(profile, reviewScope, backend) };
  // Only the transport byte guard is an admission limit: a window whose whole serialized request does not fit is
  // declared `unreviewed_scope`, never clipped. M35: the bound is the review's (`requestBound`: a session-only review's
  // is backend-aware (`requestBoundOf`); a combined review's MAX_REVIEW_INPUT_BYTES).
  if (!requestFits(request, requestBound)) {
    failure = 'unreviewed_scope';
    challenge.budgetExhausted = true;
  }
  else {
    try { narrative = await judge(request); }
    // M77: a declared failure code is reported as itself. Collapsing everything but
    // `budget_exhausted` into `model_unavailable` meant `anthropic_key_missing` — the one a
    // reader can act on — was indistinguishable from the network being down. Unknown codes
    // still default, so the reported set stays closed.
    catch (error) {
      failure = JUDGE_FAILURE_CODES.includes(error?.code) ? error.code : 'model_unavailable';
      transport = transportOf(error);
    }
    // A transport that returned nothing parseable and one that returned the wrong object are
    // different shortfalls with different fixes, so the reader is told which one happened.
    if (!narrativeShape(narrative, reviewScope === 'session-only')) {
      shape = plain(narrative) ? 'schema' : 'absent';
      narrative = null;
      failure ??= 'model_response_invalid';
    }
    // M36 phase 3 (owner decision D68 Q): the answer's evidence requests, served by the deterministic re-ask
    // (`evidenceReask`); the kept answer's request and source map are the window's from here on.
    if (narrative && reviewScope === 'session-only') {
      ({ narrative, request, sourceMap, served, blocks: servedBlocks, evidence } = await evidenceReask({ narrative,
        request, sourceMap, session, repo, window, context, settings, aliases, judge, requestBound }));
      if (served) shownRecord = shownSession(session, sourceMap);
    }
    // M33 (C-06 "M33 per-part verdicts"): an answer holding a proposal code cannot read is asked once
    // more — the identical request, so a memoized judge gives it its next D60 occurrence. Review-WP: the
    // re-ask never replaces the first answer. Every readable proposal of the first answer is kept, and the
    // re-ask only adds its readable proposals that are not already present by exact identity (a decision: by its
    // structure, D79) (`reaskedAnswer`); every item kept is challenged as usual. When the re-ask fails, is no
    // narrative or holds an unreadable proposal itself, the first answer's unreadable proposal stays unread, and only
    // this window's parts read UNCHECKED (`proposal_unreadable`). Bounded by the run profile
    // (`PROPOSAL_REASKS`).
    if (narrative && PROPOSAL_REASKS[reviewScope] > 0
        && (proposalsOf(narrative, session, sourceMap).some(unreadable)
          || forbiddenListOf(narrative).some((item) => !forbiddenShape(item)))) {
      proposalReasked = true;
      let second = null;
      // A second call that fails leaves the first answer standing; its own failure is not the window's.
      try { second = await judge(request); } catch { second = null; }
      ({ narrative, recovered: proposalRecovered } = reaskedAnswer({ first: narrative, second, session, repo, sourceMap }));
    }
    if (narrative) {
      // D78 (owner decision 2026-10-11): exact repeats of a claim are one claim — the kept answer (after both
      // re-asks' merges, which add no paraphrase of a present claim) holds the first copy of each claim and written
      // statement by exact identity (`withoutRepeats`), before anything below reads it: one item per claim.
      const unique = withoutRepeats(narrative, { session, repo, sourceMap, schema });
      narrative = unique.narrative;
      if (unique.repeats.claims || unique.repeats.written) claimRepeats = unique.repeats;
      // M33 (C-06 "M33 written statements"): the written statements are their own class, read apart
      // from the four channels below — including a chat claim that quotes a written body its window was
      // supplied (`writtenChatClaim`).
      const split = splitWritten(narrative, session, sourceMap);
      written = split.written;
      reclassified = split.reclassified;
      const proposed = proposalsOf(narrative, session, sourceMap, split);
      // M33 N: a session-only answer's forbidden edits, read apart from the four channels, each by code before anything is
      // asked: one no check can read (`malformed`) is an unreadable proposal (D58: its window is incomplete); one that
      // fails any other check is withheld and counted by its closed reason; the rest are asked (`forbiddenAsked`).
      const forbiddenProposed = reviewScope === 'session-only' ? forbiddenListOf(narrative) : [];
      const forbiddenReads = forbiddenProposed.map((item, index) => {
        const key = `${FORBIDDEN_CHANNEL}:${index}`;
        let read;
        // W1 B: bounded at the window's end, which bounds the project instruction files its instruction may cite.
        try { read = readForbiddenEdit(item, { session: shownRecord, sourceMap, carried, upTo }); }
        catch { read = { withheld: FORBIDDEN_EDIT_REJECTIONS[0] }; }
        return { key, item, read };
      });
      // M33 N repair: two proposals of one edit (one identity: its two verified receipts) are asked once and counted once;
      // the later ones are `merged` into the first.
      const forbiddenIdentities = new Set();
      let forbiddenMerged = 0;
      const forbiddenAsked = forbiddenReads.filter(({ read }) => read.edit).filter(({ read }) => {
        const identity = forbiddenEditIdentity(read.edit);
        if (forbiddenIdentities.has(identity)) { forbiddenMerged++; return false; }
        forbiddenIdentities.add(identity);
        return true;
      }).map(({ key, read }) => ({ key, edit: read.edit,
        // W1 B: an edit against a project instruction file is asked on the file form (`forbiddenEditProposition`).
        ask: forbiddenChallengeItem(key, read.edit, forbiddenEditProposition(read.edit)) }));
      const forbiddenUnread = forbiddenReads.filter(({ read }) => read.withheld === FORBIDDEN_EDIT_REJECTIONS[0]);
      // M33 X (G01): a readable claim's contradictedBy or supportedBy cited under its command's action id is moved to
      // that action's one supplied result before anything is checked (`claimResultRepair`), and counted.
      for (const item of proposed) {
        if (item.type !== 'claim' || unreadable(item)) continue;
        const { claim, moved } = claimResultRepair(session, sourceMap, item.candidate);
        if (moved) { item.candidate = claim; claimReceiptsMoved += moved; }
      }
      // D71 (S2; owner decision D71 b): each readable session-only requirement's status is checked
      // against its receipts before anything is asked (checklist.js `checkedRequirement`): a status its evidence does not
      // carry is lowered to not-checked with its closed reason — never dropped — and only the receipts that held stay on
      // the row. The closing message's `notClaims` and the answer's claims are kept for coverage.
      if (checklist) {
        notClaimsAnswer = narrative[NOT_CLAIMS_MEMBER];
        // Owner decision D83 (2) on the normal column path: a decision's covering receipt that cites a project
        // instruction file takes that file's role (ledger.js `constraintWithSourceRole`) before anything checks or asks
        // it — which source it is comes from the recording, never from the role the model wrote. D84:
        // and so does each check of its instructionReview that cites one (`reviewWithSourceRoles`), so the challenge's
        // proposition names the files the check covers.
        for (const item of proposed) {
          if (item.type !== 'decision' || unreadable(item) || !plain(item.candidate)) continue;
          const constrainedBy = constraintWithSourceRole(shownRecord, item.candidate.constrainedBy);
          if (constrainedBy !== item.candidate.constrainedBy) item.candidate = { ...item.candidate, constrainedBy };
          const instructionReview = reviewWithSourceRoles(shownRecord, item.candidate.instructionReview);
          if (instructionReview !== item.candidate.instructionReview)
            item.candidate = { ...item.candidate, instructionReview };
        }
        // A claim's `restsOn`, checked before it is asked (checklist.js `claimRestsOn`): kept only when every id it
        // cites passed (its own action, before it, shown, its check never completed); otherwise it is asked and published
        // as if it cited none, and each refused id is counted.
        for (const item of proposed) {
          if (item.type !== 'claim' || unreadable(item) || !plain(item.candidate) || item.candidate.restsOn === undefined) continue;
          const rests = claimRestsOn(shownRecord, item.candidate, sourceMap, upTo);
          for (const [reason, n] of Object.entries(rests.rejected)) checklist.restsOnRejected.claims[reason] += n;
          // W2: a cited RESULT checked as the ACTION the recorder typed it answers (`restsOnCheck`), counted.
          checklist[RESTS_ON_REPAIRED].claims += rests.repaired;
          const { restsOn: _cited, ...rest } = item.candidate;
          item.candidate = Object.values(rests.rejected).every((n) => n === 0) && rests.accepted.length
            ? { ...rest, restsOn: rests.accepted } : rest;
        }
        proposedClaims = proposed.filter((item) => item.type === 'claim' && !unreadable(item)).map((item) => item.candidate);
        for (const item of proposed) {
          if (item.type !== 'requirement' || unreadable(item)) continue;
          const checked = checkedRequirement(shownRecord, item.candidate, { sourceMap, windowEnd: upTo });
          item.candidate = checked.candidate;
          if (checked.reason) checklist.requirementReasons.set(item.candidate, checked.reason);
          for (const [reason, n] of Object.entries(checked.restsOnRejected)) checklist.restsOnRejected.requirements[reason] += n;
          checklist[RESTS_ON_REPAIRED].requirements += checked[RESTS_ON_REPAIRED];
        }
        // D71 (S3, owner decision D71 c): the failure rows, each checked against the RESULTs code listed before anything is
        // asked (checklist.js `failuresCheck`); a row whose handling holds is its own challenge item (`failure`), a
        // not-checked one is never asked (its handling is its step's weakest).
        failureRead = failuresCheck(shownRecord, window, narrative[FAILURES_MEMBER], { sourceMap, windowEnd: upTo });
        notActingProposed = narrative.decisions.filter((decision) => plain(decision) && decision.notActing === true).length;
        assumptionsProposed = proposedClaims.filter((claim) => plain(claim) && claim.assumption === true).length;
        failureItems = failureRead.rows.map((row, index) => ({ row, index }))
          .filter(({ row }) => row.candidate.handling !== FAILURE_NOT_CHECKED)
          .map(({ row, index }) => ({ key: `${FAILURES_MEMBER}:${index}`, type: FAILURE_ITEM_TYPE, candidate: row.candidate }));
      }
      // M33 (C-06): a claim is read without its `resolvedBy` (`claimCore`) — the ledger judges the
      // resolution on its own, and a bad one leaves the contradiction DECIDE instead of unread.
      // M33 C: nor its `supportedBy` (`claimBare`) — a support its window was not shown is a rejected
      // support (`unsupplied`), never a withheld claim.
      // M33 C2 repair (C-06 "M33 the verbatim quote decides"): each readable claim's own words, grounded once by the
      // check its publication applies (`claimVerbatim`), after its receipts were moved above — what its item, its
      // resolution item and its support item are shown as THE claim, or null when they do not ground.
      const verbatimOf = new Map();
      const claimWords = (item) => {
        if (!verbatimOf.has(item)) verbatimOf.set(item, claimVerbatim(shownRecord, sourceMap, item.candidate));
        return verbatimOf.get(item);
      };
      // M36 phase 3 (D68 F, c6): a claim contradicted by a result of another session is withheld before it is asked —
      // that agent never received it (ledger.js `other_session` withholds it at grounding too).
      const crossed = new Set(proposed.filter((item) => item.type === 'claim' && !unreadable(item)
        && contradictedFromAnotherSession(session, item.candidate)).map((item) => item.key));
      claimsOtherSession = crossed.size;
      const reasonFor = (item) => {
        if (unreadable(item)) return 'kind_rejected';
        if (crossed.has(item.key)) return 'receipt_rejected';
        const channel = item.key.split(':')[0];
        const candidate = channel === 'claims' ? claimBare(item.candidate) : item.candidate;
        // M33 X: a decision is adopted by this window's own actions; a carried action is the earlier window's.
        if (channel === 'decisions' && (candidate.actions ?? []).some((id) => carried.has(id))) return 'receipt_rejected';
        return suppliedCandidate(candidate, channel, sourceMap) ? null : 'receipt_rejected';
      };
      // M33 C recheck 2 (C-06 "M33 claims are facts"): every readable claim is put to the challengers. Code withholds
      // none as not a claim: a plan, an intention, a conditional and a contradiction the statement itself disclosed
      // are the challengers' to refute (challenge.js v8), because a claim code withholds is a NONE no challenger can
      // undo. (H3, `sonah.challenge/12`: a hedged or conditional statement about the state or the
      // outcome of the work is a claim; the challengers judge its words as said.)
      let items = proposed.filter((item) => !reasonFor(item));
      const invalid = proposed.filter((item) => !items.includes(item));
      // M33 C: each claim's proposed support, checked by code before it may be asked about (its own item). The
      // contradiction wins over a support (`contradicted`). A claim whose statement does not ground is withheld
      // for its quote, so its support is never judged.
      for (const item of items) {
        const claim = item.candidate;
        if (item.type !== 'claim' || !plain(claim) || claim.supportedBy == null) continue;
        if (!claim.contradictedBy && !verifyReceipt(shownRecord, claim.stated).ok) continue;
        supportsProposed++;
        const checked = supportCheck(shownRecord, claim, sourceMap, { checklist: checklist !== null });
        if (checked.ok) {
          supports.set(claim, checked.receipt);
          if (Array.isArray(checked.changedSince)) supportChanges.set(claim, checked.changedSince);
          // W3 F2: a result the record says failed, asked on the session route (claims.js `failed`).
          if (checked.failed === true) supportFailed.add(claim);
        } else supportsRejected[checked.reason]++;
      }
      // M33 X: a carried statement proposed again as a claim that nothing of this window bears on — no contradiction,
      // and no support that passed every code check — is the earlier window's claim, which that window publishes. It
      // is not asked about or published here (a second promise of one statement), only counted. A carried statement
      // with a contradiction is kept: the merge never softens a DECIDE, and a contradiction is never dropped.
      const repeat = (item) => item.type === 'claim' && plain(item.candidate) && plain(item.candidate.stated)
        && carried.has(item.candidate.stated.eventId) && !item.candidate.contradictedBy && !supports.has(item.candidate);
      carriedRepeats = items.filter(repeat).length;
      if (carriedRepeats) items = items.filter((item) => !repeat(item));
      // M33 C2 repair (C-06 "M33 the verbatim quote decides"): a claim whose own words do not ground by the check its
      // publication applies (`claimWords` null) can never publish — not as a finding, not as a promise — so it is never
      // asked: no challenger is shown words the record does not hold. It goes on, unasked, to the grounding below, which
      // applies that same check, withholds it and counts it exactly as it counts any claim whose quote did not match the
      // record (`claimsWithheld`, a rejected finding `receipt_rejected`, `shortfall.grounding`) — or, for a claim no check
      // can read, as unread — never published, never a refutation, never a gap hidden.
      const unasked = new Set(items.filter((item) => item.type === 'claim' && claimWords(item) === null).map((item) => item.key));
      if (unasked.size) items = items.filter((item) => !unasked.has(item.key));
      // D71 (S2): a not-checked requirement is its step's weakest status — no challenge can make it
      // weaker — so it is never asked; it goes on to grounding, which publishes it when its instruction grounds.
      const uncontested = new Set(checklist ? items.filter((item) => item.type === 'requirement'
        && item.candidate?.status === 'not-checked').map((item) => item.key) : []);
      if (uncontested.size) items = items.filter((item) => !uncontested.has(item.key));
      // W3d-1. A vote's quote gets the one deterministic repair grounding gives every receipt
      // (W3-3): snapped to an exact source substring, or rejected. The snapped quote must still sit in
      // a source of the declared role that THIS window was shown — repair never reaches an event, role
      // or text the challenger did not have.
      // M33 (G3): an action's id cited as an observation may be moved to the action's one supplied
      // result (`resultReceiptRepair`) — the only case this window has no source of the declared role
      // for the cited event that a typed link can resolve without a guess.
      // M33 K: against a given source map — the window's, or a challenge dossier's (what IT showed).
      // D80 (owner decision 2026-10-12): a vote receipt whose quote, as snapped, lies only in the body of a write the
      // slicer parsed from a command that did not run, failed or stopped before it finished (ledger.js `unrunEnd`) —
      // nowhere else that map shows that happened after it, in its session, by the window's end
      // (`quotesOnlyUnrunWrite`) — is refused with its closed cause
      // (UNRUN_WRITE_REASON; challenge.js VOTE_REJECTION_CAUSES), whatever the vote's verdict: a receipt's check never
      // reads its vote's words.
      const verifyAgainst = (shown) => (receipt) => {
        const supplied = (shown[receipt.eventId] ?? []).filter((s) => s.role === receipt.role);
        if (!supplied.length) return resultReceiptRepair(session, shown, receipt) ?? { ok: false };
        const out = repairReceipt(session, receipt);
        if (!out.ok || !supplied.some((s) => s.text.includes(out.receipt.quote))) return { ok: false };
        if (quotesOnlyUnrunWrite(session, out.receipt, { sourceMap: shown, until: upTo }))
          return { ok: false, cause: UNRUN_WRITE_REASON };
        return out;
      };
      const verifyVote = verifyAgainst(sourceMap);
      // M35: every challenge run's request bound is the review's (`requestBound`). The challenge profile's own bound is a
      // combined review's (MAX_REVIEW_INPUT_BYTES), so only a session-only review names one.
      const byteBound = requestBound === CHALLENGE_PROFILE.maxInputBytes ? {} : { maxInputBytes: requestBound };
      // M33 C (C-05 "M33 vote binding"): a support vote on a publication-bound item counts only when one of its
      // receipts is on one of that item's own events (`bindingsFor`: event level only); refutations are not bound.
      const resultsOf = resultsByInvocation(session);
      // One challenge run: its calls carry only the items passed to it, batched together within the
      // challenge profile's item and byte limits. `suffix` names it in every label it sends. M33 J:
      // `bounds` are the run's passes and survival bound when a tiered profile names them; the
      // standard profile passes none, nor a byte bound. M33 C: every run binds its support votes.
      ask = (list, suffix = '', bounds = undefined) => {
        const bindings = bindingsFor(session, list, resultsOf);
        return challengeItems({ items: list, judge: challengeJudge,
          evidence: request.evidencePrompt, labelPrefix: `challenge:w${window.index + 1}${suffix}`, verifyReceipt: verifyVote,
          supportEvents: (item) => bindings.get(item.key) ?? null, aliases, ...byteBound, ...(bounds ?? {}),
          // D71 (S2): a session-only window's challenges judge one proposition per item.
          checklist: reviewScope === 'session-only' });
      };
      // C-06 refreeze: the contradiction and its resolution are SEPARATE items. The claim is shown
      // exactly as without a resolution (`claimCore`), so whether a finding exists never depends on
      // the resolution. A resolution that already passed every code check is its own item; nothing
      // else about it is ever shown to a challenger.
      const resolutions = items.filter((item) => item.type === 'claim')
        .map((item) => resolutionItem(item, { session: shownRecord, pr, repo, sourceMap, verbatim: claimWords(item) })).filter(Boolean);
      // M33 C repair: and without its support (`claimBare`): a support is its own item, asked after its claim.
      // M33 C2 repair: each claim with its own words as code grounded them (`claimWords`), never the model's string.
      // W2 (/32): a claim whose contradiction quotes code carries the source the recorded region holding the quote names
      // (ledger.js `codeContradictionSource`), so its proposition says which text it is; whether it holds is the ledger's.
      const sourceOfCode = (claim) => (plain(claim?.contradictedBy) && claim.contradictedBy.role === 'code'
        ? { contradictionSource: codeContradictionSource(shownRecord, claim.contradictedBy) } : {});
      const challenged = [...items.map((item) => (item.type === 'claim'
        ? { ...item, candidate: claimBare(item.candidate), verbatim: claimWords(item), ...sourceOfCode(item.candidate) }
        : item)),
        // D71 (S3, c): the failure rows whose handling held, asked as other items are (single-pass in a tiered profile).
        ...failureItems];
      // M33 J (tiered challenge, "m33-fast" and "m33-lean"): M33 C: every claim — it can become a published
      // finding, a promise or a verified one — is asked exactly as the standard profile asks every item, in a
      // run of its own; every other item is asked once, in a single-pass run (`:t1`), after it. Each run's
      // re-asks, completeness and counts are its own; merged into one record like the runs below.
      // M33 K ("m33-lean" only): the single-pass run's batches are each shown the cited-evidence dossier of
      // their own items (prompt.js `buildChallengeDossier`), and their votes verified against exactly what
      // it showed. The DECIDE-bound run, rare and high-stakes, keeps the whole window evidence.
      // M35: the window's own carried context, settings and aliases, as its narrative request was built with them.
      // M36 phase 3 (D68 Q): a dossier is shown what the window's re-ask served too, after its own evidence.
      const dossier = (list) => {
        const shown = buildChallengeDossier({ session, window, context, settings, aliases, items: list,
          checklist: reviewScope === 'session-only', served: servedBlocks ? { byEvent: servedBlocks } : null });
        return { evidence: shown.evidencePrompt,
          verifyReceipt: verifyAgainst(served ? withServed(shown.sourceMap, served) : shown.sourceMap) };
      };
      let proposals;
      if (!tiered) proposals = await ask(challenged);
      else {
        const bound = challenged.filter(threePass), once = challenged.filter((item) => !threePass(item));
        const runs = [];
        if (bound.length || !once.length) runs.push(await ask(bound, '', CHALLENGE_TIER_BOUNDS.decide));
        if (once.length) {
          const single = await ask(once, SINGLE_PASS_SUFFIX, dossierChallenge(profile)
            ? { ...CHALLENGE_TIER_BOUNDS.single, dossier } : CHALLENGE_TIER_BOUNDS.single);
          // Numbers only: what the run's sent batches were shown (an oversize one is never sent), beside the whole
          // evidence each would carry.
          if (Array.isArray(single.dossierBytes)) {
            const batches = single.dossierBytes.length;
            dossierRecord = { batches, evidenceBytes: batches * Buffer.byteLength(request.evidencePrompt, 'utf8'),
              dossierBytes: single.dossierBytes.reduce((n, bytes) => n + bytes, 0) };
          }
          delete single.dossierBytes;
          runs.push(single);
        }
        proposals = runs.length === 1 ? runs[0] : mergeChallengeRuns(...runs);
      }
      // H1b: and the window's resolution items are asked in a challenge run of their own, after every
      // proposal's: never in a batch with an ordinary proposal or with the other class (a written
      // statement). batchVotes discards a whole batch pass on one unknown or repeated key, so a
      // resolution sharing a call with its contradiction could cost the contradiction its own votes.
      // Resolution items are batched together within the challenge profile's item and byte limits: a
      // malformed reply voids that pass for every resolution in its batch, and the bounded per-pass
      // re-ask asks those slots again. Merged into one record, so a resolution item that was never voted
      // on is still a check that did not run.
      challenge = resolutions.length
        ? mergeChallengeRuns(proposals, await ask(resolutions.map(({ key, type, candidate, verbatim }) => ({ key, type, candidate,
          verbatim })),
          ':resolution', tiered ? CHALLENGE_TIER_BOUNDS.decide : undefined))
        : proposals;
      // M33 N (C-06 "M33 forbidden edits"): the edits that passed every code check, in a challenge run of their own after
      // every other (`:forbidden`): three passes and two grounded not-refuted votes in every profile, never in a batch
      // with another class. Merged into the window's record: a forbidden-edit slot that never voted leaves the window
      // incomplete, exactly as a claim's. "m33-lean" shows each batch its own dossier — both events whole, every human
      // instruction (the inventory, so every one between them) and the window's whole carried section; M33 N repair: and
      // every human choice an item names between them (`humanChoicesBetween`), whole, with its results.
      if (forbiddenAsked.length) {
        const forbiddenDossier = (list) => {
          const choices = list.flatMap((item) => (Array.isArray(item?.candidate?.humanChoicesBetween)
            ? item.candidate.humanChoicesBetween : []));
          const shown = buildChallengeDossier({ session, window, context, settings, aliases, items: list, wholeCarry: true,
            alsoCited: choices, checklist: reviewScope === 'session-only', served: servedBlocks ? { byEvent: servedBlocks } : null });
          return { evidence: shown.evidencePrompt,
            verifyReceipt: verifyAgainst(served ? withServed(shown.sourceMap, served) : shown.sourceMap) };
        };
        challenge = mergeChallengeRuns(challenge, await ask(forbiddenAsked.map(({ ask: item }) => item), FORBIDDEN_SUFFIX,
          { ...(tiered ? CHALLENGE_TIER_BOUNDS.decide : {}), ...(dossierChallenge(profile) ? { dossier: forbiddenDossier } : {}) }));
      }
      // M33 J: a tiered window's record states the window's challenge profile, tiers included, rather
      // than whichever run happened to be first.
      if (tiered) challenge.profile = challengeProfileOf(profile, reviewScope, backend);
      // D58: a proposal that cites a source this window was never shown (`receipt_rejected`) is
      // a quote that did not match the window's record — withheld and counted, and the window's
      // challenge still ran on everything it could be asked about. A proposal that does not
      // match the response contract (`kind_rejected`) could not be challenged at all: that
      // challenge did not run, and the window stays incomplete, as before.
      const withheldProposals = invalid.filter((item) => reasonFor(item) === 'receipt_rejected').length;
      challenge.withheldProposals = withheldProposals;
      // M33 (C-06 "M33 per-part verdicts"): the answer kept still holds a proposal no check could read.
      proposalUnreadable = invalid.some(unreadable);
      if (invalid.length > withheldProposals) {
        challenge.complete = false;
        challenge.executionComplete = false;
      }
      if (invalid.length) {
        challenge.unresolvedItems += invalid.length;
        challenge.rejected.push(...invalid.map((item) => ({ key: item.key, type: item.type,
          resolved: false, reason: reasonFor(item), ...(crossed.has(item.key) ? { cause: 'other_session' } : {}) })));
        // H1b: a proposal outside the contract is kept only within RECORD_LIMITS; its key, type and
        // reason are what the record says of it either way.
        challenge.results.push(...invalid.map(({ key, type, candidate }) => ({ key, type,
          candidate: recordable(candidate) ? candidate : null,
          survived: false, resolved: false, executionComplete: false, votes: [] })));
      }
      // M33 N: a forbidden edit no check could read is an unreadable proposal (`kind_rejected`, a check that did not run):
      // its window is incomplete and its parts read `proposal_unreadable`, exactly as for the four channels.
      if (forbiddenUnread.length) {
        challenge.complete = false;
        challenge.executionComplete = false;
        challenge.unresolvedItems += forbiddenUnread.length;
        challenge.rejected.push(...forbiddenUnread.map(({ key }) => ({ key, type: FORBIDDEN_EDIT_ITEM_TYPE,
          resolved: false, reason: 'kind_rejected' })));
        challenge.results.push(...forbiddenUnread.map(({ key, item }) => ({ key, type: FORBIDDEN_EDIT_ITEM_TYPE,
          candidate: recordable(item) ? item : null, survived: false, resolved: false, executionComplete: false, votes: [] })));
        proposalUnreadable = true;
      }
      // M33 H repair (C-06 "M33 helper-internal claims"): code's mark on each contradicted claim whose statement is a
      // helper's own, read from the recording now, so a report saved without it reads the same (`markHelperStatements`).
      markHelperStatements(session, challenge);
      // M33 N: code's mark on each forbidden edit whose change code proved undone in the same turn (FYI-bound), and the
      // finding candidate of each one the challengers upheld; every other outcome is counted by its closed word.
      const forbiddenKeys = new Map(forbiddenAsked.map((entry) => [entry.key, entry]));
      const forbiddenOutcomes = Object.fromEntries(RESOLUTION_CHALLENGE_OUTCOMES.map((outcome) => [outcome, 0]));
      const upheldEdits = [];
      for (const result of challenge.results) {
        const entry = result?.type === FORBIDDEN_EDIT_ITEM_TYPE ? forbiddenKeys.get(result.key) : undefined;
        if (!entry) continue;
        if (entry.edit.revertedBy) result[FORBIDDEN_EDIT_REVERTED_MARK] = true;
        const outcome = challengeOutcome(result);
        forbiddenOutcomes[outcome]++;
        if (outcome === UPHELD) upheldEdits.push({ key: entry.key, edit: entry.edit, candidate: forbiddenFindingCandidate(entry.edit) });
      }
      if (forbiddenProposed.length) {
        const tally = (list, reasons, of) => Object.fromEntries(reasons.map((reason) => [reason, list.filter((x) => of(x) === reason).length]));
        forbiddenRecord = { proposed: forbiddenProposed.length,
          withheld: tally(forbiddenReads, FORBIDDEN_EDIT_REJECTIONS, ({ read }) => read.withheld),
          challenged: forbiddenOutcomes,
          reverted: forbiddenAsked.filter(({ edit }) => edit.revertedBy).length,
          // M33 N repair: proposals of an edit already asked (present only when there was one).
          ...(forbiddenMerged ? { merged: forbiddenMerged } : {}) };
      }
      // M33 brittleness M4 session route (owner decision 2026-10-06: "disclosed means FYI" on both routes): each upheld
      // edit's proposed disclosure (its `reportedBy`, the finding candidate's `disclosedBy`) takes the one disclosure step
      // of both routes (challenge.js `disclosureAsks`): code's check, with this window's fact of whether it was shown the
      // statement (`disclosureSupplied`); one that passed is its own item, asked in a run of its own after every other
      // (`:disclosure`) — three passes and two grounded not-refuted votes in every profile, bound to the statement's
      // event, never in a batch with another class, over the window's whole evidence. Its record is kept apart from the
      // window's own, like a support's: a disclosure never makes a window or the review incomplete, and one not upheld
      // (or never asked) leaves its edit DECIDE. Its outcome rides on the candidate as code recorded it.
      const disclosures = disclosureCounts();
      const disclosureAsked = disclosureAsks(upheldEdits.map(({ key, edit, candidate }) => ({ key, candidate,
        supplied: edit.disclosureSupplied })), { repo, session, pr }, disclosures);
      let disclosureEnded = new Map();
      if (disclosureAsked.length) {
        let run = null;
        try { run = await ask(disclosureAsked, DISCLOSURE_SUFFIX, tiered ? CHALLENGE_TIER_BOUNDS.decide : undefined); }
        catch { run = null; }
        if (run) { delete run.survivors; disclosureChallenge = run; }
        disclosureEnded = disclosureOutcomes(disclosureAsked, run?.results, disclosures);
      }
      if (disclosures.proposed > 0) disclosureRecord = disclosures;
      forbiddenFindings = upheldEdits.map(({ key, candidate }) => (disclosureEnded.has(key)
        ? { ...candidate, disclosureChallenge: disclosureEnded.get(key) } : candidate));
      const survivors = new Set(challenge.survivors.map((item) => item.key));
      // M33 C repair (C-06 "M33 claims are facts"): each surviving claim's support that passed every code check is
      // asked as its own item, in one run of its own after every other (`:support`): three passes in every
      // profile, never in a batch with its claim or another class. Its record is kept apart from the window's
      // own, like the written statements': a support check never makes a window or the review incomplete.
      // /30 (5): a claim is verified only when every counted checking vote upholds its result — the run
      // is `unanimous` (challenge.js): one counted vote that does not uphold the support leaves its claim `open`
      // (`unsettled`).
      // W3 F1(b): an earlier support with changes recorded since its run is asked with them listed (`changedSince`).
      const asked = items.filter((item) => item.type === 'claim' && supports.has(item.candidate) && survivors.has(item.key))
        .map((item) => supportItem(item, claimWords(item), supportChanges.get(item.candidate)));
      if (asked.length) {
        try {
          supportChallenge = await ask(asked.map(({ key, type, candidate, verbatim, changedSince }) => ({ key, type,
            candidate, verbatim, ...(changedSince ? { changedSince } : {}) })),
            SUPPORT_KEY_SUFFIX, { ...(tiered ? CHALLENGE_TIER_BOUNDS.decide : {}), unanimous: true });
          const ended = new Map(supportChallenge.results.map((result) => [result.key, result]));
          for (const { key, claim } of asked) supportOutcomes.set(claim, challengeOutcome(ended.get(key)));
          delete supportChallenge.survivors;
        } catch {
          supportChallenge = null;
          for (const { claim } of asked) supportOutcomes.set(claim, UNEXECUTED);
        }
      }
      // C-06 refreeze: how each resolution item ended, for the ledger — keyed by its claim, which the
      // surviving narrative below keeps by reference. A claim with none recorded here was never a
      // resolution item, so the ledger names the code check it failed.
      const byKey = new Map(challenge.results.map((result) => [result.key, result]));
      resolutionOutcomes = new Map(resolutions.map(({ key, claim }) => [claim, challengeOutcome(byKey.get(key))]));
      // D71 (S3, c): how each asked failure row ended (a row not upheld is lowered to not-checked below, never dropped).
      for (const item of failureItems) failureEnded.set(item.key, challengeOutcome(byKey.get(item.key)));
      // S1 (the asks fixes, 2026-10-13): a requirement a profile's single-pass check left unsettled on its
      // dossier — the evidence its own receipts cite, which can lack what settles the ask — gets one vote on the whole
      // window (the evidence the decide tier is shown) before it is lowered: published as proposed when that vote
      // upholds it, and otherwise lowered exactly as before (`challenge_unsettled`). Its record is kept apart, like a
      // support's.
      if (checklist && tiered && dossierChallenge(profile)) {
        const unsettledAsks = items.filter((item) => item.type === 'requirement' && !survivors.has(item.key)
          && plain(item.candidate) && challengeOutcome(byKey.get(item.key)) === UNSETTLED_OUTCOME);
        if (unsettledAsks.length) {
          let run = null;
          try {
            run = await ask(unsettledAsks.map(({ key, type, candidate }) => ({ key, type, candidate })),
              WINDOW_VOTE_SUFFIX, CHALLENGE_TIER_BOUNDS.single);
          } catch { run = null; }
          const ended = new Map((run?.results ?? []).map((result) => [result.key, result]));
          const challenged = zeros(RESOLUTION_CHALLENGE_OUTCOMES);
          for (const item of unsettledAsks) {
            const outcome = challengeOutcome(ended.get(item.key));
            challenged[outcome]++;
            if (outcome === UPHELD) survivors.add(item.key);
          }
          if (run) delete run.survivors;
          windowVoteRecord = { asked: unsettledAsks.length, challenged };
          windowVoteChallenge = run;
        }
      }
      // S3 (the asks fixes, 2026-10-13): each requirement the challenge refuted is put to the reviewer once more,
      // with what the check said (`restatedRequirements`); a new status that holds under code's checks and that its own
      // check, run as the requirement's was (its tier, its dossier), upholds is published in place of the lowered row.
      let restated = new Map();
      const refutedAsks = checklist ? items.filter((item) => item.type === 'requirement' && !survivors.has(item.key)
        && plain(item.candidate) && challengeOutcome(byKey.get(item.key)) === REFUTED_OUTCOME) : [];
      if (refutedAsks.length) {
        const bounds = !tiered ? undefined : dossierChallenge(profile) ? { ...CHALLENGE_TIER_BOUNDS.single, dossier }
          : CHALLENGE_TIER_BOUNDS.single;
        ({ restated, record: restatusRecord, challenge: restatusChallenge } = await restatedRequirements({
          refuted: refutedAsks, byKey, request, aliases, judge, session: shownRecord, sourceMap, windowEnd: upTo,
          requestBound, label: `narrative:w${window.index + 1}${RESTATUS_SUFFIX}`,
          ask: (list) => ask(list, RESTATUS_SUFFIX, bounds) }));
      }
      // W1 A (owner decision 2026-10-13): each decision the challenge refuted that says who decided it is checked on its
      // choice alone, and a choice that check upholds is put to the reviewer once more with what the check said
      // (`recolumnedDecisions`): published with a new column its own check upholds, else "could not tell"
      // (DECISION_COLUMN_REFUTED). The new column's check runs as the decision's did (its tier, its dossier); the review of
      // W1 A: the existence check is shown the refuting votes and is unanimous across as many passes as the decision's
      // own check used, never fewer than the decide tier's, on the whole window. A choice it does not uphold stays out.
      let recolumned = new Map();
      const columnRefuted = checklist ? items.filter((item) => item.type === 'decision' && !survivors.has(item.key)
        && filesColumn(item.candidate) && challengeOutcome(byKey.get(item.key)) === REFUTED_OUTCOME) : [];
      if (columnRefuted.length) {
        const bounds = !tiered ? undefined : dossierChallenge(profile) ? { ...CHALLENGE_TIER_BOUNDS.single, dossier }
          : CHALLENGE_TIER_BOUNDS.single;
        const passes = Math.max((tiered ? CHALLENGE_TIER_BOUNDS.single : CHALLENGE_PROFILE).passes,
          CHALLENGE_TIER_BOUNDS.decide.passes);
        ({ recolumned, record: recolumnRecord, existsChallenge: recolumnExistsChallenge, challenge: recolumnChallenge }
          = await recolumnedDecisions({ refuted: columnRefuted, byKey, request, aliases, judge, session: shownRecord,
            windowEnd: upTo, repo, pr, requestBound, label: `narrative:w${window.index + 1}${RECOLUMN_SUFFIX}`,
            ask: (list, suffix, own = bounds) => ask(list, suffix, own),
            existenceBounds: { passes, requiredSurvivals: passes, unanimous: true } }));
      }
      // D71 (S2; owner decision D71 b): a session-only requirement the challenge did not uphold is KEPT, lowered to
      // not-checked (its receipts dropped: the weakest status needs none), with the closed reason of how its check ended.
      // S6 (S5 review H1): and so is a claim or a decision whose own item ended unsettled or unexecuted — anchored on an
      // exact quote, so (b) keeps it: a claim as `open` (not checked) with none of its proposed basis and the closed
      // reason (PROMISE_UNCHECKED_REASONS), a decision "could not tell" (CHALLENGE_ENDED: ledger.js `groundDecision`
      // derives no column for it). A refuted claim or decision stays out: that is not unsure.
      const lowered = new Map();
      if (checklist) for (const item of items) {
        if (survivors.has(item.key) || !['requirement', 'claim', 'decision'].includes(item.type)) continue;
        const outcome = challengeOutcome(byKey.get(item.key));
        if (item.type === 'requirement') {
          // S3: a refuted row whose re-ask gave a status its own check upheld is published with that status.
          if (restated.has(item.key)) { lowered.set(item.key, restated.get(item.key)); continue; }
          const { deliverable: _deliverable, shortfall: _shortfall, ...rest } = item.candidate;
          const row = { ...rest, status: REQUIREMENT_STATUSES[3] };
          checklist.requirementReasons.set(row, endedAs(outcome, [ASK_REFUTED, ASK_UNSETTLED, ASK_UNEXECUTED]));
          lowered.set(item.key, row);
          continue;
        }
        // W1 A: a decision refuted on who decided it, whose choice its own check upheld: published with the column its
        // re-ask's check upheld, or "could not tell".
        if (item.type === 'decision' && recolumned.has(item.key)) {
          lowered.set(item.key, recolumned.get(item.key));
          continue;
        }
        if (outcome === REFUTED_OUTCOME || !plain(item.candidate)) continue;
        if (item.type === 'claim') {
          const { text, stated, assumption } = item.candidate;
          const claim = { text, stated, ...(assumption === true ? { assumption } : {}) };
          checklist.claimReasons.set(claim, endedAs(outcome, [null, PROMISE_UNSETTLED, PROMISE_UNEXECUTED]));
          checklist.claimProposals.set(claim, item.candidate);
          lowered.set(item.key, claim);
        } else {
          lowered.set(item.key, { ...item.candidate,
            [CHALLENGE_ENDED]: endedAs(outcome, [null, DECISION_UNSETTLED, DECISION_UNEXECUTED]) });
        }
      }
      // M33 C2 repair: with every claim left unasked for words that do not ground, in its place, for grounding to withhold.
      narrative = Object.fromEntries(CHANNELS.map((channel) => [channel, proposed
        .filter((item) => item.key.split(':')[0] === channel && (survivors.has(item.key) || unasked.has(item.key)
          || uncontested.has(item.key) || lowered.has(item.key)))
        .map((item) => lowered.get(item.key) ?? item.candidate)]));
      // The internal utility preserves candidate references for callers; the window record keeps
      // only the explicit narrative plus grounded vote records, avoiding duplicate payloads.
      delete challenge.survivors;
    }
  }

  // M33 C repair: a support makes its claim's promise `verified` only when its own item was upheld; every other
  // outcome of an asked support is counted by its closed word (SUPPORT_REJECTIONS).
  const upheldSupports = new Map();
  for (const [claim, outcome] of supportOutcomes) {
    if (outcome === UPHELD) upheldSupports.set(claim, supports.get(claim));
    else if (Object.hasOwn(supportsRejected, outcome)) supportsRejected[outcome]++;
    // W3: how each support asked with changes listed since its run ended (`staleAsked`).
    if (supportsAsked && supportChanges.has(claim) && Object.hasOwn(supportsAsked[STALE_ASKED], outcome))
      supportsAsked[STALE_ASKED][outcome]++;
    // W3 F2: and each support whose result the record says failed (`failedAsked`).
    if (supportsAsked && supportFailed.has(claim) && Object.hasOwn(supportsAsked[FAILED_ASKED], outcome))
      supportsAsked[FAILED_ASKED][outcome]++;
  }
  const { invalid, decisions, findings, grounded, extras, cited, sessionGrounded, withheld } =
    groundNarrative({ session: shownRecord, pr, repo, narrative, upTo, sourceMap, resolutionOutcomes, supports: upheldSupports,
      supportChecked: supports, forbiddenFindings, checklist });
  if (invalid) { narrative = null; failure ??= 'model_response_invalid'; }
  // D71 (S2): a session-only window whose answer was read — the coverage floor (every human
  // message recorded in the window that no published row cites gets code's own not-checked row, `ask_unreviewed`, in
  // fixed words, so a missing row is never read as "nothing asked"), and the closing message's coverage (its lines
  // inside a proposed claim's grounded quote, the lines an accepted `notClaims` entry lists, and the rest, unreviewed).
  let checklistRecord = null, failureRows = null;
  if (checklist && narrative !== null) {
    const cited = new Set(extras.requirements.map((row) => row.instruction?.eventId));
    let floor = 0;
    for (const ask of windowAsks(window, sourceMap)) {
      if (cited.has(ask.id)) continue;
      extras.requirements.push({ text: REQUIREMENT_UNREVIEWED_TEXT, instruction: { eventId: ask.id, role: 'instruction' },
        status: REQUIREMENT_STATUSES[3], reason: ASK_UNREVIEWED, codeMade: true });
      floor++;
    }
    // D71 (S3, owner decision D71 c): the failures section — every RESULT the window listed gets a row: the answer's, as
    // code checked it and the challenge left it (one not upheld lowered to not-checked with how its check ended), its
    // response grounded again for its published shape; and code's own not-checked row (`failure_unreviewed`) for a listed
    // RESULT the answer gave none, so a missing row is never read as "nothing failed".
    const listed = windowFailures(shownRecord, window);
    // D71 (S4): with the outcome's form and the tool the action named (`tool`, as recorded), so a reader with the report
    // only (the PR comment) can say it, never by a word of the output.
    const outcomeOf = new Map(listed.map(({ event, outcome }) => [event.id, { outcome,
      form: resultOutcome(shownRecord, event).form, action: event.invocation,
      ...(typeof shownRecord.event(event.invocation)?.tool === 'string' ? { tool: shownRecord.event(event.invocation).tool } : {}) }]));
    const fromAnswer = (failureRead?.rows ?? []).map((row, index) => {
      const ended = failureEnded.get(`${FAILURES_MEMBER}:${index}`);
      let reason = row.reason ?? (ended === undefined || ended === UPHELD ? null
        : endedAs(ended, [FAILURE_REFUTED, FAILURE_UNSETTLED, FAILURE_UNEXECUTED]));
      let response = null;
      if (reason === null && row.candidate.handling !== FAILURE_NOT_CHECKED) {
        const check = verifyReceipt(shownRecord, row.candidate.response);
        if (check.ok) response = check.receipt;
        else reason = RESPONSE_UNGROUNDED;
      }
      return { eventId: row.candidate.eventId, ...outcomeOf.get(row.candidate.eventId),
        handling: reason === null ? row.candidate.handling : FAILURE_NOT_CHECKED,
        ...(response ? { response } : {}), ...(reason ? { reason } : {}) };
    });
    const answered = new Set(fromAnswer.map((row) => row.eventId));
    failureRows = [...fromAnswer, ...listed.filter(({ event }) => !answered.has(event.id)).map(({ event }) => ({
      eventId: event.id, ...outcomeOf.get(event.id), handling: FAILURE_NOT_CHECKED, reason: FAILURE_UNREVIEWED,
      codeMade: true }))];
    const notClaims = notClaimsCheck(shownRecord, window, notClaimsAnswer);
    const coverage = closingCoverage(shownRecord, window, proposedClaims, notClaims.accepted);
    const sum = (key) => coverage.reduce((n, c) => n + (key === 'unreviewed' ? c.unreviewed.length : c[key]), 0);
    checklistRecord = {
      requirements: { byStatus: Object.fromEntries(REQUIREMENT_STATUSES.map((status) =>
        [status, extras.requirements.filter((row) => row.status === status).length])),
      reasons: Object.fromEntries(REQUIREMENT_UNCHECKED_REASONS.map((reason) =>
        [reason, extras.requirements.filter((row) => row.reason === reason).length])), floor },
      restsOnRejected: checklist.restsOnRejected, [RESTS_ON_REPAIRED]: checklist[RESTS_ON_REPAIRED],
      promises: { incomplete: extras.promises.filter((p) => p.status === PROMISE_INCOMPLETE).length },
      notClaims: { proposed: Array.isArray(notClaimsAnswer) ? notClaimsAnswer.length : notClaimsAnswer == null ? 0 : 1,
        accepted: [...notClaims.accepted.values()].reduce((n, lines) => n + lines.size, 0), rejected: notClaims.rejected },
      closing: { messages: coverage.length, lines: sum('lines'), covered: sum('covered'), listed: sum('listed'),
        [CLOSING_LINE_UNREVIEWED]: sum('unreviewed'),
        unreviewedLines: coverage.filter((c) => c.unreviewed.length).map((c) => ({ eventId: c.eventId, lines: c.unreviewed })),
        // S6 (S5 review M4): and the lines its accepted `notClaims` lists (no claim covers them), for a reader to show.
        listedLines: coverage.filter((c) => c.listedLines.length).map((c) => ({ eventId: c.eventId, lines: c.listedLines })) },
      // D71 (S3): the new channels, counts only — the failures section (c), the choices not to act (d) and the claims the
      // reviewer marked as assumptions (f) this window's answer proposed.
      failures: { listed: listed.length, byOutcome: Object.fromEntries(FAILURE_OUTCOMES.map((outcome) =>
        [outcome, listed.filter((failure) => failure.outcome === outcome).length])),
      byHandling: Object.fromEntries(FAILURE_HANDLINGS.map((handling) =>
        [handling, failureRows.filter((row) => row.handling === handling).length])),
      reasons: Object.fromEntries(FAILURE_UNCHECKED_REASONS.map((reason) =>
        [reason, failureRows.filter((row) => row.reason === reason).length])),
      rejected: failureRead?.rejected ?? Object.fromEntries(FAILURE_REJECTIONS.map((reason) => [reason, 0])) },
      notActing: { proposed: notActingProposed }, assumptions: { proposed: assumptionsProposed },
    };
  }
  // M33 (C-06 "M33 written statements"): read after the window's own challenge, apart from it. An answer
  // the grounder could not read at all publishes none of them: each is counted as unreadable.
  const writtenResult = invalid || typeof ask !== 'function'
    ? { statements: [], withheld: { ...zeros(WRITTEN_WITHHELD_CAUSES), [WRITTEN_WITHHELD_CAUSES[0]]: written.length },
      contradictionsRejected: zeros(WRITTEN_CONTRADICTION_REJECTIONS), challenge: null }
    : await writtenStatementsOf({ written, session: shownRecord, sourceMap, repo, ask, until: upTo,
      roles: writtenRolesOf(schema),
      bounds: tiered ? CHALLENGE_TIER_BOUNDS.single : undefined });
  const sessionGroundingComplete = sessionGrounded && failure === null;
  const relevanceApplicable = reviewScope !== 'session-only';
  // `relevanceUnchecked` is absent evidence (the decision's own file, or the file list, was only
  // partly supplied), never an inconclusive check: it still leaves grounding incomplete (D58).
  const relevanceComplete = narrative !== null && failure === null
    && (!relevanceApplicable || grounded.decisions.every((d) => d.relevance !== 'unchecked'));
  const groundingComplete = sessionGroundingComplete && relevanceComplete;
  const grounding = {
    // D58: proposals withheld because a quote did not match the record, and (M33 G4) decisions
    // withheld because their cited actions resolve to more than one actor, or to none. Counted,
    // never published.
    withheld,
    rejectedDecisions: grounded.rejectedDecisions.length, rejectedFindings: grounded.rejectedFindings.length,
    uncheckedColumns: grounded.decisions.filter((d) => d.columnState !== 'grounded').length,
    uncheckedValues: grounded.decisions.filter((d) => d.valueState !== 'grounded').length,
    uncheckedRelevance: grounded.decisions.filter((d) => d.relevance === 'unchecked').length,
    relevanceNotApplicable: relevanceApplicable ? 0
      : grounded.decisions.filter((d) => d.relevance === 'unchecked').length,
    pivotsRejected: extras.pivotsRejected, requirementsRejected: extras.requirementsRejected,
    claimsRejected: extras.claimsRejected,
  };

  // W3-1. What this window actually fell short of, counted by this code from the same
  // places `failure`, `challenge` and `groundingComplete` are derived from. `repaired` comes
  // from the verifier when it reports one; until then it is honestly zero.
  // W3d-1: which half of `groundingComplete` fell short. `groundingComplete` is exactly
  // `sessionGrounded && relevanceUnchecked === 0`, so a reader can tell a session quote that did
  // not ground from a decision whose place in the PR could not be checked. `transport` is
  // the closed class of a failed call, or null.
  const shortfall = {
    narrative: narrativeShortfall(failure, shape),
    challenge: challengeShortfall(challenge),
    grounding: { receipts: cited.verified.length + cited.rejected.length,
      verified: cited.verified.length, rejected: cited.rejected.length,
      repaired: Number.isSafeInteger(cited.repaired) ? cited.repaired : 0,
      sessionGrounded: sessionGroundingComplete,
      relevanceUnchecked: relevanceApplicable
        ? grounded.decisions.filter((d) => d.relevance === 'unchecked').length : 0 },
    transport,
  };

  return { window, narrative, failure, decisions, findings, promptVersion, challenge,
    // M36 phase 3: the source map the window's kept answer was shown (its re-ask's, served spans appended: D68 Q), for the
    // report's grounding of what it proposed — never copied into a record (it holds the session's text).
    sourceMap,
    // M36 phase 3, counts only: the window's evidence requests (D68 Q; absent when its answer requested nothing) and the
    // claims withheld for a contradiction from another session (D68 F, c6).
    ...(evidence ? { evidence } : {}), claimsOtherSession,
    // D71 (S2): a session-only window's checklist record — counts, and the closing message's unreviewed line numbers by
    // event (absent on a combined window and when its answer was not read).
    ...(checklistRecord ? { checklist: checklistRecord } : {}),
    // D71 (S3, c): its failures section's rows (absent where the checklist record is).
    ...(failureRows ? { failures: failureRows } : {}),
    proposalReasked, proposalRecovered, proposalUnreadable,
    // D78: counts only, absent when the window's answer held no repeated claim.
    ...(claimRepeats ? { claimRepeats } : {}),
    groundingComplete, sessionGroundingComplete, relevanceApplicable, relevanceComplete, grounding, shortfall,
    placed: slice?.placed ?? [], omitted: slice?.omitted ?? [],
    sourceMapSize: Object.keys(sourceMap).length, ...extras,
    // M33 (C-06 "M33 written statements"): never part of the window's completeness.
    writtenClaims: writtenResult.statements, writtenWithheld: writtenResult.withheld,
    writtenReclassified: reclassified, writtenContradictionsRejected: writtenResult.contradictionsRejected,
    writtenChallenge: writtenResult.challenge, ...(dossierRecord ? { dossier: dossierRecord } : {}),
    // M33 C: never part of the window's completeness — counts only, and the support items' own challenge record.
    supportsProposed, supportsRejected, supportChallenge, ...(supportsAsked ? { supportsAsked } : {}),
    // M33 X: counts only. M35: what the window's carried context held, by count (absent when it carries none).
    claimReceiptsMoved, carriedRepeats, carried: carriedRecord(context),
    // M33 N: counts only, absent when the window's answer proposed no forbidden edit.
    ...(forbiddenRecord ? { forbiddenEdits: forbiddenRecord } : {}),
    // M33 brittleness M4 session route: counts only, and the disclosure items' own challenge record — each absent when
    // no upheld edit of the window proposed one (resp. none was asked), so every other window's record keeps its bytes.
    ...(disclosureRecord ? { disclosures: disclosureRecord } : {}),
    ...(disclosureChallenge ? { disclosureChallenge } : {}),
    // S3: counts only, and the run that checked the re-asked statuses — each absent when the window's challenge refuted
    // no requirement (resp. no new status was asked), so every other window's record keeps its bytes.
    ...(restatusRecord ? { restatus: restatusRecord } : {}), ...(restatusChallenge ? { restatusChallenge } : {}),
    // W1 A: counts only, and the runs that checked the choices and their new columns — each absent when the window's
    // challenge refuted no decision that said who decided it (resp. nothing was asked), so every other window's record
    // keeps its bytes.
    ...(recolumnRecord ? { recolumn: recolumnRecord } : {}),
    ...(recolumnExistsChallenge ? { recolumnExistsChallenge } : {}), ...(recolumnChallenge ? { recolumnChallenge } : {}),
    // S1: counts only, and the whole-window vote's run — each absent when the window had no such requirement.
    ...(windowVoteRecord ? { windowVote: windowVoteRecord } : {}),
    ...(windowVoteChallenge ? { windowVoteChallenge } : {}) };
}

const REVIEW_SCOPES = Object.freeze(['combined', 'session-only']);

/**
 * M33 J: the frozen speed profile a review names (review-profiles.js; nothing is standard). A profile
 * other than standard is a session-only experiment — its tiered challenge is argued for a session-only
 * review, where only a contradicted claim can become a finding, and a code review's diff slices are
 * sized against the standard request bound — so it is refused for any other scope with a RangeError,
 * before anything is planned or called.
 */
function speedProfileFor(speedProfile, reviewScope) {
  const profile = reviewSpeedProfile(speedProfile);
  if (!isStandardProfile(profile) && reviewScope !== 'session-only')
    throw new RangeError('A speed profile other than standard runs a session-only review only');
  return profile;
}

/**
 * M33 (C-07). The frozen profile of a review run: everything besides a request's own bytes that
 * decides what a window's answers mean — the review agent, the prompt version, the narrative
 * schema, the challenge and segmentation profiles, the input bound, the review scope and the
 * closed window and failure vocabularies. Plain, deeply frozen data; the CLI hashes it into a
 * window checkpoint's key. `WINDOW_CONCURRENCY` is not in it: it only schedules (W3-7).
 *
 * M33 J: `speedProfile` names the review's speed profile (review-profiles.js). The standard profile's
 * run profile is exactly the object it always was — no new member, the same digest, the same window
 * checkpoint keys. Any other profile's states its own segmentation, challenge and input bounds, the
 * profile itself and its challenge tiers, so no checkpoint of one profile can be read as another's.
 * `backend` selects Codex's smaller session window settings and complete request bound; other backends retain the
 * existing profile bytes.
 *
 * D87 (owner decisions 2026-10-13/14): a session-only run profile holds the code pass's member (code-pass.js
 * `CODE_PASS_PROFILE`: its versions and closed vocabularies) whether or not a review asks for the pass, so the digest a
 * window checkpoint is keyed by is the same with `--code-pass` and without it. No request byte depends on it.
 */
export function runProfile(reviewScope = 'combined', speedProfile = undefined, backend = undefined) {
  if (!REVIEW_SCOPES.includes(reviewScope)) throw new RangeError('Unknown review scope');
  const profile = speedProfileFor(speedProfile, reviewScope);
  const freeze = (value) => {
    if (value !== null && typeof value === 'object') Object.values(value).forEach(freeze);
    return Object.freeze(value);
  };
  return freeze(structuredClone({
    reviewAgent: reviewAgentProfile(reviewScope).version, promptVersion: PROMPT_VERSION,
    // M33 N: a session-only review's narrative contract holds `forbiddenEdits` (SESSION_NARRATIVE_SCHEMA).
    // M35: the windowing profile (windows.js) replaces the byte-budget segmentation profile, and the carry is gone.
    narrativeSchema: narrativeSchemaOf(reviewScope), challenge: challengeProfileOf(profile, reviewScope, backend),
    windowing: windowingProfileOf(reviewScope, backend), maxInputBytes: requestBoundOf(profile, reviewScope, backend), reviewScope,
    windowIncompleteReasons: WINDOW_INCOMPLETE_REASONS, judgeFailureCodes: JUDGE_FAILURE_CODES,
    // M33 (C-06 "M33 per-part verdicts"): a window's answer can be asked this many more times.
    proposalReasks: PROPOSAL_REASKS[reviewScope],
    // M36 phase 3 (owner decision D68 Q): a session-only window's evidence requests and their frozen bounds.
    ...(reviewScope === 'session-only' ? { evidenceRequests: EVIDENCE_REQUEST_LIMITS, codePass: CODE_PASS_PROFILE } : {}),
    ...(isStandardProfile(profile) ? {} : { speedProfile: profile,
      ...(tieredChallenge(profile) ? { challengeTiers: CHALLENGE_TIER_BOUNDS } : {}) }),
  }));
}

/**
 * M33 (C-07). True when one stored answer could answer two of these planned narrative requests:
 * two narrative requests with the same bytes, or two evidence prompts one of which is a prefix of
 * the other (equal included). A challenge prompt is its window's evidence prompt followed by a
 * fixed separator and its candidates, so prefix-free evidence prompts keep every challenge request
 * of one window distinct from every request of another. Sorted, a prefix sits right before a
 * string that extends it — or before another string that shares it — so neighbours suffice.
 */
export function ambiguousRequestIdentity(requests) {
  const list = Array.isArray(requests) ? requests : [];
  const narratives = new Set(list.map((request) => JSON.stringify([request?.system ?? null, request?.prompt ?? null])));
  if (narratives.size !== list.length) return true;
  if (list.some((request) => typeof request?.evidencePrompt !== 'string')) return true;
  const evidence = list.map((request) => request.evidencePrompt).sort();
  return evidence.some((prompt, at) => at > 0 && prompt.startsWith(evidence[at - 1]));
}

// M33 (F1): each plan `planWindowRequests` returned, bound to the exact inputs it was built from, so
// `runReview` takes a precomputed plan only when it is the one it would build itself. Held weakly:
// no plan and no session is kept alive by it. No file, clock or random source.
const PLANNED = new WeakMap();
// M36 phase 2 review (critique c4; C-05 "M36 grounding per shown span"): each planned window's source map — exactly what
// its request showed — for a caller that holds the window but not its map (code-review.js's joint route, whose judge
// wrapper receives the request and its window). Held weakly, by the planned window object.
const SOURCE_MAPS = new WeakMap();
/** The source map of a window `planWindowRequests` planned, or null for any other window. */
export const plannedSourceMap = (window) => (window !== null && typeof window === 'object' ? SOURCE_MAPS.get(window) ?? null
  : null);
const planInputs = ({ session, pr, diff, windowDiffFor, reviewScope, profile, backend }) =>
  ({ session, pr: pr ?? null, diff: diff ?? null, windowDiffFor: windowDiffFor ?? null, reviewScope, profile,
    settings: windowSettingsOf(reviewScope, backend) });

/** The precomputed plan, when `planWindowRequests` built it from exactly these inputs (the same
 *  session, PR, diff and `windowDiffFor` objects, the same scope and — M33 J — the same speed
 *  profile and resolved window settings); otherwise a TypeError. */
function precomputedPlan(plan, inputs) {
  const bound = plan !== null && typeof plan === 'object' ? PLANNED.get(plan) : undefined;
  const expected = planInputs(inputs);
  if (!bound || Object.keys(expected).some((key) => bound[key] !== expected[key]))
    throw new TypeError('A precomputed plan must be the one planWindowRequests built from these inputs');
  return plan;
}

/** The backend-aware complete request bound, shared with the CLI transport guard. */
export { requestBoundOf } from './review-profiles.js';

/**
 * Phase A, on its own (M33): every window and every narrative request of a review, built from the
 * session (and a code review's `windowDiffFor`) alone, before any judge exists — so no store and no
 * answer can change a request byte. `runReview` runs exactly this; a caller may plan without
 * calling anything, and may hand the plan to `runReview` (`plan`) so it is not built twice.
 * `requests[i]` is `{ window, slice, sourceMap, promptVersion, request, context, settings, aliases }`, and (Gain I)
 * `session`, the session as the window's requests show it, when they carry images (images.js `deliveredView`).
 *
 * M35 (windowing, owner-confirmed spec 2026-10-06; C-07 "M35 windowing"): the windows are windows.js `planWindows` —
 * segments of one session each (a helper's apart from its parent's), packed whole while their work stays within the
 * review's settings (`windowSettingsOf`), an oversized segment cut at the boundaries between thoughts. Each window of a
 * session-only review is built with its carried context (`carriedContext`) and names every event by a per-window alias
 * (`aliasTable`, frozen once the request is built); a combined review's carries nothing and names events by their
 * stable ids. There is no re-cut and no split pair: a window whose request does not fit the review's bound is declared
 * `unreviewed_scope` at review time, never clipped.
 * `backend: codex-cli` selects the smaller session-only settings and complete request bound; an omitted backend keeps
 * the default.
 */
export function planWindowRequests({ session, pr = null, diff = null, windowDiffFor = null, reviewScope = 'combined',
  speedProfile = undefined, backend = undefined }) {
  if (!REVIEW_SCOPES.includes(reviewScope)
      || (reviewScope === 'session-only' && (pr != null || diff != null || windowDiffFor != null)))
    throw new RangeError('Session-only review must have no PR, diff or code review');
  const profile = speedProfileFor(speedProfile, reviewScope);
  const agent = reviewAgentProfile(reviewScope);
  const settings = windowSettingsOf(reviewScope, backend);
  const repo = pr?.repo ?? { host: 'github.com', id: '0' };
  // ---- phase A: build every request, then run them with bounded concurrency ------------------
  // Every prompt is built BEFORE any judge is called, which is what makes "no model output
  // travels between windows" a property of the code rather than a promise: at build time there
  // is no model output in this process to carry. The carried context is computed from the session alone.
  const windows = planWindows(session, settings);
  const requestBound = requestBoundOf(profile, reviewScope, backend);
  const requests = windows.map((window) => {
    let context = carriedContext(session, window, settings);
    let aliases = reviewScope === 'session-only' ? aliasTable() : null;
    // Gain I (2026-10-13; C-05 "Gain I"): a session-only window's requests carry the images of every human message
    // recorded up to its end that its backend can send (images.js `requestImages`), and are built — and later grounded
    // — on the session as they show it (`deliveredView`: those messages' loss cleared, their entries saying so). A
    // window that carries none is built on the session itself, byte for byte as before.
    const { images } = reviewScope === 'session-only' ? requestImages(session, windowEnd(window), backend)
      : { images: [] };
    const shown = deliveredView(session, images);
    // F30: the caller decides what slice of the diff this window carries, because only it knows
    // the rest of the request's size. `build` lets it measure a candidate before choosing.
    const build = (parts = {}) => buildNarrativePrompt({ session: shown, window, context, settings, aliases, diff,
      reviewScope, ...parts });
    const slice = typeof windowDiffFor === 'function' ? windowDiffFor({ window, build }) : null;
    let built = slice ? build({ diff: null, hunks: slice.hunks, manifest: slice.manifest }) : build();
    // M36 phase 3 (owner decision D68 F; C-07 "M36 packed windows" 7): a carried context never makes its window
    // unreviewable. While the request is over the review's bound and the context carries a proven failure or an earlier
    // thought, its cap is lowered to the bytes the context USES less the excess (never below the human messages, which
    // are always kept) and the request built again: the oldest carried failures and thoughts are left out first (the
    // context's own drop order, kept as built by D69 d), and the window says how many. A window whose request is over
    // the bound even so keeps its whole carried context (it is declared unreviewed, as always). Deterministic: the same
    // session gives the same requests.
    // D69 review (finding F1): the step is taken from the bytes used, never from the cap. A cap with slack (a context
    // that used less than its cap) lowered by the excess left nothing out while the slack lasted, so the fixed round limit
    // (`CARRIED_FIT_ROUNDS`, 8; deleted) could run out over a window one more left-out failure would have fitted, and
    // declare it unreviewed. Now each round's cap is below what the context used, so every round leaves carried bytes
    // out; the loop ends when the request fits, when only the human messages are carried, or when a round leaves no
    // byte out (only items that show nothing are left) — no round limit.
    const over = (candidate) => reviewInputBytes({ system: agent.systemPrompt, prompt: candidate.prompt }) - requestBound;
    const carries = (candidate) => candidate.failures.length + candidate.thoughts.length
      + (candidate.rideBack ?? []).reduce((n, ride) => n + ride.failures.length, 0) > 0;
    const usedOf = (candidate) => candidate.humanBytes + candidate.failureBytes + candidate.thoughtBytes;
    if (context && !slice && over(built) > 0 && carries(context)) {
      const whole = { context, aliases, built };
      while (over(built) > 0 && carries(context)) {
        const used = usedOf(context);
        context = carriedContext(session, window, settings,
          { capBytes: Math.max(context.humanBytes, used - over(built)) });
        aliases = reviewScope === 'session-only' ? aliasTable() : null;
        built = build();
        if (usedOf(context) >= used) break;
      }
      if (over(built) > 0) ({ context, aliases, built } = whole);
    }
    const { prompt, evidencePrompt, sourceMap, promptVersion } = built;
    aliases?.freeze();
    SOURCE_MAPS.set(window, sourceMap);
    const request = { system: agent.systemPrompt, prompt, schema: narrativeSchemaOf(reviewScope),
      label: `narrative:w${window.index + 1}`, window, evidencePrompt, ...(images.length ? { images } : {}) };
    return { window, slice, sourceMap, promptVersion, request, context, settings, aliases,
      ...(shown !== session ? { session: shown } : {}) };
  });
  const plan = { agent, repo, windows, requests, settings };
  PLANNED.set(plan, planInputs({ session, pr, diff, windowDiffFor, reviewScope, profile, backend }));
  return plan;
}

/**
 * M33 J repair: a FIFO slot limiter for one review's calls. `slots(call, request)` makes the call once
 * fewer than `max` are in flight, in arrival order; a released slot is handed straight to the next
 * waiting call. No clock, no random source; a call never holds a slot while it waits for another.
 */
function callSlots(max) {
  let held = 0;
  const waiting = [];
  return async (call, request) => {
    if (held < max) held++;
    else await new Promise((resolve) => waiting.push(resolve));
    try { return await call(request); } finally {
      const next = waiting.shift();
      if (next) next(); else held--;
    }
  };
}

/**
 * Run the review. `judge` is `async ({system, prompt, schema, label}) => object | null`.
 * A window whose judge call fails is counted, never silently skipped: its scope goes unchecked.
 *
 * M33 (C-07). `signal` (an AbortSignal or null): once it is aborted no window is admitted and no
 * judge call is made; a window that resolves after it is not finished, and the run rejects with
 * `review_interrupted` — a partial attempt is never a report. `onWindowFinished` (async, or null):
 * awaited by the lane that finished a window, before that lane admits another, with only closed
 * codes and counts beside the in-process request (for its answer key, never to persist). If it
 * rejects, no lane admits another window, the windows in flight finish, and the run rejects with
 * `checkpoint_failed`. Neither touches a file, a clock or a random source.
 *
 * `plan` (M33 F1, optional): what `planWindowRequests` returned for exactly these inputs, used in
 * place of building the same plan again. Any other value is refused with a TypeError before any
 * call; null (the default) builds the plan here.
 *
 * `speedProfile` (M33 J, optional): the name of the review's speed profile (review-profiles.js);
 * nothing is the standard profile, byte for byte. It sets the window source budget, the request
 * bound, the window lanes (`concurrency` defaults to, and may not exceed, its `windowConcurrency`)
 * and — for a tiered profile — the challenge tiers. An unknown name is a RangeError before any call.
 */
export async function runReview({ session, pr, diff = null, judge, challengeJudge = judge,
  onProgress = () => {}, windowDiffFor = null, concurrency = undefined,
  reviewScope = 'combined', signal = null, onWindowFinished = null, plan = null, speedProfile = undefined,
  backend = undefined }) {
  const profile = speedProfileFor(speedProfile, reviewScope);
  const lanes = concurrency === undefined ? profile.windowConcurrency : concurrency;
  if (!Number.isSafeInteger(lanes) || lanes < 1 || lanes > profile.windowConcurrency)
    throw new RangeError('Window concurrency must be an integer between 1 and the profile\'s windowConcurrency');
  const { agent, repo, windows, requests } = plan === null
    ? planWindowRequests({ session, pr, diff, windowDiffFor, reviewScope, speedProfile: profile.name, backend })
    : precomputedPlan(plan, { session, pr, diff, windowDiffFor, reviewScope, profile, backend });
  // M33: one stored answer must never be able to answer two planned requests (occurrences are
  // counted per request bytes across the whole review). Refused before any call.
  if (ambiguousRequestIdentity(requests.map((built) => built.request))) throw runFailure(IDENTITY_AMBIGUOUS);
  const perWindow = new Array(windows.length);

  // M33: after an abort, no judge call starts — not a window's next challenge pass or re-ask
  // either. The check is synchronous and the judge is called in the same turn, so nothing is
  // awaited before the wrapped judge assigns its D60 occurrence.
  const aborted = () => signal?.aborted === true;
  // M33 J repair: a review under a profile other than standard holds itself to the profile's
  // `maxCallsInFlight`, narrative and challenge calls together, whatever judge it is handed — so the
  // bound its instrument declares is one it keeps. A call waits for a slot BEFORE the abort check, so a
  // call admitted after an abort is refused exactly as before, in the same turn it would be made.
  // The standard profile has no such limiter: its calls are made exactly as they always were.
  const slots = isStandardProfile(profile) ? null : callSlots(profile.maxCallsInFlight);
  const guarded = (call) => {
    const checked = signal == null || typeof call !== 'function' ? call : (request) => {
      if (aborted()) return Promise.reject(runFailure(REVIEW_INTERRUPTED));
      return call(request);
    };
    return slots === null || typeof checked !== 'function' ? checked : (request) => slots(checked, request);
  };
  const windowJudge = guarded(judge), windowChallengeJudge = guarded(challengeJudge);
  // M35: a session-only window names events by its own aliases; every answer of its calls — its narrative, its re-ask,
  // every challenge vote — is read with each cited id mapped back to the event's stable id (windows.js `mapEventIds`),
  // after the judge (and its answer store) returned it, before anything reads it.
  const unaliased = (call, aliases) => (aliases === null || typeof call !== 'function' ? call
    : async (request) => mapEventIds(await call(request), aliases.stable));
  const requestBound = requestBoundOf(profile, reviewScope, backend);
  let next = 0, finished = 0, hookFailed = false;
  async function lane() {
    while (next < requests.length && !aborted() && !hookFailed) {
      const index = next++;
      const built = requests[index];
      perWindow[index] = await reviewWindow({ session, pr, repo, ...built, judge: unaliased(windowJudge, built.aliases),
        challengeJudge: unaliased(windowChallengeJudge, built.aliases), reviewScope, profile, backend, requestBound });
      // M33: resolved after the abort — not finished, never announced.
      if (aborted()) return;
      if (typeof onWindowFinished === 'function') {
        const result = perWindow[index];
        const reasons = windowIncompleteReasons(result);
        try {
          await onWindowFinished({ window: built.window.index + 1, of: windows.length, finished: ++finished,
            state: windowState(result), reasons: WINDOW_INCOMPLETE_REASONS.filter((r) => reasons.includes(r)),
            failure: result.failure, transport: result.shortfall.transport, request: built.request });
        } catch {
          // The hook's own error text never leaves: the run's code says what happened.
          hookFailed = true;
          return;
        }
      }
      // Announced on COMPLETION, in completion order, once per window: a line printed at
      // dispatch would claim progress three windows at a time that has not happened yet.
      onProgress({ phase: 'narrative', window: built.window.index + 1, of: windows.length,
        bytes: reviewInputBytes(built.request), sourceBytes: built.window.workBytes,
        failure: perWindow[index].failure });
    }
  }
  // A window's transport failure is recorded inside `reviewWindow`, so a lane never rejects on
  // one: the other windows finish, and the failed scope is declared as unchecked.
  await Promise.all(Array.from({ length: Math.min(lanes, requests.length) }, () => lane()));
  if (hookFailed) throw runFailure(CHECKPOINT_FAILED);
  if (aborted()) throw runFailure(REVIEW_INTERRUPTED);

  // ---- phase B: reconcile, in window order --------------------------------------------------
  const merged = mergeWindowOutputs({ repo, perWindow });
  const failed = perWindow.filter((w) => w.failure);
  // Coverage is derived from what THIS code observed, never from an absence. Zero windows, zero
  // actions or zero narratives used to fall through to `null`, which buildLedger then read as
  // "nothing was declared, so it must be complete" — a CLEAN verdict costing zero model calls
  // (audit B4, B12, B13).
  // M35 (windowing): a window holds whole segments, so no action is ever shown apart from its result by a cut and no
  // carried evidence is ever kept out by a request cap: the split-pair and carry-cap gaps are gone with what made them.
  //
  // Gain I (2026-10-13): a human message whose images every window that reached it (its instruction history bounded at
  // or after the message) carried was shown to this review, so its loss is not the report's (`clearedView`); one that
  // any such window did not carry keeps it. The session the report's coverage, statuses and gaps are read from.
  // A window carried them only when its narrative request was sent and answered (its `failure` null): a window left out
  // (`unreviewed_scope`), one whose call failed and one whose answer could not be read showed this review no image.
  const reachedBy = (event) => windows.map((window, index) => index).filter((index) =>
    Number.isSafeInteger(event.sequence) && event.sequence <= (windowEnd(windows[index]) ?? -Infinity));
  const carriedIn = windows.map((window, index) => new Set(perWindow[index] && perWindow[index].failure == null
    ? (requests[index]?.request?.images ?? []).map((image) => image.eventId) : []));
  const shownToAll = new Set((Array.isArray(session?.events) ? session.events : []).filter((event) =>
    event?.kind === 'instruction' && event.childId == null && Array.isArray(event.nonText) && event.nonText.length > 0
    && reachedBy(event).length > 0 && reachedBy(event).every((index) => carriedIn[index].has(event.id)))
    .map((event) => event.id));
  const reported = clearedView(session, shownToAll);
  const facts = sessionCoverageFacts({ session: reported, windows, perWindow });
  const coverage = coverageFrom(facts);

  // D59: the report re-grounds every merged decision at the end of the window that proposed it —
  // the one whose row `mergeWindowOutputs` kept — never at the end of the session. The candidate
  // objects are the windows' own, so identity finds the window.
  // M36 phase 2 review (critique c4; C-05 "M36 grounding per shown span"): and every decision and finding in the session
  // as THAT window showed it (`shownSession` over its source map), exactly as the window grounded it — never the whole
  // recorded text, so a quote of a result's omitted middle the window withheld is not published by the report.
  const proposedIn = new Map(), shownIn = new Map();
  perWindow.forEach((w, index) => {
    // M36 phase 3: the source map the window's kept answer was shown (its evidence re-ask's, served spans appended).
    // Gain I: over the session as the window's requests showed it (the images they carried).
    const shown = shownSession(requests[index]?.session ?? session, w.sourceMap ?? requests[index]?.sourceMap ?? null);
    for (const candidate of w.decisions ?? []) {
      if (!proposedIn.has(candidate)) proposedIn.set(candidate, windowEnd(w.window));
      if (!shownIn.has(candidate)) shownIn.set(candidate, shown);
    }
    for (const candidate of w.findings ?? []) {
      // D59 (S6, S5 review M1): and every finding at the end of the window that proposed it.
      if (!proposedIn.has(candidate)) proposedIn.set(candidate, windowEnd(w.window));
      if (!shownIn.has(candidate)) shownIn.set(candidate, shown);
    }
  });
  const report = buildLedger({
    repo,
    session: reported, pr,
    reviewScope,
    candidates: merged.decisions,
    findingCandidates: merged.findings,
    codeFindings: [],
    sessionCoverage: coverage,
    coverageFacts: facts,
    upTo: (candidate) => proposedIn.get(candidate) ?? null,
    groundIn: (candidate) => shownIn.get(candidate) ?? null,
    // D71 (d): a session-only review publishes a choice not to act anchored on the agent's words.
    notActing: reviewScope === 'session-only',
    // D83 (3): and a decision whose cited actions are all the agent's housekeeping is not listed, only counted.
    housekeeping: reviewScope === 'session-only',
    // D84: and "made without asking you" also checks the project instruction files a window showed.
    projectFilesShown: reviewScope === 'session-only',
  });

  // `windowConcurrency` is the instrument's frozen ceiling, not this run's lane count: a run
  // that used fewer lanes produces the same report, which is the whole point of W3-7.
  // F177: `windowCompletion` — how many windows completed and the closed reason each other one did
  // not, from the fields their completeness is; `unexplained` must be 0.
  // M33 J: the speed profile's own bounds, and the profile itself — its name, its window source
  // budget and re-cut floor, request bound, lanes, calls in flight, and how it challenges.
  // `maxCallsInFlight` is the most calls this review can have in flight: lanes x a window's pool for the
  // standard profile, as always (the CLI transport holds it to the profile's six); for any other profile
  // that, capped by the profile's own `maxCallsInFlight`, which the review holds itself to (`slots`).
  const structuralCalls = profile.windowConcurrency * CHALLENGE_PROFILE.maxConcurrency;
  report.instrument = { reviewAgent: agent.version, windows: windows.length,
    reviewScope,
    windowing: windowingProfileOf(reviewScope, backend), maxInputBytes: requestBound,
    challenge: challengeProfileOf(profile, reviewScope, backend), windowConcurrency: profile.windowConcurrency,
    maxCallsInFlight: isStandardProfile(profile) ? structuralCalls : Math.min(structuralCalls, profile.maxCallsInFlight),
    speedProfile: profile,
    windowCompletion: windowCompletion(perWindow) };
  // M33 K: a dossier profile's totals over the windows whose single-pass run was shown one — numbers only.
  if (dossierChallenge(profile)) {
    const shown = perWindow.filter((w) => w.dossier);
    const total = (key) => shown.reduce((n, w) => n + w.dossier[key], 0);
    report.instrument.dossier = { windows: shown.length, batches: total('batches'), evidenceBytes: total('evidenceBytes'),
      dossierBytes: total('dossierBytes') };
  }

  // Pivots and requirements are grounded exactly like everything else. A pivot is a claim about
  // what the agent tried and abandoned; an ungrounded one is a story, and stories are what this
  // product exists not to print.
  // F73: the same pivot seen through two windows is one pivot, reconciled by `mergeWindowOutputs`
  // exactly like the shared-requirement case — a flat concatenation published it twice.
  report.pivots = merged.pivots;
  report.counts.pivotsMerged = merged.pivotsMerged;
  report.pivotsRejected = perWindow.reduce((n, w) => n + w.pivotsRejected
    + w.challenge.rejected.filter((r) => r.type === 'pivot' && r.resolved !== true).length, 0);
  // F44. Pivot receipts are grounded here rather than in `buildLedger`, so the repairs they
  // needed were the one class the ledger's own count could not see. Same yield figure, same
  // meaning: every one of these quotes passed the same string search as an untouched one.
  report.counts.receiptsRepaired += perWindow.reduce((n, w) => n + (w.pivotsRepaired ?? 0), 0);
  // W3-7: the same requirement seen through two windows is one requirement. Windows no longer
  // read each other's answers, so two of them can legitimately report the instruction they can
  // both see in the inventory; `mergeWindowOutputs` publishes one row for it.
  report.requirements = merged.requirements;
  // D71 (S2; D59, D60): the end of the recording, applied at report time from the whole session, never
  // in a request — a not-checked row with no deliverable whose last reporting window holds the recording's last event
  // carries the fact `no_deliverable_by_end` beside it (fixed words, ledger.js REQUIREMENT_FACT_WORDS), never a stronger
  // status. Deterministic: every review re-runs it.
  if (reviewScope === 'session-only') {
    const lastSequence = (Array.isArray(session?.events) ? session.events : [])
      .reduce((max, event) => (Number.isSafeInteger(event?.sequence) && event.sequence > max ? event.sequence : max), -1);
    const holdsEnd = new Set(perWindow.filter((w) => windowEnd(w.window) === lastSequence).map((w) => w.window.index));
    report.requirements = merged.requirements.map((row, at) => (row?.status === 'not-checked' && row.deliverable == null
      && holdsEnd.has(merged.requirementWindows[at]) ? { ...row, facts: [NO_DELIVERABLE_BY_END] } : row));
    // D71 (S3, owner decision D71 c): the failures section — every window's rows, in window order (each RESULT is one
    // window's own event, so no row repeats).
    report.failures = perWindow.flatMap((w) => (Array.isArray(w.failures) ? w.failures : []));
    // Counts only: the checklist's rows and checks over the review (each window's `checklist` record, summed).
    const records = perWindow.map((w) => w.checklist).filter(Boolean);
    const total = (read) => records.reduce((n, record) => n + count(read(record)), 0);
    const byReason = (list, read) => Object.fromEntries(list.map((reason) => [reason, total((r) => read(r)?.[reason])]));
    report.counts.checklist = {
      requirements: { byStatus: Object.fromEntries(REQUIREMENT_STATUSES.map((status) =>
        [status, report.requirements.filter((row) => row?.status === status).length])),
      reasons: Object.fromEntries(REQUIREMENT_UNCHECKED_REASONS.map((reason) =>
        [reason, report.requirements.filter((row) => row?.reason === reason).length])),
      noDeliverableByEnd: report.requirements.filter((row) => row?.facts?.includes(NO_DELIVERABLE_BY_END)).length },
      restsOnRejected: { requirements: byReason(RESTS_ON_REJECTIONS, (r) => r.restsOnRejected.requirements),
        claims: byReason(RESTS_ON_REJECTIONS, (r) => r.restsOnRejected.claims) },
      // W2: the cited RESULTs checked as their recorded ACTIONs (checklist.js `restsOnCheck`), counted before the checks.
      [RESTS_ON_REPAIRED]: { requirements: total((r) => r[RESTS_ON_REPAIRED]?.requirements),
        claims: total((r) => r[RESTS_ON_REPAIRED]?.claims) },
      notClaims: { proposed: total((r) => r.notClaims.proposed), accepted: total((r) => r.notClaims.accepted),
        rejected: byReason(NOT_CLAIM_REJECTIONS, (r) => r.notClaims.rejected) },
      closing: { messages: total((r) => r.closing.messages), lines: total((r) => r.closing.lines),
        covered: total((r) => r.closing.covered), listed: total((r) => r.closing.listed),
        [CLOSING_LINE_UNREVIEWED]: total((r) => r.closing[CLOSING_LINE_UNREVIEWED]) },
      // D71 (S3): the new channels. (c) The failures section, over every window's rows; (d) choices not to act proposed
      // and published; (e, g) contradicted claims by what contradicts them; (g) the project instruction files the
      // recording gave the agent. (f) is counted below, once the promises are published.
      failures: { listed: total((r) => r.failures?.listed),
        byOutcome: byReason(FAILURE_OUTCOMES, (r) => r.failures?.byOutcome),
        byHandling: Object.fromEntries(FAILURE_HANDLINGS.map((handling) => [handling, report.failures.filter((row) =>
          row?.handling === handling).length])),
        reasons: Object.fromEntries(FAILURE_UNCHECKED_REASONS.map((reason) => [reason, report.failures.filter((row) =>
          row?.reason === reason).length])),
        rejected: byReason(FAILURE_REJECTIONS, (r) => r.failures?.rejected) },
      notActing: { proposed: total((r) => r.notActing?.proposed),
        published: (Array.isArray(report.decisions) ? report.decisions : []).filter((d) => d?.notActing === true).length },
      contradictions: Object.fromEntries(CONTRADICTION_SOURCES.map((source) => [source,
        (Array.isArray(report.findings) ? report.findings : []).filter((finding) => finding?.kind === CLAIM_FINDING_KIND
          && (finding.contradictionSource ?? 'result') === source).length])),
      projectInstructions: { files: Array.isArray(session?.projectInstructions) ? session.projectInstructions.length : 0 },
    };
  }
  // C-06 (M33): grounded agent claims that survived the challenge, as open PromiseRecords, in window
  // order — none silently discarded. A contradicted claim is a finding instead; a withheld or
  // unsettled one is counted (`claimsRejected`, `withheld`), never published. G3: a claim whose
  // stated receipt a SURVIVING claim_contradicted finding cites — proposed in the same window or
  // another — is that finding, not also an open promise; counted in `promisesAsFindings`.
  const beside = promisesBesideFindings(merged.promises, report.findings);
  // M33 C event binding: and a promise in a statement a published contradiction cites is never `verified` — nor in the
  // statement of a contradiction whose own check did not settle, in any window: by the statement's event.
  const unsettledSaid = unsettledContradictionStatements(session, perWindow.map((w) => w.challenge))
    .map((stated) => ({ kind: CLAIM_FINDING_KIND, receipts: [stated] }));
  const { promises, lowered: supportsContradicted } = unverifiedBesideFindings(session, beside.promises,
    [...report.findings, ...unsettledSaid]);
  report.promises = promises;
  report.counts.promisesAsFindings = beside.asFindings;
  // D71 (S3, owner decision D71 f): the claims the reviewer marked as assumptions — proposed, and published as promises.
  if (reviewScope === 'session-only' && report.counts.checklist)
    report.counts.checklist.assumptions = {
      proposed: perWindow.reduce((n, w) => n + count(w.checklist?.assumptions?.proposed), 0),
      published: promises.filter((promise) => promise?.assumption === true).length };
  // M33 C: the supports claims proposed — how many published promises they made `verified` (one per published
  // row), and why each other one did not (SUPPORT_REJECTIONS, every reason present: a code check, or how its own
  // challenge item ended). Absent when no claim proposed one, so a review without a support publishes the counts
  // it always did.
  if (perWindow.some((w) => count(w.supportsProposed) > 0)) {
    report.counts.promiseSupport = { verified: promises.filter((p) => p?.status === PROMISE_VERIFIED).length,
      rejected: Object.fromEntries(SUPPORT_REJECTIONS.map((reason) =>
        [reason, perWindow.reduce((n, w) => n + count(w.supportsRejected?.[reason]), 0)
          + (reason === SUPPORT_CONTRADICTED ? supportsContradicted : 0)])),
      // W3 (owner decision 2026-10-13): a session-only review's supports asked under a closed counter (SUPPORT_ASKED),
      // by how their item ended (RESOLUTION_CHALLENGE_OUTCOMES).
      ...(reviewScope === 'session-only' ? Object.fromEntries(SUPPORT_ASKED.map((counter) => [counter,
        Object.fromEntries(RESOLUTION_CHALLENGE_OUTCOMES.map((outcome) => [outcome,
          perWindow.reduce((n, w) => n + count(w.supportsAsked?.[counter]?.[outcome]), 0)]))])) : {}) };
  }
  // D71 (S2; owner decision D71 b): a session-only requirement its challenge did not uphold is kept, lowered to not-checked
  // (`challenge_*` reasons), so it is no requirement left out; only the code's own withheld and unread rows are.
  report.requirementsRejected = perWindow.reduce((n, w) => n + w.requirementsRejected
    + (reviewScope === 'session-only' ? 0
      : w.challenge.rejected.filter((r) => r.type === 'requirement' && r.resolved !== true).length), 0);
  // S6 (S5 review H1): and so is a session-only claim whose own challenge did not settle (published not checked, with
  // why): only the combined route still counts it here.
  report.claimsRejected = perWindow.reduce((n, w) => n + w.claimsRejected
    + (reviewScope === 'session-only' ? 0
      : w.challenge.rejected.filter((r) => r.type === 'claim' && r.resolved !== true).length), 0);
  // W3d-2. What THIS review's challenge re-asked and snapped, counted by the code that did it
  // (W3d-1). D60: every window's challenge runs in every review — an answer the judge's cache
  // supplied is still a re-ask this review made and a quote this code snapped — so a review answered
  // from stored answers counts exactly what the first one did.
  const liveTotal = (key) => perWindow
    .reduce((n, w) => n + (Number.isSafeInteger(w.challenge[key]) ? w.challenge[key] : 0), 0);
  report.challenge = { profile: challengeProfileOf(profile, reviewScope, backend),
    complete: perWindow.every((w) => !w.failure && w.challenge.complete),
    executionComplete: perWindow.every((w) => !w.failure && w.challenge.executionComplete),
    attemptedCalls: perWindow.reduce((n, w) => n + w.challenge.attemptedCalls, 0),
    rejectedItems: perWindow.reduce((n, w) => n + w.challenge.rejected.length, 0),
    refutedItems: perWindow.reduce((n, w) => n + (w.challenge.refutedItems ?? 0), 0),
    unresolvedItems: perWindow.reduce((n, w) => n + (w.challenge.unresolvedItems ?? 0), 0),
    budgetExhausted: perWindow.some((w) => w.failure === 'budget_exhausted' || w.challenge.budgetExhausted),
    repairedVotes: liveTotal('repairedVotes'),
    // G3: valid votes whose receipt code moved from an action to its one supplied result.
    eventRepairedVotes: liveTotal('eventRepairedVotes'), reaskCalls: liveTotal('reaskCalls'),
    reaskedSlots: liveTotal('reaskedSlots'),
    // D58: items voted on and left unsettled, across every window.
    unsettledItems: perWindow.reduce((n, w) => n + count(w.challenge.unsettledItems), 0) };
  // D58 (W3d-3). What this review withheld as inconclusive, by count, never by content:
  //   proposals — a decision the ledger withheld here (a quote that did not match the record, or,
  //     M33 G4, cited actions that resolve to more than one actor or to none), a pivot, requirement
  //     or claim a window withheld (a quote that did not match), a proposal citing a source its
  //     window was not shown. Each proposal once: a session finding is a contradicted claim,
  //     counted as one.
  //   unsettled — an item the three challengers voted on and could not settle.
  // Nothing counted here is published anywhere as a row, a finding or an accusation, and nothing
  // counted here caps coverage.
  // M33 G4: `causes` says which of the withheld decisions failed a check more specific than a
  // quote — a decision whose cited actions resolve to more than one actor, or to none
  // (`actor_ambiguous`); the rest of `proposals` are quotes that did not match.
  // M33 (C-06 "M33 written statements"): and every written statement a window withheld, each by its own
  // closed cause (`causes.written_*`) — counted, never published, and never a limit on coverage.
  const writtenWithheld = Object.fromEntries(WRITTEN_WITHHELD_CAUSES.map((cause) =>
    [cause, perWindow.reduce((n, w) => n + count(w.writtenWithheld?.[cause]), 0)]));
  // M33 N (C-06 "M33 forbidden edits"): the windows' forbidden edits, summed — present only when some window's answer
  // proposed one. `withheld` by FORBIDDEN_EDIT_REJECTIONS (`malformed` is an unread proposal, never a withheld one);
  // `challenged` by how each asked item's challenge ended; `reverted`, the asked ones code proved undone in their turn.
  // M33 brittleness M4 session route: the agent statements are counted as disclosures (`counts.disclosures`, below).
  const forbiddenWindows = perWindow.filter((w) => w.forbiddenEdits);
  const forbiddenSum = (read) => forbiddenWindows.reduce((n, w) => n + count(read(w.forbiddenEdits)), 0);
  if (forbiddenWindows.length) report.counts.forbiddenEdits = { proposed: forbiddenSum((f) => f.proposed),
    withheld: Object.fromEntries(FORBIDDEN_EDIT_REJECTIONS.map((reason) => [reason, forbiddenSum((f) => f.withheld?.[reason])])),
    challenged: Object.fromEntries(RESOLUTION_CHALLENGE_OUTCOMES.map((outcome) => [outcome, forbiddenSum((f) => f.challenged?.[outcome])])),
    reverted: forbiddenSum((f) => f.reverted),
    // M33 N repair: proposals merged into an edit already asked, present only when some window merged one.
    ...(forbiddenSum((f) => f.merged) ? { merged: forbiddenSum((f) => f.merged) } : {}) };
  // M33 brittleness M4 session route (owner decision 2026-10-06): the upheld edits' proposed disclosures, summed — the
  // combined route's `counts.disclosures`, same shape: `proposed`, `rejected` by DISCLOSURE_REJECTIONS, `upheld`. Present
  // only when some window's upheld edit proposed one; and the calls their own runs made, apart from `report.challenge`
  // (a disclosure check is no part of whether any window, or the review, completed), present only when one was asked.
  const disclosureWindows = perWindow.filter((w) => w.disclosures);
  const disclosureSum = (read) => disclosureWindows.reduce((n, w) => n + count(read(w.disclosures)), 0);
  if (disclosureWindows.length) report.counts.disclosures = { proposed: disclosureSum((d) => d.proposed),
    rejected: Object.fromEntries(DISCLOSURE_REJECTIONS.map((reason) => [reason, disclosureSum((d) => d.rejected?.[reason])])),
    upheld: disclosureSum((d) => d.upheld) };
  const disclosureRuns = perWindow.filter((w) => w.disclosureChallenge);
  if (disclosureRuns.length) {
    const disclosureTotal = (key) => disclosureRuns.reduce((n, w) => n + count(w.disclosureChallenge?.[key]), 0);
    report.disclosureChallenge = { attemptedCalls: disclosureTotal('attemptedCalls'),
      reaskCalls: disclosureTotal('reaskCalls'), plannedItems: disclosureTotal('plannedItems') };
  }
  // A forbidden edit a code check withheld is a withheld proposal, said by its own cause (`forbidden_edits`); one no check
  // could read is not (it is unread, and its window incomplete).
  const forbiddenWithheld = FORBIDDEN_EDIT_REJECTIONS.slice(1).reduce((n, reason) => n + forbiddenSum((f) => f.withheld?.[reason]), 0);
  const otherSession = perWindow.reduce((n, w) => n + count(w.claimsOtherSession), 0);
  report.withheld = {
    proposals: report.rejectedDecisions.filter(withheldRejection).length
      + perWindow.reduce((n, w) => n + count(w.pivotsWithheld) + count(w.requirementsWithheld)
        + count(w.claimsWithheld) + count(w.challenge.withheldProposals), 0)
      + Object.values(writtenWithheld).reduce((n, k) => n + k, 0) + forbiddenWithheld,
    unsettled: report.challenge.unsettledItems,
    ...declaredCauses({ ...withheldCauseCounts(report.rejectedDecisions), ...writtenWithheld,
      ...(forbiddenWithheld ? { [FORBIDDEN_WITHHELD_CAUSE]: forbiddenWithheld } : {}),
      // M36 phase 3 (D68 F, c6): the claims each window withheld before asking, contradicted from another session.
      ...(otherSession ? { other_session: withheldCauseCounts(report.rejectedDecisions).other_session + otherSession } : {}) }),
  };
  // M33 (C-06 "M33 written statements"): statements the agent wrote into files, in their own list, each
  // with its closed side label — never a finding, never a promise, never part of any status. Counted by
  // label, how many were chat claims reclassified, and why each proposed contradiction was not accepted.
  report.writtenClaims = merged.writtenClaims;
  report.counts.writtenClaims = {
    ...Object.fromEntries(WRITTEN_LABELS.map((label) => [label, merged.writtenClaims.filter((w) => w.label === label).length])),
    reclassified: perWindow.reduce((n, w) => n + count(w.writtenReclassified), 0),
    contradictionsRejected: Object.fromEntries(WRITTEN_CONTRADICTION_REJECTIONS.map((reason) =>
      [reason, perWindow.reduce((n, w) => n + count(w.writtenContradictionsRejected?.[reason]), 0)])),
  };
  // The calls the written statements' own challenges made, apart from `report.challenge`: they are no
  // part of whether any window, or the review, completed.
  const writtenTotal = (key) => perWindow.reduce((n, w) => n + count(w.writtenChallenge?.[key]), 0);
  report.writtenChallenge = { attemptedCalls: writtenTotal('attemptedCalls'), reaskCalls: writtenTotal('reaskCalls'),
    plannedItems: writtenTotal('plannedItems') };
  // M33 C repair: and the calls the support items' own challenges made, apart from `report.challenge` for the same
  // reason: a support check is no part of whether any window, or the review, completed.
  const supportTotal = (key) => perWindow.reduce((n, w) => n + count(w.supportChallenge?.[key]), 0);
  report.supportChallenge = { attemptedCalls: supportTotal('attemptedCalls'), reaskCalls: supportTotal('reaskCalls'),
    plannedItems: supportTotal('plannedItems') };
  // M33 (C-06 "M33 per-part verdicts"): the answers asked again for an unreadable proposal, the ones
  // whose second answer was used, and the windows whose kept answer still holds one. Counts only.
  report.counts.proposalReasks = { asked: perWindow.filter((w) => w.proposalReasked).length,
    recovered: perWindow.filter((w) => w.proposalRecovered).length,
    unreadable: perWindow.filter((w) => w.proposalUnreadable).length };
  // M33 (C-06 "M33 per-part verdicts"): each window records the events it showed, by id, so a part's
  // windows are recomputed from the report (`honestStatuses`), and whether its answer was asked again.
  report.windowResults = perWindow.map((w) => ({ narrative: w.narrative, failure: w.failure,
    eventIds: w.window.events.map((event) => event.id),
    proposalReasked: w.proposalReasked, proposalUnreadable: w.proposalUnreadable,
    // D78: the repeated claims its answer held, by class (present only when there was one).
    ...(w.claimRepeats ? { claimRepeats: w.claimRepeats } : {}),
    // D80: its published copies of a claim merged into an earlier one (present only when there was one).
    ...(count(w.claimsMerged) ? { claimsMerged: w.claimsMerged } : {}),
    challenge: w.challenge, groundingComplete: w.groundingComplete,
    sessionGroundingComplete: w.sessionGroundingComplete,
    relevanceApplicable: w.relevanceApplicable, relevanceComplete: w.relevanceComplete,
    grounding: w.grounding, shortfall: w.shortfall, placed: w.placed, omitted: w.omitted,
    sourceMapSize: w.sourceMapSize,
    promptVersion: w.promptVersion, windowIndex: w.window.index,
    // M35 (windowing): the window's session (the root's, or a helper's, with the launch and the parent segment it links
    // back to), its segments by record, the piece of an oversized segment it is, its active task and its work's size.
    session: w.window.session, segments: w.window.segments, piece: w.window.piece,
    activeTask: w.window.activeTask, workBytes: w.window.workBytes, oversize: w.window.oversize,
    writtenChallenge: w.writtenChallenge, ...(w.dossier ? { dossier: w.dossier } : {}),
    // S6 (S5 review M4, "on the page"): a session-only window's closing-message lines no claim covers
    // (`unreviewed`) and those the review read as asserting nothing (`listed`, its accepted `notClaims`), by event and line
    // number — positions only, so a reader shows them as recorded and a claim hidden in `notClaims` stays visible.
    ...(closingLinesOf(w.checklist) ? { closingLines: closingLinesOf(w.checklist) } : {}),
    ...(w.supportChallenge ? { supportChallenge: w.supportChallenge } : {}),
    // M35: what this window's carried context held, by count — its own events are `eventIds` alone.
    ...(w.carried ? { carried: w.carried } : {}),
    // M33 N: the window's forbidden edits, by count (present only when its answer proposed one).
    ...(w.forbiddenEdits ? { forbiddenEdits: w.forbiddenEdits } : {}),
    // M36 phase 3 (D68 K): every session a window of several holds, each its own record; (D68 Q) its evidence requests,
    // by count; (c6) its claims withheld for a contradiction from another session (its quotes found in two sessions'
    // shown text went with the text-match rule: D68 phase 3 review, D69 a). Each present only when there is one, so a
    // window of one session that requested nothing keeps its record.
    ...(windowParts(w.window).length > 1 ? { sessions: windowParts(w.window).map((part) => ({ session: part.session,
      segments: part.segments, piece: part.piece, activeTask: part.activeTask, workBytes: part.workBytes,
      oversize: part.oversize })) } : {}),
    ...(w.evidence ? { evidence: w.evidence } : {}),
    ...(count(w.claimsOtherSession) ? { claimsOtherSession: w.claimsOtherSession } : {}),
    // M33 brittleness M4 session route: its upheld edits' disclosures, by count, and their run's record (each present only
    // when there is one).
    ...(w.disclosures ? { disclosures: w.disclosures } : {}),
    ...(w.disclosureChallenge ? { disclosureChallenge: w.disclosureChallenge } : {}),
    // S3: what the re-asks of its refuted requirements came to, by count, and the run that checked their new statuses
    // (each present only when there is one).
    ...(w.restatus ? { restatus: w.restatus } : {}),
    ...(w.restatusChallenge ? { restatusChallenge: w.restatusChallenge } : {}),
    // W1 A: what became of its decisions refuted on who decided them, by count, and the runs that checked their choices
    // and their new columns (each present only when there is one).
    ...(w.recolumn ? { recolumn: w.recolumn } : {}),
    ...(w.recolumnExistsChallenge ? { recolumnExistsChallenge: w.recolumnExistsChallenge } : {}),
    ...(w.recolumnChallenge ? { recolumnChallenge: w.recolumnChallenge } : {}),
    // S1: the whole-window vote on its unsettled requirements, by count, and that run's record (each present only when
    // there is one).
    ...(w.windowVote ? { windowVote: w.windowVote } : {}),
    ...(w.windowVoteChallenge ? { windowVoteChallenge: w.windowVoteChallenge } : {}) }));
  // M33 X: counts only, each present only when nonzero, so a review that carried nothing and moved nothing reports
  // the counts it always did. `eventRepairedReceipts` (G01): claim receipts moved from an action's id to its one
  // result. `carriedRepeats`: carried statements proposed again with nothing of their window bearing on them.
  // M35 `carried`: the windows that carried context, how many human messages and thoughts they carried, and how many
  // older thoughts the cap left out (in how many windows).
  const moved = perWindow.reduce((n, w) => n + count(w.claimReceiptsMoved), 0);
  if (moved) report.counts.eventRepairedReceipts = moved;
  const repeats = perWindow.reduce((n, w) => n + count(w.carriedRepeats), 0);
  if (repeats) report.counts.carriedRepeats = repeats;
  // D78: the copies of a claim already kept that the windows' answers held, dropped before any check
  // (`withoutRepeats`), by class — present only when some window's answer held one, so a review without any reports
  // the counts it always did.
  const repeated = perWindow.filter((w) => w.claimRepeats);
  const repeatedOf = (key) => repeated.reduce((n, w) => n + count(w.claimRepeats[key]), 0);
  if (repeated.length) report.counts.claimRepeats = { claims: repeatedOf('claims'), written: repeatedOf('written') };
  // D80: the published copies of a claim, apart only by a support no check upheld, merged into an earlier copy after
  // the checks (`withoutUnupheldRepeats`) — present only when some window merged one.
  const claimsMerged = perWindow.reduce((n, w) => n + count(w.claimsMerged), 0);
  if (claimsMerged) report.counts.claimsMerged = claimsMerged;
  // M36 phase 3 (owner decision D68 Q): what every window's evidence requests asked and were served, counts only —
  // present only when some window's answer requested evidence.
  const asking = perWindow.filter((w) => w.evidence);
  if (asking.length) {
    const total = (key) => asking.reduce((n, w) => n + count(w.evidence[key]), 0);
    report.counts.evidenceRequests = { windows: asking.length, requested: total('requested'), items: total('items'),
      served: total('served'), servedBytes: total('servedBytes'), reasks: total('reasks'),
      reaskFailed: asking.filter((w) => w.evidence.reaskFailed).length,
      kept: asking.filter((w) => w.evidence.kept === 'merged').length, fromFirst: total('fromFirst'),
      refused: Object.fromEntries(EVIDENCE_REQUEST_REFUSALS.map((reason) =>
        [reason, asking.reduce((n, w) => n + count(w.evidence.refused?.[reason]), 0)])) };
  }
  const carriedWindows = perWindow.filter((w) => w.carried);
  const sum = (read) => carriedWindows.reduce((n, w) => n + count(read(w.carried)), 0);
  if (carriedWindows.length) report.counts.carried = { windows: carriedWindows.length,
    humans: sum((c) => c.humans), thoughts: sum((c) => c.thoughts), thoughtsLeftOut: sum((c) => c.thoughtsLeftOut),
    cappedWindows: carriedWindows.filter((w) => w.carried.capped).length,
    // M36 phase 3 (D68 F): proven failures carried (a helper's riding back included) and left out by the cap — present
    // only when some window carried one or left one out.
    ...(sum((c) => c.failures) || sum((c) => c.failuresLeftOut) ? { failures: sum((c) => c.failures),
      helperFailures: sum((c) => c.helperFailures), failuresLeftOut: sum((c) => c.failuresLeftOut) } : {}),
    // ... and the windows whose cap was lowered to fit their request under the review's bound (present only then).
    ...(carriedWindows.some((w) => w.carried.fitted) ? { fittedWindows: carriedWindows.filter((w) => w.carried.fitted).length }
      : {}) };
  report.windowFailures = failed.map((w) => ({ window: w.window.index + 1, reason: w.failure }));
  // Adapter losses are session-level gaps, declared alongside anything the run itself found.
  // buildLedger already carried the delegation gaps across by reference, so filter by identity
  // rather than declaring one loss twice.
  const declared = new Set(report.gaps ?? []);
  report.gaps = [...declared, ...(reported.adapterGaps ?? []).filter((g) => !declared.has(g))];
  // The last word. Challenge and grounding gaps must remain visible even when every surviving
  // list is empty, and no intermediate step may leave a status cleaner than its coverage.
  Object.assign(report, honestStatuses(report));
  return report;
}
