// The decisions ledger: candidates in, grounded rows out. No model call happens here and none
// may. A model proposes semantic relationships; THIS code decides what is true enough to show.
//
// Three rules carry most of the weight:
//   - a quote is grounded only by literal string search against the cited source (C-05)
//   - the column is derived from the grounded instruction relation, never supplied (C-05)
//   - rank, tier, severity and confidence are never accepted from a model (JG-07)

import { posix } from 'node:path';
import { verifyReceipt, verifyReceipts, repairReceipt, decisionIdentity, findingIdentity, MIN_QUOTE_CHARS,
  recordedFailure, atWordEdges, isRead, PROJECT_INSTRUCTIONS_ROLE, effectOf, effectReader, ACTION_EFFECTS,
  CHANGING_EFFECTS, STOPPED_DENIALS, GROUNDING_ROLES, eventRoles } from './session.js';
import { publishedReceipt, withoutRepairFields, spansSyntheticMarker } from './receipt-repair.js';
import { materialityOf } from './materiality.js';
import { identityDigest } from '../contracts/canonical.js';
import { INSTRUCTION_GAP_NOTES, PRIOR_STATE } from '../adapters/sonah-ledger.js';

export const DECISION_COLUMNS = Object.freeze(['asked-settled', 'asked-chose', 'unasked']);

// A model that emits any of these is not trusted to have stayed inside its contract, so the
// whole candidate is rejected rather than quietly stripped.
export const FORBIDDEN_MODEL_FIELDS = Object.freeze([
  'rank', 'tier', 'severity', 'confidence', 'completeness', 'permission',
  'column', 'materiality', 'status', 'materialityRule',
]);

// C-03 gap codes. Everything the adapter or this layer can declare, in one place. No model
// chooses a gap code. (`fused_statement` was retired with the coverage-based dedup — audit M72.)
// W3c-8: `code_unreviewable` is a changed file the CODE review could not read (F106 — it was
// mislabelled `source_clipped`, a recorder cut); `unrecorded_body` is a write whose body the
// session recording does not contain (F96). M29: every internal unrecorded body caps, even when
// its path appears in a reviewed PR diff; that later path does not prove the historical bytes.
// W3d-4 and M28: an attempted write with an unknown result caps session coverage whether or
// not a model proposes a finding. A shell/test command with unknown exit status does likewise.
// A finding resting on either unknown result is withheld; a positively failed write is known
// evidence, and a finding resting on it is only withheld (`action_failed` below).
// The agentic code step (code-pass/7): `code_step_backend` is the code step not run because the review's backend is
// not claude-cli, the one backend whose reviewer can read the repository with read-only tools (CODE_STEP_BACKEND_GAP).
export const CODE_STEP_BACKEND_GAP = 'code_step_backend';
export const GAP_CODES = Object.freeze([
  'missing_child', 'ambiguous_child', 'incomplete_inventory', 'source_clipped', 'unsupported_message',
  'code_unreviewable', 'unrecorded_body', 'write_outcome_unknown', 'command_outcome_unknown', 'input_limit',
  'identity_redacted', 'identity_conflict', 'source_changed', 'source_unreadable',
  'storage_limit', 'missing_result', 'redacted_content', CODE_STEP_BACKEND_GAP,
]);

// Why a judge call failed, as the window failure reports it. Closed: a code outside this set is
// reported as `model_unavailable`, because an unrecognised code cannot be explained to a reader
// and an unbounded set has no computable per-reason rate. Collapsing every code into
// `model_unavailable` was the opposite error — `anthropic_key_missing` is actionable and was
// never reportable as itself (audit M77).
// F86: every RETRYABLE_JUDGE_CODES member is here too. A retryable code missing from this list
// was retried once and, when the retry failed the same way, reported as `model_unavailable` —
// a timeout and an unparseable reply read exactly like an unreachable provider.
// W3e-6 / F214: `invalid_model_input` is the judge refusing a request its transport cannot carry (a
// NUL byte, cli/src/review-judge.js) BEFORE anything is sent. Undeclared, it read `model_unavailable`
// with no class — a reader told the model could not be reached, and to retry, for a request that was
// never sent and that an identical retry is refused identically. It is not retryable.
// W3f-1 / F216: `model_output_limit` (a reply longer than the transport's output ceiling) and
// `model_response_incomplete` (the API stopped before `end_turn`) are the transport's own codes for
// a reply it could not take whole. Undeclared, both read `model_unavailable` — a model that could not
// be reached — for a model that answered, at length.
// The agent transport (cli/src/review-judge.js, `sonah.review-agent-transport/1`): `model_turn_limit` (the CLI's result
// subtype `error_max_turns`: the agent used every turn its request allows and gave no answer) and
// `model_structured_output_failed` (`error_max_structured_output_retries`: its answer never matched the request's JSON
// schema). The model ran in both and the CLI said why it stopped; an identical request runs into the same limit, so
// neither is retryable. Undeclared, both read `model_unavailable` and were retried. Each carries its transport class
// (run-review.js TRANSPORT_SHORTFALL: `turn_limit`, `structured_output_failed`).
export const JUDGE_FAILURE_CODES = Object.freeze([
  'model_unavailable', 'anthropic_key_missing', 'budget_exhausted', 'model_tool_use',
  'unsupported_backend', 'invalid_model', 'explicit_api_model_required',
  'model_timeout', 'model_response_invalid', 'invalid_model_input',
  'model_output_limit', 'model_response_incomplete',
  'model_turn_limit', 'model_structured_output_failed',
]);

// F48: moved here from packages/cli/src/review-judge.js, beside JUDGE_FAILURE_CODES, now that
// this file's constants block is not held by another wave. Retryable: a transport failure an
// identical second request can answer differently — the CLI could not be spawned or died, the
// provider was unreachable, the call timed out, or the reply carried no parseable JSON.
// Everything else in JUDGE_FAILURE_CODES returns the same answer however often it is asked, so
// retrying there only spends the reviewer's time and the account's tokens twice for the same
// refusal.
export const RETRYABLE_JUDGE_CODES = Object.freeze([
  'model_unavailable', 'model_timeout', 'model_response_invalid',
]);

// C-04 / W3d-1: the thrown judge failures whose challenge slots may take their pass's one
// bounded re-ask. A reply came back and could not be read — the same slot a malformed but parsed
// reply leaves. Every member is also in RETRYABLE_JUDGE_CODES, so one that reaches the challenge
// through `boundedJudge` has already spent the transport's single retry (it is "exhausted"): the
// challenge never adds a retry of its own. Matched by exact `code` membership only, never by an
// error's message or any other text. Every other failure stays a check that did not run.
export const REASKABLE_JUDGE_CODES = Object.freeze(['model_response_invalid']);

// M33 (C-07 "Window checkpoints and resumable session review"): why a whole review RUN ended
// without a report — never a window's failure, so none is a JUDGE_FAILURE_CODES member and the
// window vocabularies are unchanged. `review_identity_ambiguous`: two planned requests could be
// answered by one stored answer, refused before any call. `review_interrupted`: the run's signal
// was aborted. `checkpoint_failed`: the per-window hook rejected. A run error is
// `Object.assign(new Error(code), { code })` and carries no other text.
export const RUN_FAILURE_CODES = Object.freeze([
  'review_identity_ambiguous', 'review_interrupted', 'checkpoint_failed',
]);

// F47: the CLI's own closed vocabulary for `Review could not complete: <code>.` — moved here
// from an inline `new Set([...])` literal in the CLI so a per-reason false-positive rate stays
// computable. GitHub-transport codes are a separate, already-closed vocabulary
// (packages/github/errors.js); the CLI (session-review-command.js) unions the two at the point it
// needs them, rather than this evidence package importing github (the CLI imports evidence, not
// the other way around). D82 step 10 (B5 P17): `invalid_revision`, `incomplete_inventory` and
// `unsupported_profile`, which only the removed PR route raised, are no longer members.
/** The codes the review command may print by name. D90 (owner decision 2026-10-15): `output_not_masked` (D84: an output
 *  that could not be masked, so nothing was written) is no longer a member — nothing is masked. `output_folder_missing`
 *  and `output_folder_unwritable`: the folder `--output` names is not there, or is not one the person can write to
 *  (before, both were `review_failed`).
 *  `config_invalid` (owner decision 2026-10-14): Sonah's settings file (cli/src/settings.js) cannot be read, and no
 *  `--code-pass` or `--no-code-pass` says whether the code step runs, so the review stops before it reads anything. */
/** D124: the closed problems of a folder given with --code-repo (cli code-snapshot.js `codeRepoTop`): not there or not
 *  a folder; in no git working tree. Each is a failure code the review prints by name (CLI_SAFE_ERROR_CODES). */
export const CODE_REPO_PROBLEMS = Object.freeze(['code_repo_not_found', 'code_repo_not_git']);
export const CLI_SAFE_ERROR_CODES = Object.freeze([
  'github_auth_missing', 'stale_revision', 'review_in_progress', 'review_state_invalid',
  'budget_exhausted', 'unsupported_backend', 'invalid_model', 'explicit_api_model_required',
  'anthropic_key_missing', 'session_not_found', 'output_exists',
  'output_folder_missing', 'output_folder_unwritable', 'config_invalid', 'state_dir_holds_root',
  ...CODE_REPO_PROBLEMS,
]);

// W3d-4: `unsettled` — a challenge item every pass voted on that was not settled (D58: ran,
// inconclusive, withheld). It is not `unreviewed_scope`, which is an item some pass never voted on.
// W1 A (owner decision 2026-10-13): `decision_column_refuted` — a session-only decision whose check refuted who decided
// it, whose choice its own check upheld, and for which no other column held (DECISION_COLUMN_REFUTED). G2 (owner decision
// 2026-10-15): the same cause for a choice not to act anchored anew (run-review.js `reanchoredChoices`) — its choice
// upheld on its new words, and its check with the column its re-ask gave refuted.
export const JUDGMENT_REASONS = Object.freeze([
  'no_session_evidence', 'no_actions', 'capture_partial', 'instructions_partial',
  'ambiguous_authority', 'unlinked_revision', 'unreviewed_scope', 'receipt_rejected',
  'value_unchecked', 'column_unchecked', 'kind_rejected', 'relevance_unchecked', 'unsettled',
  'decision_column_refuted',
]);

// D58 (W3d-3). The rejection reasons that mean a check RAN and was inconclusive: a receipt the
// proposal rests on was checked against the record and did not hold — its quote is not in the
// cited source, it cites a source its request was not shown, or an action it cites did not
// succeed. Its item is withheld — never shown as a finding or an accusation — counted, and listed;
// coverage is not capped for it. A subset of JUDGMENT_REASONS, never a new string. Every other
// reason is a proposal this code could not evaluate at all (malformed, carrying a model rating,
// citing no action, anchored outside the PR) or a check that never ran (`unreviewed_scope`): those
// still cap, exactly as before.
export const WITHHELD_REASONS = Object.freeze(['receipt_rejected']);

// M33 G4 (C-06 "M33 session verdict"): a reason that is a withhold only beside one of these causes.
// A DECISION rejected `ambiguous_authority` because its cited actions resolve to more than one actor,
// or to none, is withheld and counted like an unmatched quote: grounding ran and was inconclusive
// about the actor. The reason is unchanged, so its rate stays computable; every other
// `ambiguous_authority` rejection — a candidate naming another actor than its actions resolve to, a
// prohibition that is not a human instruction — carries no cause and still caps.
export const WITHHELD_REASON_CAUSES = Object.freeze({ ambiguous_authority: Object.freeze(['actor_ambiguous']) });

// D83 (3), owner decision 2026-10-12 (C-06 "D83: the agent's housekeeping is not a decision"): why a grounded session
// decision is not listed. Closed; never constructed elsewhere.
//   housekeeping  every action it cites is the agent's housekeeping by structure (HOUSEKEEPING_KINDS): it changes
//                 nothing the person gets. It is counted in the report (`counts.notListed`), never shown as a row,
//                 and never caps coverage: grounding ran and placed it. A choice not to act (`notActing`) is never
//                 left out: its substance is its stated words, which the kinds would otherwise hold.
export const NOT_LISTED_REASONS = Object.freeze(['housekeeping']);
// D83 (3): the closed kinds of housekeeping, read from what the recorder typed, never from a command's or path's text:
//   writes_nothing      an action that writes nothing: a read or a search of the slicer's typed read kind (session.js
//                       `isRead`: Read, NotebookRead, Glob, Grep, the vetted MCP file read), or a command the recorder
//                       itself typed as only reading, searching or listing (a Codex `parsed_cmd` whose every entry is
//                       `read`, `search` or `list_files`). A command the recorder did not type so is never one.
//   outside_repository  a tool write (never one the slicer parsed from a command, `shellWriteOf`) whose every recorded
//                       change lies outside the repository (`outsideRepository`, the slicer's write scope: outside the
//                       recorder's working directory, or in the harness home folders where the agent's own memory and
//                       notes are), in a recording that holds a tool write inside the repository — the place it shows
//                       the person's work lands. In a recording none of whose writes lands inside the repository, a
//                       write outside it may be the work itself, so it is no housekeeping: without that guard,
//                       decisions about the work itself, in sessions with no write inside, were left out as
//                       housekeeping.
export const HOUSEKEEPING_KINDS = Object.freeze(['writes_nothing', 'outside_repository']);

/** Is this rejection a withheld item (D58), rather than a shortfall that caps coverage? */
export const withheldRejection = (rejection) => WITHHELD_REASONS.includes(rejection?.reason)
  || (typeof rejection?.reason === 'string' && Object.hasOwn(WITHHELD_REASON_CAUSES, rejection.reason)
    && WITHHELD_REASON_CAUSES[rejection.reason].includes(rejection.cause));

// W3d-4. WHICH check a withheld proposal failed, when it is more specific than the default — a
// quote that did not match the record, which carries no cause. Carried on the rejection as `cause`,
// beside its reason, which does not change: per-reason rates stay what they were, and the reader is
// told which of these it was, one closed sentence each (review.js).
//   no_frozen_code     a claim about the PR's current code that cites none of its frozen code
//   role_missing       a finding that does not cite a receipt of every role its kind requires
//   rule_after_action  a prohibition the human gave only after the action it is said to forbid
//   action_failed      an action it cites is recorded as failed, so the edit never landed
//   actor_ambiguous    (M33 G4; reason `ambiguous_authority`) a decision whose cited actions resolve
//                      to more than one actor, or to none
//   other_session      (M36 phase 3, D68 F, critique c6) a contradicted claim whose result was recorded
//                      in another session than its statement: that agent never received it
//   source_not_before  (D71 e, g) a contradicted claim whose human message, edit or project instruction file was not
//                      recorded before its statement
//   source_not_human   (D71 e) a contradicted claim whose cited message is not the human's own (an AGENT ASSIGNMENT, a peer)
//   source_not_file_content (D71 e) a contradicted claim whose cited code is not in the removed or context lines of an
//                      edit that ran to a recorded success (FILE_CONTENT_OUTCOMES) — W2: nor in the text the statement's
//                      own actor's edit or write added, where that edit or write ran to such a success (`own_written`)
//   source_rewritten   (W2, owner decision 2026-10-13) a contradicted claim whose cited code is text its own actor's edit
//                      or write added (`own_written`), but a later change to the same typed path, not recorded as failed
//                      or cancelled, was recorded between that edit and the statement: the file may no longer hold it
export const WITHHELD_REJECTION_CAUSES = Object.freeze(['no_frozen_code', 'role_missing', 'rule_after_action',
  'action_failed', 'actor_ambiguous', 'other_session', 'source_not_before', 'source_not_human',
  'source_not_file_content', 'source_rewritten']);
/** W2: the two causes `ownWrittenCheck` returns, by name for every reader (the review of the W1-W3 fixes: one spelling,
 *  read from the vocabulary, never retyped). */
export const SOURCE_NOT_FILE_CONTENT_CAUSE = WITHHELD_REJECTION_CAUSES[8];
export const SOURCE_REWRITTEN_CAUSE = WITHHELD_REJECTION_CAUSES[9];

/** How many withheld rejections in `rejections` carry each cause. Every cause is present. */
export function withheldCauseCounts(rejections = []) {
  const withheld = (Array.isArray(rejections) ? rejections : []).filter(withheldRejection);
  return Object.fromEntries(WITHHELD_REJECTION_CAUSES.map((cause) =>
    [cause, withheld.filter((r) => r.cause === cause).length]));
}

/** `{ causes }` for a `withheld` record when any cause was counted, and nothing otherwise: a
 *  producer that withheld only for quotes publishes the same record it always did. */
export const declaredCauses = (causes) => (Object.values(causes ?? {}).some((n) => n > 0) ? { causes } : {});

/**
 * D58 (W3d-3). Does the ledger's own reading of its rows cap session coverage? The ONE rule
 * `buildLedger` and `honestStatuses` both apply, so they cannot disagree.
 *
 * Caps: a rejection that is not a withheld one, and a decision whose place in the PR is unknown —
 * that is caused by absent evidence (a partial file list, the decision's own file partly supplied).
 * Does not cap: a proposal whose quote did not match (withheld, counted), a decision whose cited
 * actions resolve to more than one actor or to none (M33 G4, `actor_ambiguous`: withheld, counted),
 * and a published decision whose authority column or value could not be determined — it shows its
 * own UNCHECKED cell.
 */
export function readingCaps(report) {
  const list = (value) => (Array.isArray(value) ? value : []);
  const prRelevanceApplicable = effectiveReviewScope(report) !== 'session-only';
  return list(report?.rejectedDecisions).some((r) => !withheldRejection(r))
    || list(report?.rejectedFindings).some((r) => !withheldRejection(r))
    || (prRelevanceApplicable && list(report?.decisions).some((d) => d?.relevance === 'unchecked'));
}

/** A scope flag can waive only the capability that was deliberately not requested. A PR, code
 * finding, code judgment or placement makes the review combined even if an earlier session-only
 * report was later joined without clearing its flag. Reducers validate this every time. */
export function effectiveReviewScope(report) {
  const codeFindings = Array.isArray(report?.codeFindings) && report.codeFindings.length > 0
    || (Array.isArray(report?.findings) && report.findings.some((finding) =>
      finding?.origin !== 'session-review'));
  const codeJudgment = report?.codeJudgment != null
    || (Array.isArray(report?.judgments) && report.judgments.some((judgment) =>
      judgment?.capability === 'code'));
  const codeFunnel = report?.findingFunnel?.direct?.code;
  const codeProcess = [report?.codeChallenges, report?.codeFindingCandidates,
    report?.rejectedCodeFindings].some((list) => Array.isArray(list) && list.length > 0)
    || codeFunnel != null && (typeof codeFunnel !== 'object' || Array.isArray(codeFunnel)
      || Object.values(codeFunnel).some((count) => count !== 0))
    || report?.findingFunnel?.final?.code != null && report.findingFunnel.final.code !== 0;
  const prCodeGap = [report?.gaps, report?.session?.adapterGaps].some((list) =>
    Array.isArray(list) && list.some((gap) => gap?.scope === 'pr' && gap.channel === 'code'));
  return report?.reviewScope === 'session-only' && report?.pr == null
    && report?.codeCoverage === 'missing' && !codeFindings
    && !codeJudgment && !codeProcess && !prCodeGap && report?.codeCoverageFacts == null
    ? 'session-only' : 'combined';
}

function carriesForbiddenField(candidate) {
  return FORBIDDEN_MODEL_FIELDS.find((f) => Object.hasOwn(candidate ?? {}, f)) ?? null;
}

// R1/D57: an omitted relation is not an examination of the instruction history. The scope
// digest binds the explicit semantic checks below to the exact captured instruction bytes.
// It certifies identity and coverage, not the semantic truth of the model's explanations.
export const INSTRUCTION_REVIEW_VERSION = 'sonah.instruction-review/1';

/**
 * D59 (W3d-5): the sequence a window's instruction scope is bounded at — the last recorded event
 * of the window — or null when no event of it can be placed (a window with no events, such as the
 * code-chunk byte probe, is judged against the whole session, which is never smaller).
 */
export function windowEnd(window) {
  let end = null;
  for (const event of Array.isArray(window?.events) ? window.events : [])
    if (Number.isSafeInteger(event?.sequence) && (end === null || event.sequence > end)) end = event.sequence;
  return end;
}

/**
 * The human instruction inventory a decision's authority is checked against, with a digest that
 * binds a model's `instructionReview` to exactly these instructions.
 *
 * D59: `upTo` (a sequence number, a window's `windowEnd`) bounds it to what was recorded at or
 * before that point. Only events at or before it are examined — for the inventory, the id and
 * sequence uniqueness checks and the elided-instruction check — so nothing recorded after a window
 * can reach its request, its grounding or its key. An event whose sequence cannot be placed is
 * examined (and fails the scope), and the root-session history flag and unlocated root
 * instruction-inventory gaps still apply. Verified child-scoped gaps do not describe this actor's
 * human inventory. A bound that is not a sequence fails closed. The digest covers the same
 * actor-specific inventory at the chosen boundary; without `upTo` it covers the root history.
 *
 * OWNER DECISION B (2026-10-01; amends D59): a root instructions/identity (or unknown-channel) gap
 * is a loss for a bound only when it is unlocated, or names an event at or before the bound. It is
 * LOCATED only when it counts exactly the events it names (`count === eventIds.length`, at least
 * one, each a string) and each is an event of this session with a placeable sequence
 * (`locatedGapSequences`); any other gap is unlocated and, as D59 kept it, a loss at every bound.
 * Without `upTo` every such gap is a loss, exactly as before. An instruction recorded within a turn
 * (M34 labels: its `markers` — a queued prompt, an answer, an attachment — and its link, `answerTo`) carries that fact
 * into its inventory entry, so the request can say what it is.
 */
export function instructionReviewScope(session, { upTo = null } = {}) {
  const bounded = upTo != null;
  const placeable = !bounded || Number.isSafeInteger(upTo);
  // Transferred child events describe a different actor. Their assignment text and capture
  // shortfalls cannot enlarge or erase the root human's instruction inventory.
  const rootEvents = Array.isArray(session?.events)
    ? session.events.filter((e) => e?.childId == null) : session?.events;
  const examined = bounded && placeable && Array.isArray(rootEvents)
    ? rootEvents.filter((e) => !Number.isSafeInteger(e?.sequence) || e.sequence <= upTo)
    : rootEvents;
  const instructions = [];
  const ids = new Set(), sequences = new Set();
  const rootInstructionLoss = rootInstructionLossOf(session);
  // OWNER DECISION B: a located loss belongs only to the bounds that reach an event it names.
  const lossAtBound = (gap) => {
    if (!rootInstructionLoss(gap)) return false;
    if (!bounded) return true;
    const named = locatedGapSequences(session, gap);
    return named === null || named.some((sequence) => sequence <= upTo);
  };
  let complete = placeable && Array.isArray(examined)
    && (session.instructionHistoryComplete === undefined || session.instructionHistoryComplete === true)
    // You cannot certify what was never captured. Zero captured human instructions is an empty
    // history, not a complete one, and `unasked` against it is an accusation with no evidence
    // behind it at all. An instruction the recorder truncated is likewise not the instruction:
    // the constraint may be sitting in the elided middle (audit A3 ledger 48, G4/B6, B14).
    && examined.some((e) => e.kind === 'instruction' && e.authority === 'human')
    && !examined.some((e) => e.kind === 'instruction' && e.omitted === true)
    && !(session.adapterGaps ?? []).some(lossAtBound);
  for (const event of examined ?? []) {
    if (!event || typeof event.id !== 'string' || !event.id || ids.has(event.id)
        || !Number.isSafeInteger(event.sequence) || event.sequence < 0 || sequences.has(event.sequence)) {
      complete = false;
      continue;
    }
    ids.add(event.id); sequences.add(event.sequence);
    if (event.kind !== 'instruction') continue;
    // An assignment has no verified link to the ancestor human's complete authority scope in
    // this representation. Ignoring it cannot certify that the human never raised the topic.
    if (event.authority !== 'human') { complete = false; continue; }
    const { spans, complete: refsComplete } = session.textSpanInfoOf(event, 'text');
    const visible = spans.filter((span) => typeof span === 'string' && span.trim());
    if (!visible.length) {
      complete = false;
      continue;
    }
    // A shortened/redacted instruction still has useful surviving words for a later window,
    // but its missing region forbids a full-history "unasked" conclusion. Preserve each visible
    // span separately in the inventory and digest; never rejoin them into one quotable string.
    // OWNER DECISION B: what an in-turn instruction is, stated only on such an entry (no other entry's bytes move).
    // M34 labels: and the markers and link it carries (`markers`, `answerTo`).
    const recordedAs = { ...(Array.isArray(event.markers) && event.markers.length ? { markers: [...event.markers] } : {}),
      ...(typeof event.answerTo === 'string' && event.answerTo ? { answerTo: event.answerTo } : {}),
      // Gain I (2026-10-13): how many images of this message the request carries (images.js `deliveredView`), stated
      // only where it carries some — so the digest binds what the request was shown, and no other entry moves.
      ...(session.shownImages instanceof Map && Number.isSafeInteger(session.shownImages.get(event.id))
        ? { images: session.shownImages.get(event.id) } : {}) };
    if (!refsComplete || visible.length !== 1 || event.omitted === true) {
      complete = false;
      instructions.push({ eventId: event.id, sequence: event.sequence, spans: visible, partial: true, ...recordedAs });
    } else instructions.push({ eventId: event.id, sequence: event.sequence, text: visible[0], ...recordedAs });
  }
  instructions.sort((a, b) => a.sequence - b.sequence);
  try {
    return { scopeDigest: identityDigest(INSTRUCTION_REVIEW_VERSION, {
      sessionKey: session?.sessionKey ?? null, complete, instructions,
    }), complete, instructions };
  } catch {
    return { scopeDigest: null, complete: false, instructions: [] };
  }
}

/** The root-instruction-loss test of `instructionReviewScope`: a gap that could hide a root human ask — an instructions,
 *  identity or unknown-channel gap that is neither PR-scoped nor a verified child's own. M33 N: exported, so the
 *  forbidden-edit route (forbidden.js) reads a loss between an instruction and an action by the very same test. */
export function rootInstructionLossOf(session) {
  const knownChannels = new Set(['instructions', 'commentary', 'actions', 'observations',
    'code', 'children', 'identity']);
  const verifiedChildActors = new Map();
  for (const link of session?.children ?? []) {
    if (link?.state !== 'verified' || typeof link.childSession !== 'string'
      || !link.childSession || link.childSession === session?.sessionKey
      || typeof link.childId !== 'string' || !link.childId) continue;
    const ids = verifiedChildActors.get(link.childSession) ?? new Set();
    ids.add(link.childId);
    verifiedChildActors.set(link.childSession, ids);
  }
  const childScopedGap = (gap) => {
    const ids = verifiedChildActors.get(gap?.sessionKey);
    return ids?.size === 1 && (!Array.isArray(gap.eventIds)
      || gap.eventIds.every((id) => ids.has(session?.event?.(id)?.childId)));
  };
  return (gap) => gap?.scope !== 'pr' && !childScopedGap(gap)
    && (gap?.channel === 'instructions' || gap?.channel === 'identity'
      || !knownChannels.has(gap?.channel));
}

/**
 * OWNER DECISION B (2026-10-01). Where a declared gap is: the sequences of the events it names, or null when it is
 * unlocated — it names none, does not count exactly the events it names (`count === eventIds.length`), names
 * something that is not an event id, or names an event this session does not hold at a placeable sequence.
 */
export function locatedGapSequences(session, gap) {
  const ids = gap?.eventIds;
  if (!Array.isArray(ids) || !ids.length || gap.count !== ids.length) return null;
  const sequences = [];
  for (const id of ids) {
    const sequence = typeof id === 'string' ? session?.event?.(id)?.sequence : undefined;
    if (!Number.isSafeInteger(sequence)) return null;
    sequences.push(sequence);
  }
  return sequences;
}

/**
 * OWNER DECISION B (2026-10-01; C-05 "OWNER DECISION B", M33 U repair): does this action ask the human a question and
 * wait for the answer? A decision that cites one asked the human, so it was never "decided without asking you". M33
 * brittleness L3: read from the recorder adapter's flag (`asksHuman`, set from each recorder's own schema the way
 * `answerTo` is: adapters/sonah-ledger.js HUMAN_INTERACTION_TOOLS), never from a tool name here. Only strictly true
 * counts; a recorder whose schema cannot say declares that loss itself, as an instructions-channel gap.
 */
export const asksHuman = (event) => event?.kind === 'invocation' && event.asksHuman === true;

/**
 * OWNER DECISION B (2026-10-01; M33 U repair). Whether ONE decision's human-instruction history can be certified
 * (`unasked`), from the actions it cites (`a` the earliest one's sequence, `z` the latest one's). Its checks cover
 * exactly the asks recorded before `a`; so it is complete only when
 *   1. the scope bounded just before `a` is complete (the asks its checks cover);
 *   2. the scope bounded AT `z` is complete too: a loss located at any cited action, or between them, is this
 *      decision's own (an unresolved answer at its own question call), and only a loss after every one is not;
 *   3. no root instruction was recorded after `a` and at or before `z`: the human spoke within the decision, and no
 *      check covers it (an answer between its question call and its edit; a queued prompt between two edits);
 *   4. it asked no one: no cited action is a question call (`asksHuman`), and no instruction answers a cited action
 *      (`answerTo`).
 * An action before every human ask has no history to certify (1). A cited action that cannot be placed fails closed.
 */
export function decisionInstructionHistoryComplete(session, actionEvents) {
  if (!Array.isArray(actionEvents) || !actionEvents.length
    || actionEvents.some((event) => !Number.isSafeInteger(event?.sequence))) return false;
  const first = Math.min(...actionEvents.map((event) => event.sequence));
  const last = Math.max(...actionEvents.map((event) => event.sequence));
  if (!instructionReviewScope(session, { upTo: first - 1 }).complete
    || !instructionReviewScope(session, { upTo: last }).complete) return false;
  if (actionEvents.some(asksHuman)) return false;
  const cited = new Set(actionEvents.map((event) => event.id).filter((id) => typeof id === 'string' && id));
  return !(session?.events ?? []).some((event) => event?.kind === 'instruction' && event.childId == null
    && ((typeof event.answerTo === 'string' && cited.has(event.answerTo))
      || (Number.isSafeInteger(event.sequence) && event.sequence > first && event.sequence <= last)));
}

/**
 * OWNER DECISION B (2026-10-01): which decisions a scope is complete FOR. A decision citing one action at sequence `a`
 * that asked no question has a complete human-instruction history exactly when `decisionInstructionHistoryComplete`
 * holds for it: the scope is complete bounded just before `a` (the asks its checks cover) and bounded at `a` (M33 U
 * repair: a loss at its own action is its own). This returns the earliest-action sequences for which that holds
 * within the scope bounded at `upTo`, as `{ from, through }` (both inclusive; `through` is Infinity for an unbounded
 * scope with nothing incomplete), or null when there are none. A decision citing more actions, or a question call, may
 * still be incomplete within it: the range is what a request can say, never what grounding certifies.
 *
 * It is computed in one pass for a window's request (`completeFor`): every cause the scope reads either holds at
 * every bound (a history flag, an unlocated loss, an event that cannot be placed) or first holds at one sequence and
 * at every later one — so the range ends just before the first — and a human ask must be recorded first. Grounding
 * never reads it — it asks the rule itself — and m33-u-unasked-scope.test.js checks the two agree at every earliest
 * action.
 */
export function instructionCompleteRange(session, { upTo = null } = {}) {
  const bounded = upTo != null;
  if ((bounded && !Number.isSafeInteger(upTo)) || !Array.isArray(session?.events)
    || !(session.instructionHistoryComplete === undefined || session.instructionHistoryComplete === true)) return null;
  let breakAt = Infinity;   // the least bound at which the scope is incomplete, and stays so
  const breaks = (sequence) => { if (sequence < breakAt) breakAt = sequence; };
  const rootInstructionLoss = rootInstructionLossOf(session);
  for (const gap of session.adapterGaps ?? []) {
    if (!rootInstructionLoss(gap)) continue;
    const named = locatedGapSequences(session, gap);
    if (named === null) return null;
    breaks(Math.min(...named));
  }
  let firstAsk = Infinity;
  const byId = new Map(), bySequence = new Set();
  for (const event of session.events) {
    if (event?.childId != null) continue;
    const sequence = event?.sequence;
    if (!Number.isSafeInteger(sequence)) return null;
    if (event.kind === 'instruction' && event.authority === 'human' && sequence < firstAsk) firstAsk = sequence;
    if (event.kind === 'instruction' && event.omitted === true) breaks(sequence);
    if (typeof event.id !== 'string' || !event.id || sequence < 0) { breaks(sequence); continue; }
    if (bySequence.has(sequence)) breaks(sequence);
    bySequence.add(sequence);
    if (!byId.has(event.id)) byId.set(event.id, []);
    byId.get(event.id).push(sequence);
    if (event.kind !== 'instruction') continue;
    if (event.authority !== 'human') { breaks(sequence); continue; }
    const { spans, complete } = session.textSpanInfoOf(event, 'text');
    const visible = spans.filter((span) => typeof span === 'string' && span.trim());
    if (!visible.length || !complete || visible.length !== 1) breaks(sequence);
  }
  // Two events of one id both examined: the bound that reaches the second of them.
  for (const sequences of byId.values())
    if (sequences.length > 1) breaks(sequences.sort((a, b) => a - b)[1]);
  const from = firstAsk + 1;
  const through = bounded ? Math.min(breakAt - 1, upTo) : breakAt - 1;
  return Number.isFinite(from) && from <= through ? { from, through } : null;
}

const exactObject = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && keys.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => keys.includes(key));

/**
 * "Made without asking you" (C-05): the column `unasked`, grounded only when the model's `review` checked, one check
 * each and none relevant, every human message recorded before the decision's earliest action — and, on a route whose
 * windows show the project's instruction files (`projectFilesShown`: a session-only review), every such file its
 * window showed the main agent before that action (`projectFilesBefore`, the set a covering receipt may cite; owner
 * decision D84). A check citing a listed file is read as the file's (role project-instructions, from the
 * cited event, whatever role the model wrote) and its quote must ground in that file. A check marking a message or a
 * listed file relevant, a missing or extra check, and a check of a file recorded after the action leave the column
 * unchecked, exactly alike. Structure only: which events, in which order, and literal quotes.
 */
function checkedInstructionAbsence(session, review, dimension, actionEvents, upTo = null, projectFilesShown = false) {
  const unchecked = (reason = 'column_unchecked') => ({ column: null, columnState: 'unchecked', reason });
  // M33 V (2026-10-03): whether this decision's instruction history COULD be certified is judged first, from the
  // recording alone, before the model's review is read. A window whose scope is incomplete tells the model not to
  // answer, so a decision there has no review; reading the review first named that `column_unchecked` ("the claimed
  // instruction was contradictory"), which was false: the cause is `instructions_partial`. The column is unchecked
  // either way; only the reason changes.
  // D59: the scope the window was shown — bounded at its end — is the one its review is checked
  // against. An action past that bound has instructions before it that the bounded scope cannot
  // speak for, so it can never be certified from it.
  if (!actionEvents.length || actionEvents.some((e) => !Number.isSafeInteger(e.sequence))
      || (upTo != null && actionEvents.some((e) => !(e.sequence <= upTo))))
    return unchecked('instructions_partial');
  const before = Math.min(...actionEvents.map((e) => e.sequence));
  // OWNER DECISION B (2026-10-01): completeness is THIS decision's, never the window's — the asks recorded before its
  // earliest action, exactly the ones its checks cover, and (M33 U repair) its own span: a loss located at or between
  // its cited actions, a human instruction within it, or a question it asked leaves it unchecked
  // (`decisionInstructionHistoryComplete`). Only a loss after every cited action cannot make it incomplete.
  const scope = instructionReviewScope(session, { upTo });
  if (scope.scopeDigest === null || !decisionInstructionHistoryComplete(session, actionEvents))
    return unchecked('instructions_partial');
  if (!exactObject(review, ['dimension', 'scopeDigest', 'noRelevantInstruction', 'checks'])
      || review.dimension !== dimension || typeof dimension !== 'string' || !dimension.trim()
      || review.noRelevantInstruction !== true || !Array.isArray(review.checks)) return unchecked();
  if (review.scopeDigest !== scope.scopeDigest) return unchecked('receipt_rejected');
  const expected = scope.instructions.filter((i) => i.sequence < before);
  // D84 (owner decision): the project instruction files the decision's window showed the main agent before
  // its earliest action are checked beside the human messages.
  // The fourth review of the code step: every such file the window showed (`filesShownBefore`): the review was asked
  // about each. The release review: a window never shows a file loaded after the session wrote it
  // (`shownProjectInstructions`), so none is checked here. Only the person's may settle a column or carry a forbidden
  // edit (`projectFilesBefore`).
  const files = projectFilesShown === true ? filesShownBefore(session, actionEvents, upTo) : [];
  if (review.checks.length !== expected.length + files.length) return unchecked();
  const remaining = new Set(expected.map((i) => i.eventId));
  const remainingFiles = new Set(files.map((file) => file.eventId));
  const checks = [];
  for (const check of review.checks) {
    if (!exactObject(check, ['instruction', 'relevant', 'explanation']) || check.relevant !== false
        || typeof check.explanation !== 'string' || !check.explanation.trim() || check.explanation.length > 1000
        || !exactObject(check.instruction, ['eventId', 'role', 'quote'])
        || typeof check.instruction.quote !== 'string' || check.instruction.quote.length > 400) return unchecked();
    const file = remainingFiles.delete(check.instruction.eventId);
    if (!file && (check.instruction.role !== 'instruction' || !remaining.delete(check.instruction.eventId)))
      return unchecked();
    const verified = verifyReceipt(session, file ? { ...check.instruction, role: PROJECT_INSTRUCTIONS_ROLE }
      : check.instruction);
    if (!verified.ok) return unchecked('receipt_rejected');
    checks.push({ instruction: verified.receipt, relevant: false, explanation: check.explanation });
  }
  return { column: 'unasked', columnState: 'grounded', reason: null,
    instructionReview: { dimension, scopeDigest: scope.scopeDigest, noRelevantInstruction: true, checks } };
}

/**
 * C-05 column derivation. Returns { column, columnState, reason }.
 *
 * The asymmetry here is deliberate and is the whole point of the three columns: a relation
 * that FAILS verification is counted and leaves the column unchecked. It is never discarded
 * and then re-read as silence, because "the agent was never told" and "we could not check
 * what the agent was told" are different claims about a human.
 */
export function deriveColumn(session, relation, instructionHistoryComplete, actionEvents = [], instructionReview = null,
  dimension = null, { upTo = null, actor: anchorActor = null, projectFilesShown = false } = {}) {
  // D71 (d): a choice not to act is anchored on the agent's statement (`actionEvents` is then that one event), whose
  // actor its caller resolved (`Session.actorForStatement`).
  const actor = anchorActor ?? (actionEvents.length ? session.actorForActions(actionEvents) : null);
  if (actor?.state === 'ambiguous')
    return { column: null, columnState: 'unchecked', reason: 'ambiguous_authority' };
  if (relation == null) {
    if (instructionHistoryComplete !== true)
      return { column: null, columnState: 'unchecked', reason: 'instructions_partial' };
    if (actor?.state === 'verified-child')
      return { column: null, columnState: 'unchecked', reason: 'instructions_partial' };
    return checkedInstructionAbsence(session, instructionReview, dimension, actionEvents, upTo, projectFilesShown);
  }

  // The three columns describe the relationship to applicable HUMAN instructions. A quote from
  // the agent's own commentary, a tool result or its own code is not an instruction, however
  // literally it grounds.
  // Owner decision D83 (2), on this path (the column fix): or to a project instruction file the main agent was
  // given before the decision (`projectFileColumn`). Which source it is comes from the event the receipt cites, never
  // from the role the model wrote; every other receipt is read exactly as before.
  if (session.event(relation.instruction?.eventId)?.kind === PROJECT_INSTRUCTIONS_ROLE)
    return projectFileColumn(session, relation, actionEvents, actor, upTo);
  if (relation.instruction?.role !== 'instruction')
    return { column: null, columnState: 'unchecked', reason: 'ambiguous_authority' };

  const check = verifyReceipt(session, relation.instruction);
  if (!check.ok) return { column: null, columnState: 'unchecked', reason: 'receipt_rejected' };

  const instructionEvent = session.event(relation.instruction.eventId);
  // C-05: "A parent assignment can constrain a child but cannot itself settle the human column."
  if (instructionEvent.authority !== 'human')
    return { column: null, columnState: 'unchecked', reason: 'ambiguous_authority' };
  // A root human ask may have reached a linked child, but this representation does not prove
  // its inherited scope or delivery. Keep the child decision while withholding its human column.
  if (actor?.state === 'verified-child')
    return { column: null, columnState: 'unchecked', reason: 'instructions_partial' };

  // C-05 receipt check "relevant instruction timing" / JG-03: later assent cannot settle an
  // earlier choice retroactively. An instruction given after the agent already acted may be a
  // real reaction to the work, but it is not what the agent was working under.
  const earliestAction = Math.min(...actionEvents.map((e) => e.sequence ?? Infinity));
  if (actionEvents.length && !(instructionEvent.sequence < earliestAction))
    return { column: null, columnState: 'unchecked', reason: 'ambiguous_authority' };
  // D59: and never one recorded after the window being judged — the window was not shown it.
  if (upTo != null && !(instructionEvent.sequence <= upTo))
    return { column: null, columnState: 'unchecked', reason: 'ambiguous_authority' };

  if (relation.settles === true) {
    const value = relation.settledValueQuote;
    // A settled column asserts the human fixed the VALUE. That needs the value in the same
    // instruction source, not merely a related-sounding instruction.
    // A one-character or whitespace "value" grounds against almost any instruction, so it
    // cannot carry the strongest column the ledger has.
    if (typeof value !== 'string' || value.trim().length < MIN_QUOTE_CHARS)
      return { column: null, columnState: 'unchecked', reason: 'column_unchecked' };
    // F43: a receipt, not a raw `text.includes(value)` search — so a near-miss (a curly quote
    // in the instruction, a straight one in the candidate) is repaired exactly like every other
    // receipt instead of silently downgrading the strongest column. One repair, then rejected.
    const settled = repairReceipt(session,
      { eventId: relation.instruction.eventId, role: 'instruction', quote: value });
    if (!settled.ok) return { column: null, columnState: 'unchecked', reason: 'receipt_rejected' };
    // F151, verified: `settled.receipt.quote` is always an exact substring — repair only proposes
    // one, and the strict check re-runs on it. But the row used to publish the model's `value`,
    // which a repair by definition is NOT. The value published is the one that grounded.
    // F158: and when code snapped it, it says so, so the row's repair is counted like a receipt's.
    return { column: 'asked-settled', columnState: 'grounded', reason: null,
      settledValueQuote: settled.receipt.quote, ...(settled.repaired === true ? { settledRepaired: true } : {}) };
  }

  if (relation.settles === false) {
    if (relation.settledValueQuote != null)
      return { column: null, columnState: 'unchecked', reason: 'column_unchecked' };
    return { column: 'asked-chose', columnState: 'grounded', reason: null };
  }

  return { column: null, columnState: 'unchecked', reason: 'column_unchecked' };
}

// ---- D71 (g): the project instruction files a window shows ---------------------------------------------------------

/**
 * D71 (g): the project's instruction files a window bounded at `bound` (its last event's sequence, `windowEnd`; null:
 * the whole session) is shown, in recorded order (prompt.js `projectInstructionParts` renders exactly these): each
 * recorded before that event (`afterSequence` below `bound`), with its visible spans — a file with nothing left to show
 * (redaction withheld it whole, or its text did not resolve) is not listed — and `same`, the id of the earlier entry of
 * the same path, helper and text it repeats (it is then named, not shown again), else null. Structure only. Pure.
 * (Moved here from prompt.js, as the withdrawn D83 (2) change did, so a check of what a window showed reads the
 * very list the window was rendered from.)
 */
export function shownProjectInstructions(session, bound = null) {
  // The release review (low): a file whose text the session itself wrote, edited or deleted is not the person's words,
  // so it is never shown under the project's instruction files, whose heading and brief present them as what the person
  // wrote for the agent: it is left out (the agent's write of it is an action the window shows), and a decision made
  // without asking you is not checked against it. The second release review (low): in time order — only a file loaded
  // after a session write of its path (`writtenBeforeLoaded`). A file loaded before any such write holds the person's
  // words as they were then, so every window shows it, and a decision it covers is checked against it, even when the
  // agent edits the file later (at the person's request or not); the later edit is shown as the agent's action.
  const entries = (Array.isArray(session?.projectInstructions) ? session.projectInstructions : [])
    .map((entry, at) => ({ entry, at })).filter(({ entry }) => Number.isSafeInteger(entry?.afterSequence)
      && (bound === null || entry.afterSequence < bound) && typeof entry.id === 'string'
      && !writtenBeforeLoaded(session, entry))
    .sort((a, b) => a.entry.afterSequence - b.entry.afterSequence || a.at - b.at).map(({ entry }) => entry);
  const first = new Map();
  const shown = [];
  for (const entry of entries) {
    const spans = session.textSpansOf(entry, 'text');
    if (!spans.some((span) => span.trim())) continue;
    const key = JSON.stringify([entry.path, entry.childId ?? null, spans]);
    const same = first.get(key) ?? null;
    if (same === null) first.set(key, entry.id);
    shown.push({ entry, spans, same });
  }
  return shown;
}

// ---- Owner decision D83 (2) on the normal column path: a project instruction file covers a decision -----------------

/** The typed operations that change a file. */
const FILE_CHANGES = Object.freeze(['write', 'edit', 'delete']);
/** Whether a path, slashes forward, is rooted: `/…` or a drive's `C:/…`. */
const rootedPath = (path) => /^(?:\/|[A-Za-z]:\/)/.test(path);
/** A recorded path as one file, whatever its spelling: slashes forward, `.` and `..` steps resolved by name. The slicer
 *  spells a project instruction file's path and a change's path alike (relative under the recorder's working directory,
 *  else as recorded). The release review (low): and compared the way a case-insensitive file system compares names
 *  (macOS's and Windows' default volumes), which hold `claude.md` and `CLAUDE.md` as one file — Unicode composed
 *  (NFC) and lower-cased. A pure rule cannot know the recorder's volume, so it fails closed: on a case-sensitive volume a
 *  write to `claude.md` also makes a `CLAUDE.md` the agent's, and rows resting on that file read not checked. The second
 *  release review (low): the slicer strips the working directory's prefix by its exact spelling, so a path written
 *  with that prefix in another case (`/REPO/sub/CLAUDE.md` under `/repo`) stays absolute while the file's own path is
 *  relative; both are first placed under `cwd`, the working directory the recording states (the session's
 *  `workingDirectory`), when it is rooted, and then compared. With no such directory, as recorded. String work only. */
const fileKey = (path, cwd = null) => {
  if (typeof path !== 'string' || !path) return null;
  const slashed = path.replaceAll('\\', '/');
  const base = typeof cwd === 'string' && rootedPath(cwd.replaceAll('\\', '/')) ? cwd.replaceAll('\\', '/') : null;
  const placed = base !== null && !rootedPath(slashed) ? posix.join(base, slashed) : slashed;
  return posix.normalize(placed).normalize('NFC').toLowerCase();
};
/** The working directory the session's recording states (the adapter's non-enumerable `workingDirectory`), or null. */
const workingDirectoryOf = (session) => (typeof session?.workingDirectory === 'string' ? session.workingDirectory : null);

/**
 * Whether a project instruction file's text is the person's words, by structure — the one rule every reader of a
 * project instruction file applies (the code step's actors, code-context.js `actorOf`; the session review's D83 (2)
 * column, its forbidden edits and its contradictions, through `projectFilesBefore` and `contradictionSourceOf`, and
 * forbidden.js): given to the main agent (no helper's), and its path changed by no typed write, edit or delete the
 * session holds — the agent's or a helper's, before or after the file was given, a write the slicer read off a shell
 * command included — whose outcome the record does not prove failed or cancelled. Fails closed: any such change makes
 * the file's text the agent's. The third review of the code step wrote it for the code step (a CLAUDE.md the agent
 * wrote in the session, then given back to it by the harness, was labelled the person's); its fourth review moved it
 * here so the session review reads the same rule (it still counted that file as the person's). Known limit: a write
 * the slicer does not type (`cp`, `mv`, `git checkout`, a write after a relative `cd`) is not seen. Pure.
 */
export function personsProjectFile(session, entry) {
  if (fileKey(entry?.path) === null || (entry.childId ?? null) !== null) return false;
  return !writtenInSession(session, entry);
}

/** Whether the session holds a typed write, edit or delete of a project instruction file's path (any spelling the
 *  file system takes as that path: `fileKey`), the agent's or a helper's, that the record does not prove failed or
 *  cancelled: the file's text is then the agent's. False for an entry with no path. Pure. */
export function writtenInSession(session, entry) {
  return writesOf(session, entry).length > 0;
}

/** The session's typed writes, edits and deletes of a project instruction file's path (`fileKey`), the agent's or a
 *  helper's, that could have changed it (D98, F9: the one effect rule, `CHANGING_EFFECTS`: the record does not prove it
 *  was refused before it ran, failed or was cancelled), in recorded order. Pure. */
function writesOf(session, entry) {
  const cwd = workingDirectoryOf(session);
  const key = fileKey(entry?.path, cwd);
  if (key === null) return [];
  const events = Array.isArray(session?.events) ? session.events : [];
  const effect = effectReader(session);
  return events.filter((event) => event?.kind === 'invocation' && FILE_CHANGES.includes(event.operation)
    && (Array.isArray(event.changes) ? event.changes : []).some((change) => fileKey(change?.path, cwd) === key)
    && CHANGING_EFFECTS.includes(effect(event)));
}

/** The second release review (low): whether a session write of a project instruction file's path (`writesOf`) comes
 *  before the file was loaded — at or before its `afterSequence`, the last event proven recorded before it; a write
 *  with no sequence counts as before (fails closed). The text loaded is then the agent's. A write recorded after the
 *  file was loaded leaves the loaded text the person's as it was. Pure. */
function writtenBeforeLoaded(session, entry) {
  return writesOf(session, entry).some((event) => !(event.sequence > entry.afterSequence));
}

/** The project instruction files a window bounded at `upTo` shows the main agent whole (`shownProjectInstructions`, not
 *  a repeat of an earlier one, and never one loaded after the session wrote it) before the earliest of `anchorEvents`,
 *  `{ entry }` in
 *  recorded order: what a decision made without asking you must be checked against (`checkedInstructionAbsence`). */
function filesShownBefore(session, anchorEvents, upTo = null) {
  const earliest = Math.min(...(Array.isArray(anchorEvents) ? anchorEvents : []).map((e) => e?.sequence ?? Infinity));
  return shownProjectInstructions(session, upTo ?? null)
    .filter(({ entry, same }) => same === null && (entry.childId ?? null) === null && entry.afterSequence < earliest
      && typeof entry.path === 'string' && entry.path)
    .map(({ entry }) => ({ eventId: entry.id, path: entry.path, entry }));
}

/**
 * The project instruction files a decision anchored at `anchorEvents` may cite as what it answers to,
 * `{ eventId, path }` in recorded order: every file its window (bounded at `upTo`) shows whole
 * (`shownProjectInstructions`, not a repeat of an earlier one), given to the main agent, recorded before the earliest
 * anchor — and (the fourth review of the code step) the person's words (`personsProjectFile`: a file the session
 * wrote is the agent's, never what the person said). Structure only. Pure.
 */
export function projectFilesBefore(session, anchorEvents, upTo = null) {
  return filesShownBefore(session, anchorEvents, upTo).filter(({ entry }) => personsProjectFile(session, entry))
    .map(({ eventId, path }) => ({ eventId, path }));
}

/**
 * Owner decision D83 (2) (2026-10-12), on the normal column path: what the person wrote for the agent in the project's
 * instruction files counts as their words. A decision's covering receipt (`relation.instruction`) that cites a project
 * instruction file (the session's `projectInstructions`) — its role is the file's (project-instructions), whatever
 * role the model wrote — gives the column only when:
 *   - its quote grounds verbatim in that file (else `receipt_rejected`);
 *   - the decision is the main agent's (a helper's: `instructions_partial`, as a human ask reaching a helper);
 *   - the file is one its window showed the main agent before the decision's earliest action, and the person's words
 *     (`projectFilesBefore`, `personsProjectFile`: the fourth review of the code step, a file the session wrote is the
 *     agent's; else `ambiguous_authority`, as a human instruction recorded after it, or an agent's message);
 *   - asked-settled: its value quote grounds verbatim in that same file, by the rules a human instruction's does;
 *     asked-chose: no value quote.
 * A grounded column carries `referredFrom`, the file's recorded path, which the row publishes on its `constrainedBy`.
 */
function projectFileColumn(session, relation, anchorEvents, actor, upTo) {
  const unchecked = (reason) => ({ column: null, columnState: 'unchecked', reason });
  const instruction = { ...relation.instruction, role: PROJECT_INSTRUCTIONS_ROLE };
  if (!verifyReceipt(session, instruction).ok) return unchecked('receipt_rejected');
  if (actor?.state === 'verified-child') return unchecked('instructions_partial');
  const listed = projectFilesBefore(session, anchorEvents, upTo).find((file) => file.eventId === instruction.eventId);
  if (!listed) return unchecked('ambiguous_authority');
  const referredFrom = listed.path;
  if (relation.settles === true) {
    const value = relation.settledValueQuote;
    if (typeof value !== 'string' || value.trim().length < MIN_QUOTE_CHARS) return unchecked('column_unchecked');
    const settled = repairReceipt(session,
      { eventId: instruction.eventId, role: PROJECT_INSTRUCTIONS_ROLE, quote: value });
    if (!settled.ok) return unchecked('receipt_rejected');
    return { column: 'asked-settled', columnState: 'grounded', reason: null, referredFrom,
      settledValueQuote: settled.receipt.quote, ...(settled.repaired === true ? { settledRepaired: true } : {}) };
  }
  if (relation.settles === false) {
    if (relation.settledValueQuote != null) return unchecked('column_unchecked');
    return { column: 'asked-chose', columnState: 'grounded', reason: null, referredFrom };
  }
  return unchecked('column_unchecked');
}

/**
 * The covering receipt of a decision (`constrainedBy`) with the role of the source it cites: a receipt citing a project
 * instruction file takes role project-instructions, whatever role the model wrote — which source it is comes from the
 * recording, never from the model's word. Anything else, and a `constrainedBy` that is not an object with an
 * instruction, is returned as it came (the same object). Pure.
 */
export function constraintWithSourceRole(session, constrainedBy) {
  const instruction = plainObject(constrainedBy) ? constrainedBy.instruction : null;
  if (!plainObject(instruction) || instruction.role === PROJECT_INSTRUCTIONS_ROLE
      || typeof session?.event !== 'function' || session.event(instruction.eventId)?.kind !== PROJECT_INSTRUCTIONS_ROLE)
    return constrainedBy;
  return { ...constrainedBy, instruction: { ...instruction, role: PROJECT_INSTRUCTIONS_ROLE } };
}

/**
 * D84 (owner decision): the checks of an `instructionReview` with the role of the source each cites, as
 * `constraintWithSourceRole` gives a covering receipt: a check citing a project instruction file takes role
 * project-instructions, whatever role the model wrote. Anything else, and a review with no such check, is returned
 * as it came (the same object). Pure.
 */
export function reviewWithSourceRoles(session, instructionReview) {
  const checks = plainObject(instructionReview) && Array.isArray(instructionReview.checks) ? instructionReview.checks
    : null;
  if (!checks) return instructionReview;
  // A check is `{ instruction, relevant, explanation }`: its instruction is read exactly as a covering receipt's.
  const withRoles = checks.map((check) => constraintWithSourceRole(session, check));
  return withRoles.every((check, at) => check === checks[at]) ? instructionReview
    : { ...instructionReview, checks: withRoles };
}

// ---- D83 (3): the agent's housekeeping is not a decision ------------------------------------------------------------

const WRITE_OPERATIONS = Object.freeze(['write', 'edit', 'delete']);
const READ_ONLY_COMMAND_TYPES = Object.freeze(['read', 'search', 'list_files']);
/** A tool write (not one parsed from a command) with at least one recorded change, every change matching `where`. */
const toolWriteAll = (event, where) => event?.kind === 'invocation' && WRITE_OPERATIONS.includes(event.operation)
  && typeof event.shellWriteOf !== 'string' && Array.isArray(event.changes) && event.changes.length > 0
  && event.changes.every((change) => plainObject(change) && where(change));
/** Does the recording hold a tool write with a change inside the repository (the slicer's write scope)? */
const writesInsideRepository = (session) => (Array.isArray(session?.events) ? session.events : []).some((event) =>
  event?.kind === 'invocation' && WRITE_OPERATIONS.includes(event.operation) && typeof event.shellWriteOf !== 'string'
  && Array.isArray(event.changes) && event.changes.some((change) => plainObject(change)
    && change.outsideRepository !== true));

/**
 * D83 (3)'s `writes_nothing`, one reading for every reader of it (E1-F8, D112): a call that writes nothing by the type
 * the recorder or the slicer gave it — a read or a search of the slicer's typed read kind (session.js `isRead`: Read,
 * NotebookRead, Glob, Grep, the vetted MCP file read), or a command the recorder itself typed as only reading,
 * searching or listing (a Codex `parsed_cmd` whose every entry is `read`, `search` or `list_files`). A command the
 * recorder did not type so (every Claude Code shell command) is never one; no command text is read. The housekeeping
 * kinds (`housekeepingKinds`) and the report's default tier of a refused read (render/report-model.js) read this. Pure.
 */
export function writesNothing(event) {
  const parsed = event?.recorded?.parsedCmd;
  return event?.kind === 'invocation' && (isRead(event) || (event.operation === 'command' && Array.isArray(parsed)
    && parsed.length > 0 && parsed.every((entry) => READ_ONLY_COMMAND_TYPES.includes(entry?.type))));
}

/**
 * D83 (3), owner decision 2026-10-12: the HOUSEKEEPING_KINDS of a decision's cited actions, in that order, when every
 * one of them is housekeeping by structure; else null (a decision citing no action — a choice not to act anchored on
 * the agent's words — is never housekeeping). Only typed fields: an action's kind and operation, the slicer's read
 * kind, the recorder's typed reading of a command (`recorded.parsedCmd`, read by `writesNothing`), a write's recorded
 * changes and their write scope, whether it was parsed from a command, and whether the recording holds a write inside
 * the repository. Pure.
 */
export function housekeepingKinds(session, actionEvents) {
  if (!Array.isArray(actionEvents) || !actionEvents.length) return null;
  const kinds = new Set();
  let inside = null;
  for (const event of actionEvents) {
    if (writesNothing(event)) {
      kinds.add('writes_nothing');
      continue;
    }
    if (toolWriteAll(event, (change) => change.outsideRepository === true)
        && (inside ??= writesInsideRepository(session))) {
      kinds.add('outside_repository');
      continue;
    }
    return null;
  }
  return HOUSEKEEPING_KINDS.filter((kind) => kinds.has(kind));
}

/** C-05: value and valueReceipt are both present or both null — except (D79) a `value_paraphrased` row, which keeps
 *  its checked receipt with a null value; the receipt must cite an action. */
const VALUE_FIELDS = Object.freeze(['added-code', 'path', 'command']);

/**
 * D80 (owner decision 2026-10-12): the one closed reason a quote is refused for when its only verbatim location is the
 * body of a write the slicer parsed from a command whose typed end says it did not run, failed or stopped before it
 * finished (`unrunEnd`, `unrunWrite`, `quotesOnlyUnrunWrite` below): a write that may not have happened cannot prove
 * work was done. One token (named before the D80 integration added the stopped end, and kept), a member of every
 * closed list a quote checked against the session is refused in: a decision's value (VALUE_UNCHECKED_CAUSES), a
 * requirement's deliverable (REQUIREMENT_UNCHECKED_REASONS), a failure row's response (FAILURE_UNCHECKED_REASONS), a
 * written statement (WRITTEN_WITHHELD_CAUSES) and a challenge vote's receipt (challenge.js VOTE_REJECTION_CAUSES).
 */
export const UNRUN_WRITE_REASON = 'write_command_not_run_or_failed';

/**
 * M33 G4. WHY a decision's value is unchecked, recorded on the row as `valueUnchecked: { cause,
 * action }` beside the unchanged `reasons`, so the reader is told the cause this code found and no
 * other (review.js says each in one closed sentence). `action` is the cited write for the two write
 * causes, the paraphrase cause and D80's cause, else null. A grounded row carries no such field.
 *   not_proposed           no value was proposed (a behavioural choice) — nothing failed to check out
 *   unquoted               a value was proposed with no quote of the action that adopted it
 *   unmatched              the value's quote did not check out against the actions the decision cites
 *   write_outcome_unknown  the value's quote grounds on a cited write whose outcome is not recorded
 *   write_unsuccessful     the value's quote grounds on a cited write recorded as failed or cancelled
 *   value_paraphrased      (D79) the quote is verbatim on the after side of a cited write that succeeded, and every
 *                          other check holds, but the value is not word for word in the quote (the only fact checked;
 *                          D79 calls such a value a paraphrase): the receipt is published (the code it quotes is what
 *                          was written), the value is null
 *   write_command_not_run_or_failed  (D80, UNRUN_WRITE_REASON) the quote is verbatim on the after side of a cited write
 *                          the slicer parsed from a command that did not run, failed or stopped before it finished
 *                          (`unrunEnd`), and nowhere else that happened (`quotesOnlyUnrunWrite`): judged before the
 *                          write's own outcome, whatever the value
 */
export const VALUE_UNCHECKED_CAUSES = Object.freeze(['not_proposed', 'unquoted', 'unmatched',
  'write_outcome_unknown', 'write_unsuccessful', 'value_paraphrased', UNRUN_WRITE_REASON]);
const [NOT_PROPOSED, UNQUOTED, UNMATCHED, WRITE_OUTCOME_UNKNOWN, WRITE_UNSUCCESSFUL, VALUE_PARAPHRASED] =
  VALUE_UNCHECKED_CAUSES;
/** D98 (F9): the effects (session.js ACTION_EFFECTS) the record states as a write that did not happen — refused
 *  before it ran, or failed or cancelled — and the one that proves it landed. */
const [NO_EFFECT, UNDONE_EFFECT, LANDED_EFFECT] = ACTION_EFFECTS;
const WRITE_NOT_DONE = Object.freeze([NO_EFFECT, UNDONE_EFFECT]);

function groundValue(session, candidate, actionEvents, upTo = null) {
  const { value, valueReceipt } = candidate;
  const unchecked = (reason, cause, action = null) => ({ value: null, valueReceipt: null, valueState: 'unchecked',
    reason, valueUnchecked: { cause, action } });
  if (value == null) return unchecked('value_unchecked', NOT_PROPOSED);
  if (valueReceipt == null) return unchecked('value_unchecked', UNQUOTED);

  const check = verifyReceipt(session, valueReceipt);
  if (!check.ok) return unchecked('receipt_rejected', UNMATCHED);

  // It must point at one of THIS decision's cited invocations — it cannot borrow the same
  // literal from an unrelated action.
  if (!actionEvents.some((e) => e.id === valueReceipt.eventId)) return unchecked('receipt_rejected', UNMATCHED);

  // The quoted literal must actually be the value being claimed. D79: judged LAST, once every check of the quote
  // itself has held (below) — a verbatim `added-code` quote on a succeeded write that does not contain the value word
  // for word is published as `value_paraphrased` with its value null, so a reader sees the code it wrote;
  // on any other field, or when any check of the quote fails, the row is `unmatched` exactly as before.
  const literal = String(valueReceipt.quote).includes(value);

  // C-05 fixes what each field may quote. Without this, a fragment of a path or an unrelated
  // command string is displayed as "what was adopted".
  if (!VALUE_FIELDS.includes(valueReceipt.field)) return unchecked('value_unchecked', UNMATCHED);
  const cited = actionEvents.find((e) => e.id === valueReceipt.eventId);
  if (valueReceipt.field === 'path') {
    // "quotes one complete paths[].path" — a prefix such as `config/redis` is not the path.
    const exact = (cited.paths ?? []).some((p) => p.path === value);
    if (!exact) return unchecked('value_unchecked', UNMATCHED);
  }

  // B1b/F68: a value grounds on the SIDE it claims. Since B1 both sides of a change are role
  // `code`, and `verifyReceipt` accepts a quote from either — so without this an `added-code`
  // value could quote a line the edit REMOVED and be published as what the session adopted.
  // The map is over VALUE_FIELDS: `path` and `command` are not code sides, and no removed-code
  // field exists today; when one is added it belongs here, pointing at `before`.
  // G4: checked before the write's outcome, so an outcome is only ever named for a quote that did
  // ground on the side it claims — the outcome is then the one thing short of adoption.
  const side = { 'added-code': 'after' }[valueReceipt.field] ?? null;
  if (side && !(cited.changes ?? []).some((change) =>
    session.textSpansOf(change, side).some((span) => span.includes(valueReceipt.quote))))
    return unchecked('value_unchecked', UNMATCHED);

  // D80 (owner decision 2026-10-12): a quote whose only verbatim location is the body of a write whose command did not
  // run, failed or stopped before it finished (`unrunEnd`) is refused by that typed end — before the write's own
  // outcome is named, whatever the value says.
  // No source map here: the places read are the session's (the window's view, `shownSession`), only up to `upTo`.
  if (quotesOnlyUnrunWrite(session, valueReceipt, { until: upTo }))
    return unchecked('value_unchecked', UNRUN_WRITE_REASON, cited.id);

  // C-05: "Adoption of a written code value needs the reported successful write or verified
  // resulting code." A failed or denied write changed nothing, so its after-text is an attempt,
  // never an adopted value. D79: a paraphrased value on such a write stays `unmatched` (the cause it
  // had before the paraphrase was kept apart), never a published receipt.
  // D98 (F9): by the one effect rule: a write refused before it ran is no adopted value either.
  const effect = FILE_CHANGES.includes(cited.operation) ? effectOf(session, cited) : LANDED_EFFECT;
  if (effect !== LANDED_EFFECT) {
    if (!literal) return unchecked('value_unchecked', UNMATCHED);
    return unchecked('value_unchecked', WRITE_NOT_DONE.includes(effect) ? WRITE_UNSUCCESSFUL : WRITE_OUTCOME_UNKNOWN,
      cited.id);
  }

  if (literal) {
    return { value, valueReceipt: check.receipt, valueState: 'grounded', reason: null, valueUnchecked: null };
  }
  // D79 (owner decision 2026-10-11): only a code side carries a paraphrase; a command's or a path's value is its words.
  if (side === null) return unchecked('value_unchecked', UNMATCHED);
  return { value: null, valueReceipt: check.receipt, valueState: 'unchecked', reason: 'value_unchecked',
    valueUnchecked: { cause: VALUE_PARAPHRASED, action: cited.id } };
}

// F157: why a decision's place in the PR is `unchecked`, recorded on the row (`relevanceUnknown`).
// Closed; the renderer says each in its own words.
//   file_list_missing  the PR supplied no file list at all, so nothing could be looked up in it
//   file_partial       the PR supplied the decision's own file, or its file list, only partly
export const RELEVANCE_UNKNOWN = Object.freeze(['file_list_missing', 'file_partial']);

/**
 * Did the choice survive into the PR, or is it only a session effect? `{ relevance, unknown }`:
 * `unknown` is the RELEVANCE_UNKNOWN reason when `relevance` is `unchecked`, else null.
 * A command that ran and failed changed no code; saying it "survives" would accuse the patch
 * of containing something it does not contain (RV-01).
 */
function deriveRelevance(session, actionEvents, pr) {
  const relevance = relevanceOf(session, actionEvents, pr);
  return typeof relevance === 'string' ? { relevance, unknown: null } : relevance;
}

function relevanceOf(session, actionEvents, pr) {
  // B10: a `sed -i`, `tee` or heredoc is a real write the tool stream never reports. The slicer
  // emits it as a sibling edit event beside the command, and the adapter records which command
  // it belongs to. The sibling carries the path; the command carries the outcome. Reading either
  // one alone told the author "ran, changed no code" or "no record that it ran" about a change
  // that succeeded and is in the diff.
  const siblingsOf = (id) => (session.events ?? []).filter((e) =>
    e.kind === 'invocation' && e.shellWriteOf === id);

  // A write that failed or was denied did not put anything in the PR, whatever its after-text
  // says, so it must not be reported as surviving code. D98 (F9): by the one effect rule (landed).
  const effect = effectReader(session);
  const effective = actionEvents.filter((e) => !FILE_CHANGES.includes(e.operation) || effect(e) === LANDED_EFFECT);
  const paths = effective.flatMap((e) => [
    ...(e.paths ?? []).map((p) => p.path),
    // Only a command the record says SUCCEEDED establishes that its shell writes happened.
    ...(e.operation === 'command' && effect(e) === LANDED_EFFECT
      ? siblingsOf(e.id).filter((s) => effect(s) === LANDED_EFFECT)
        .flatMap((s) => (s.paths ?? []).map((p) => p.path)) : []),
  ]).filter(Boolean);

  if (!paths.length) {
    if (!actionEvents.length) return 'unchecked';
    // Three different things, and collapsing them states something false about the author:
    //   succeeded/failed  -> it ran, and we know how it went
    //   unknown           -> it ran; the recorder could not classify the result
    //   no observation    -> we have no evidence it ever ran
    // Reading "unknown outcome" as "did not run" is a confident false claim, and most shell
    // commands land in exactly that bucket because a recorder cannot grade arbitrary shell.
    const ran = actionEvents.some((e) => session.observationFor(e.shellWriteOf ?? e.id) != null);
    return ran ? 'session-effect' : 'attempted';
  }
  // No PR file list at all means we never looked. Saying "not in this PR" here would assert an
  // absence we did not check.
  if (!pr?.files?.length) return { relevance: 'unchecked', unknown: 'file_list_missing' };
  // W3d-2: a renamed file is in the PR under its new name, and what the session wrote under
  // its OLD name is in it too — when the renamed file's content is complete. A partial one is
  // the decision's own file, and stays unknown below (W3d-1).
  const inPr = new Set(pr.files.filter((f) => f.change !== 'deleted').flatMap((f) => [f.path,
    ...(typeof f.oldPath === 'string' && f.contentState === 'complete' ? [f.oldPath] : [])]));
  if (paths.some((p) => inPr.has(p))) return 'survives';
  // B11: an absence from an INCOMPLETE list is not an absence. The GitHub reader declares
  // `enumeration: 'partial'` on its 3,000-file cap, and an unlisted file could hold the path, so
  // "not in this PR" there is a false statement about the patch. Presence still grounds — a path
  // that IS listed survives whatever else the listing lost.
  // W3d-1: a file whose `contentState` is short of complete makes the answer unknown only for
  // a decision whose OWN path it is (as the file or, for a rename, its old path). Any partial
  // file used to do it for every decision, so one redacted hunk left every decision in every
  // window "relevance unchecked" — about files that were complete and fully read.
  const own = new Set(paths);
  if (pr.enumeration !== 'complete' || pr.files.some((f) => f.contentState !== 'complete'
      && (own.has(f.path) || (typeof f.oldPath === 'string' && own.has(f.oldPath)))))
    return { relevance: 'unchecked', unknown: 'file_partial' };
  return 'reverted';
}

/** Ground one decision candidate into a Decision row, or reject it with a counted reason.
 *  `upTo` (D59) is the end of the window the candidate was proposed in: its authority column is
 *  checked against the instructions recorded up to there. Null checks it against the session. */
/**
 * S6 (S5 review H1), owner decision D71 (b) ("when unsure, keep the row with its weakest status ... could not tell"): the
 * mark code puts on a session-only decision candidate whose own challenge item ended unsettled or unexecuted
 * (run-review.js), holding the closed reason (UNSETTLED_CHALLENGE: `unsettled`, `unreviewed_scope`). A decision so marked
 * is grounded like any other and published "could not tell" (column unchecked, with that reason): kept, never shown
 * stronger than its check. A Symbol, so no answer a model writes (JSON) can carry it; a refuted decision is never marked
 * (it is left out: that is not unsure). W1 A (owner decision 2026-10-13): except one refuted only on who decided it — its
 * choice upheld by its own check, and no other column upheld after the reviewer was asked once more (run-review.js
 * `recolumnedDecisions`) — marked DECISION_COLUMN_REFUTED and published "could not tell" with that reason, the same way.
 * G2 (owner decision 2026-10-15): a choice not to act anchored anew whose choice its existence check upheld, and whose
 * check with the column its re-ask gave refuted it, is marked DECISION_COLUMN_REFUTED too; one whose check with that
 * column did not settle or did not run is marked with how it ended (UNSETTLED_CHALLENGE), as S6 marks a decision
 * (run-review.js `reanchoredChoices`).
 */
export const CHALLENGE_ENDED = Symbol('sonah.challenge-ended');
/** W1 A: the closed reason of a decision kept "could not tell" because its check refuted who decided it and no other
 *  column held (a JUDGMENT_REASONS member; DECISION_RECOLUMN_WITHHELD counts why no other column held). */
export const DECISION_COLUMN_REFUTED = 'decision_column_refuted';

export function groundDecision({ repo, session, pr, candidate, instructionHistoryComplete, upTo = null,
  notActing: notActingAllowed = false, projectFilesShown = false }) {
  const forbidden = carriesForbiddenField(candidate);
  if (forbidden) return { ok: false, reason: 'kind_rejected', detail: `model supplied ${forbidden}` };

  // Shape first. A non-string dimension used to throw out of the sort and destroy a report that
  // already held a supported DECIDE — one malformed candidate must never suppress real findings.
  if (typeof candidate.dimension !== 'string' || !candidate.dimension.trim())
    return { ok: false, reason: 'kind_rejected', detail: 'dimension is not a string' };
  if (typeof candidate.chosen !== 'string' || !candidate.chosen.trim())
    return { ok: false, reason: 'kind_rejected', detail: 'chosen is not a string' };

  const actionEvents = (candidate.actions ?? []).map((id) => session.event(id)).filter(Boolean);
  const actionsResolved = actionEvents.length === (candidate.actions ?? []).length;
  if (!actionsResolved) return { ok: false, reason: 'receipt_rejected' };
  // D71 (d), owner decision 2026-10-08: on a session-only review (`notActingAllowed`), a choice not to act is a decision
  // even with no adopting action — anchored on the agent's own words (`stated`, a commentary event), whose actor and
  // recorded place stand where its earliest action would. Whether those words state a choice not to act is the
  // challenge's (challenge.js), never a word list. Any other decision with no action is rejected `no_actions`, as before.
  const notActing = notActingAllowed === true && candidate.notActing === true;
  const statedEvent = notActing && plainObject(candidate.stated) && typeof candidate.stated.eventId === 'string'
    ? session.event(candidate.stated.eventId) : null;
  const anchoredOnWords = !actionEvents.length && notActing && statedEvent?.kind === 'commentary';
  if (!actionEvents.length && !anchoredOnWords) return { ok: false, reason: 'no_actions' };
  if (actionEvents.some((e) => e.kind !== 'invocation')) return { ok: false, reason: 'receipt_rejected' };
  const actor = anchoredOnWords ? session.actorForStatement(statedEvent) : session.actorForActions(actionEvents);
  const anchorEvents = anchoredOnWords ? [statedEvent] : actionEvents;
  // M33 G4 (C-06): cited actions of more than one actor, or of none, withhold the decision
  // (`actor_ambiguous`, WITHHELD_REASON_CAUSES): grounding ran and could not name one actor. A
  // candidate naming another actor than the one its actions resolve to was not proposed in a shape
  // this code can evaluate (live candidates take their actor from `toCandidates`), and still caps.
  if (actor.state === 'ambiguous') return { ok: false, reason: 'ambiguous_authority', cause: 'actor_ambiguous' };
  if (candidate.actorSession !== actor.sessionKey) return { ok: false, reason: 'ambiguous_authority' };

  // W3-3. Every receipt this decision cites is offered one deterministic repair first: a
  // near-miss is snapped to the exact source substring, or it stays rejected. What follows is
  // unchanged — each snapped quote is verified again, by string search, below and in
  // `deriveColumn`. Repairing here rather than inside each check keeps the column derivation
  // reading exactly one thing: a quote that already grounds.
  // F77: a snapped receipt carries `repaired: true` and its `original`; any other receipt leaves
  // here with no repair field at all, so a model cannot flag its own quote (or be counted for it).
  const snap = (receipt) => {
    if (!receipt) return receipt;
    const out = repairReceipt(session, receipt);
    return out.ok && out.repaired === true ? publishedReceipt(out) : withoutRepairFields(receipt);
  };

  const statedReceipt = snap(candidate.stated);
  const stated = statedReceipt ? verifyReceipt(session, statedReceipt) : null;
  if (candidate.stated && !stated.ok) return { ok: false, reason: 'receipt_rejected' };

  // A covering receipt citing a project instruction file takes that file's role before it is snapped
  // (`constraintWithSourceRole`); `referredFrom` is code's alone (`projectFileColumn`), never a model's.
  const proposedConstraint = constraintWithSourceRole(session, candidate.constrainedBy);
  const { referredFrom: _proposedReferral, ...proposedRest } = plainObject(proposedConstraint) ? proposedConstraint
    : {};
  const constrainedBy = proposedConstraint?.instruction
    ? { ...proposedRest, instruction: snap(proposedConstraint.instruction) }
    : proposedConstraint;

  // S6 (S5 review H1): a decision whose own challenge did not settle is published "could not tell", with how its check
  // ended (CHALLENGE_ENDED); its column is never derived, so no proposed relation to an instruction is shown. W1 A: and so
  // is one whose check refuted who decided it, with no other column upheld (DECISION_COLUMN_REFUTED).
  const ended = [...UNSETTLED_CHALLENGE, DECISION_COLUMN_REFUTED].includes(candidate[CHALLENGE_ENDED])
    ? candidate[CHALLENGE_ENDED] : null;
  const { column, columnState, reason: columnReason, instructionReview = null, settledValueQuote, settledRepaired,
    referredFrom } = ended
    ? { column: null, columnState: 'unchecked', reason: ended }
    : deriveColumn(session, constrainedBy, instructionHistoryComplete, anchorEvents, candidate.instructionReview,
      candidate.dimension, { upTo, projectFilesShown, ...(anchoredOnWords ? { actor } : {}) });
  // F151: an asked-settled row publishes the settled value exactly as the instruction says it. D83 (2): a row a project
  // instruction file covers names that file by its recorded path (`referredFrom`).
  const publishedConstraint = settledValueQuote === undefined && referredFrom === undefined ? constrainedBy
    : { ...constrainedBy, ...(settledValueQuote === undefined ? {} : { settledValueQuote }),
      ...(referredFrom === undefined ? {} : { referredFrom }) };

  // A later human amendment can reverse an earlier rule. `supersedes` is a RECORDED relationship
  // (C-02), not an inference, so it is safe to surface — and it has to be surfaced: a reviewer
  // who remembers writing the original rule would otherwise read the amended choice as a breach.
  const amends = columnState === 'grounded' && constrainedBy
    ? (session.event(constrainedBy.instruction.eventId)?.supersedes ?? [])
        .map((id) => session.event(id))
        .filter((e) => e && e.kind === 'instruction' && e.authority === 'human')
        .map((e) => e.id)
    : [];
  const { value, valueReceipt, valueState, reason: valueReason, valueUnchecked } = groundValue(session,
    { ...candidate, valueReceipt: snap(candidate.valueReceipt) }, actionEvents, upTo);
  const { materiality, rule } = materialityOf(candidate, actionEvents);
  const { relevance, unknown: relevanceUnknown } = deriveRelevance(session, actionEvents, pr);

  const decision = {
    actorSession: candidate.actorSession,
    dimension: candidate.dimension,
    chosen: candidate.chosen,
    value, valueReceipt, valueState,
    actions: candidate.actions ?? [],
    stated: stated?.ok ? stated.receipt : null,
    constrainedBy: columnState === 'grounded' && constrainedBy ? publishedConstraint : null,
    instructionReview,
    column, columnState, amends,
    materiality, materialityRule: rule,
    relevance,
    // F157: present only when the place is unknown, so every other row is byte-for-byte unchanged.
    ...(relevanceUnknown ? { relevanceUnknown } : {}),
    // M33 G4: why the value is unchecked (VALUE_UNCHECKED_CAUSES), present only when it is, so every
    // grounded row is byte-for-byte unchanged.
    ...(valueUnchecked ? { valueUnchecked } : {}),
    reasons: [columnReason, valueReason].filter(Boolean),
    // D71 (d): a choice not to act, flagged so every reader highlights it — present only on one, so every other row keeps
    // its bytes.
    ...(notActing ? { notActing: true } : {}),
  };
  decision.id = decisionIdentity(repo, decision);
  // Counted from what the row actually PUBLISHES: a receipt that was snapped but then failed a
  // later check is not a repair the reader ever sees, and must not be reported as one.
  // F158: a settled value is a string, not a receipt, but code snapped it to the instruction's exact
  // text just the same — and the row publishes it only with its grounded constraint.
  const receiptsRepaired = [decision.stated, decision.valueReceipt, decision.constrainedBy?.instruction]
    .filter((r) => r && r.repaired === true).length
    + (settledRepaired === true && decision.constrainedBy?.settledValueQuote === settledValueQuote ? 1 : 0);
  return { ok: true, decision, receiptsRepaired };
}

// ---- findings -------------------------------------------------------------------------

// ---- M33 self-corrected claims (C-06, owner decision 2026-09-29) ------------------------
//
// A `claim_contradicted` finding is self-corrected when the narrative supplies, and THIS code
// verifies, a `resolvedBy` pair: a later observation showing the claimed state and a later
// commentary in which the agent states the corrected result. Code, never the model, assigns the
// status: a verified pair publishes the finding FYI with the closed disclosure reason below and both
// resolution receipts; anything else leaves it DECIDE, byte for byte, and counts why. Refreeze after
// review: "verified" means every code check below passed AND the resolution, challenged as its own
// item apart from the contradiction, survived with two grounded support votes.

/**
 * The closed disclosure reasons a published finding may carry (C-06). Only code sets one, and each publishes a
 * `claim_contradicted` finding FYI:
 *   self_corrected   a verified resolution (below)
 *   helper_internal  (M33 H, owner decision 2026-10-01) the statement is a helper's own (`helperStatement`): its
 *                    commentary or its report to the parent, which the human is not shown. A helper's claim that is
 *                    also self-corrected stays helper_internal and keeps its verified resolution receipts.
 *   disclosed        (M33 brittleness M4) an `edit_under_negative_requirement` finding whose proposed disclosure
 *                    (`disclosedBy`: the main agent's own statement — the only one the human is shown — recorded after
 *                    the action, quoted verbatim) passed every
 *                    code check (`editDisclosure`, DISCLOSURE_REJECTIONS) and whose own challenge item — did that
 *                    statement tell the human about this change? — was upheld. Never the mere presence of an agent
 *                    statement among the finding's receipts. Owner decision 2026-10-06 ("disclosed means FYI" on both
 *                    routes; reverses M33 N's choice for the session-only route): the combined route's joint finding and
 *                    the session-only forbidden-edit route's upheld edit (its `reportedBy`) take the same check, the same
 *                    item and the same rule — one code path.
 */
export const DISCLOSURE_REASONS = Object.freeze(['self_corrected', 'helper_internal', 'disclosed']);
const [SELF_CORRECTED, HELPER_INTERNAL, DISCLOSED] = DISCLOSURE_REASONS;

// ---- M33 brittleness M4: a disclosure is its own proposition ----------------------------------------------------------
//
// The combined route published an `edit_under_negative_requirement` finding FYI ("disclosed") whenever any of its
// receipts had role commentary: a model citing the agent's own announcement of the edit, to show what happened, turned a
// breach into FYI. Whether the agent told the human about the change is meaning, so it is now a proposition of its own:
// a separate field (`disclosedBy`), checked by code, then judged by the challengers in code's fixed words; only an
// upheld one sets `disclosureReason: disclosed`. Owner decision 2026-10-06: on both routes — the session-only
// forbidden-edit route's agent statement (`reportedBy`) is its edit's `disclosedBy`, put through this same check, the
// same item (challenge.js `disclosureItem`) and the same step (`disclosureAsks`, `disclosureOutcomes`). Disclosure
// narrowed (owner decision 2026-10-06, `sonah.challenge/16`): the item asks whether the statement told the human that the
// agent went against the human's instruction by the change (challenge.js DISCLOSURE_PROPOSITION); code's checks here
// are unchanged.

/** The challenge item type of a proposed disclosure (its own run, `challenge:<label>:disclosure:…`). */
export const DISCLOSURE_ITEM_TYPE = 'disclosure';

/** A project rule: evidence quotes are at most 120 characters. The one frozen literal every bound on an evidence quote reads (S6,
 *  S5 review L2): a disclosure, a checklist deliverable, shortfall or failure response, a contradiction from a human
 *  message, a file's recorded content or the project's instruction file, and the brief's quoting rule. */
export const EVIDENCE_QUOTE_MAX = 120;
/** The longest disclosure quote code admits (EVIDENCE_QUOTE_MAX). */
export const DISCLOSURE_QUOTE_MAX_CHARS = EVIDENCE_QUOTE_MAX;

// Why a proposed disclosure did not make its finding FYI — one closed reason each, in this order; the finding itself is
// published as it grounds, DECIDE. Counted in `counts.disclosures.rejected`.
//   malformed    not exactly {eventId, role: "commentary", quote}, each a string, the quote 4–120 characters; or on a
//                finding that is not an edit against a human instruction
//   unsupplied   its event was not supplied to the request that proposed it — the route's fact: the joint request's
//                supplied events (code-review.js), or the session-only window's source map (forbidden.js
//                `disclosureShown`: the event shown to the window as the agent's words)
//   ungrounded   its quote is not an exact substring (strict, no repair) of that commentary event's text, or (M33
//                brittleness M4 session route, as the session-only route always required of it) it starts or ends inside
//                a word of that text (session.js `atWordEdges`)
//   not_later    it was not recorded after every action the finding cites
//   cross_actor  it is not the main agent's statement (its event's actor, `actorKeyOf`, is not the root), or an action
//                it cites has an actor the recording cannot name. Only the main agent's statements are shown to the
//                human: a helper's own statements — its commentary, its report to the parent — never are (C-06 *M33
//                helper-internal claims*), so a helper's statement, even about its own change, cannot have told the
//                human; a parent's relay of it is the parent's own statement and is checked as one. (M33 brittleness M4
//                session route review: the code had also passed the statement of the one helper that did every cited
//                action, and before that the combined route had required every action to be the statement's actor.)
// Every code check above passed, so it was put to the challengers as its own item, which did not survive with two
// grounded support votes — `refuted`, `unsettled` or `unexecuted`, as RESOLUTION_CHALLENGE_OUTCOMES names them.
export const DISCLOSURE_REJECTIONS = Object.freeze(['malformed', 'unsupplied', 'ungrounded', 'not_later', 'cross_actor',
  'refuted', 'unsettled', 'unexecuted']);
const DISCLOSURE_KEYS = Object.freeze(['eventId', 'role', 'quote']);

/**
 * M33 brittleness M4: an edit finding's proposed disclosure, every condition in DISCLOSURE_REJECTIONS order. `verified`
 * are the finding's own verified receipts (its actions: role action, or role code on an action's event). Returns
 * `{ ok: true, disclosedBy }` (the strictly verified commentary receipt) or the first reason; one that passed every code
 * check and whose challenge item was not upheld says so (`codeChecked`). Pure; never throws.
 *
 * M33 brittleness M4 review: `not_later` and `cross_actor` are judged over the finding's SESSION actions only. A code
 * receipt on a frozen PR source (the combined route's resolver serves one by `frozenSource`, code-review.js
 * `sourceSession`) is the PR's current code, no action the recording placed: it has no sequence or actor, and is never
 * one of them. A finding with no session action still has none to have disclosed (`not_later`); a session action the
 * recording cannot place still fails closed.
 */
function editDisclosure(session, candidate, verified) {
  try {
    const value = candidate.disclosedBy;
    if (candidate.kind !== 'edit_under_negative_requirement' || !plainObject(value)
        || Object.keys(value).length !== DISCLOSURE_KEYS.length || !DISCLOSURE_KEYS.every((key) => typeof value[key] === 'string')
        || !value.eventId || value.role !== 'commentary' || value.quote.trim().length < MIN_QUOTE_CHARS
        || value.quote.length > DISCLOSURE_QUOTE_MAX_CHARS) return { ok: false, reason: 'malformed' };
    if (candidate.disclosureSupplied === false) return { ok: false, reason: 'unsupplied' };
    const check = verifyReceipt(session, { eventId: value.eventId, role: value.role, quote: value.quote });
    if (!check.ok) return { ok: false, reason: 'ungrounded' };
    const said = session.event(value.eventId);
    // A quote cut inside a word can turn what it says around: never grounded (the session-only route's rule, now both).
    if (!session.sourcesFor(said).some((source) => source?.role === 'commentary' && atWordEdges(source.text, value.quote)))
      return { ok: false, reason: 'ungrounded' };
    const frozen = (receipt) => typeof session.frozenSource === 'function' && session.frozenSource(receipt.eventId) === true;
    const actions = verified.filter((r) => (r.role === 'action' || r.role === 'code') && !frozen(r))
      .map((r) => session.event(r.eventId)).filter((event) => event?.kind === 'invocation');
    if (!actions.length || !Number.isSafeInteger(said?.sequence)
        || actions.some((action) => !Number.isSafeInteger(action.sequence) || !(said.sequence > action.sequence)))
      return { ok: false, reason: 'not_later' };
    // Only the main agent's statement (actor null) is one the human was shown; a helper's own never is, whoever made the
    // change. An action whose actor cannot be named fails closed.
    if (actorKeyOf(session, said) !== null || actions.some((action) => actorKeyOf(session, action) === undefined))
      return { ok: false, reason: 'cross_actor' };
    const outcome = candidate.disclosureChallenge;
    if (outcome !== RESOLUTION_UPHELD) return { ok: false, codeChecked: true,
      reason: RESOLUTION_CHALLENGE_OUTCOMES.includes(outcome) ? outcome : 'unexecuted' };
    return { ok: true, disclosedBy: withoutRepairFields(check.receipt) };
  } catch { return { ok: false, reason: 'malformed' }; }
}

/**
 * M33 brittleness M4: may this edit finding's proposed disclosure be put to the challengers, as its own item? Only when
 * the finding itself grounds and the disclosure passed every code check (`editDisclosure`), exactly as `groundFinding`
 * will apply them after the challenge. Whatever outcome the candidate already carries is ignored. Returns
 * `{ challengeable, reason }`: `reason` is the closed code reason it was not, or null. Never throws. Both routes (owner
 * decision 2026-10-06). M33 brittleness M4 session route: a finding already FYI by a reason that comes first — a
 * forbidden edit code proved undone in its turn (`self_corrected`, unchanged) — has nothing for a disclosure to change:
 * not asked, not counted (`reason` null).
 */
export function disclosureChallengeable({ repo, session, pr = null, candidate }) {
  if (!plainObject(candidate) || candidate.disclosedBy == null) return { challengeable: false, reason: null };
  const { disclosureChallenge: _outcome, ...unchallenged } = candidate;
  try {
    const result = groundFinding({ repo, session, pr, candidate: unchallenged });
    if (result.ok !== true || result.finding?.status === 'FYI') return { challengeable: false, reason: null };
    return result.disclosureCodeChecked === true ? { challengeable: true, reason: null }
      : { challengeable: false, reason: result.disclosure ?? 'malformed' };
  } catch { return { challengeable: false, reason: null }; }
}

/**
 * M33 H (C-06 "M33 helper-internal claims", owner decision 2026-10-01): are these receipts' statements a helper's
 * own — at least one commentary receipt, and every one an event of a transferred helper as the recording of `session`
 * records it: a commentary event whose `childId` is a nonempty string that the session's verified child links map to
 * exactly one child session (M33 H repair: `Session.verifiedChildSession`, the rule `actorForActions` attributes a
 * child's actions by)? A statement whose event is missing, is the root's, names its actor any other way, or names a
 * child no verified link proves is the parent's: never a helper's by guess, by id or by wording. Only the statement
 * decides; the result that contradicts it may be anyone's. Pure; never throws (what it cannot read is no helper's).
 */
export function helperStatement(session, receipts) {
  const said = (Array.isArray(receipts) ? receipts : []).filter((r) => r !== null && typeof r === 'object'
    && r.role === 'commentary');
  try {
    return said.length > 0 && typeof session?.event === 'function' && typeof session.verifiedChildSession === 'function'
      && said.every((r) => {
        const event = typeof r.eventId === 'string' ? session.event(r.eventId) : null;
        return event?.kind === 'commentary' && typeof event.childId === 'string' && event.childId.length > 0
          && session.verifiedChildSession(event.childId) !== null;
      });
  } catch { return false; }
}

/**
 * M33 H repair (C-06 "M33 helper-internal claims", recheck minor): code's own mark on a challenge record's result —
 * `helperStatement: true`, set when the record is built (run-review.js, code-review.js `markHelperStatements`) on a
 * contradicted claim (`claim`, citing `contradictedBy`) or a joint `claim_contradicted` session finding
 * (`session-finding`) whose statement is a helper's own (`helperStatement`, read from the recording). It is how a
 * report reads that fact WITHOUT its recording — the CLI saves report.private.json without the session — so a saved
 * report reads exactly as the live run did. Never a model field: it sits beside the candidate, never in it, and only
 * strictly true counts; a result without it (an older report's) is the parent's statement, DECIDE-bound.
 */
export const HELPER_STATEMENT_MARK = 'helperStatement';
/** M33 H repair: mark, in place, each result of `record` whose contradicted statement is a helper's own. Returns it. */
export function markHelperStatements(session, record) {
  for (const result of listOf(record?.results)) {
    const candidate = result?.candidate;
    if (candidate === null || typeof candidate !== 'object') continue;
    const said = result.type === 'claim' ? (candidate.contradictedBy ? [candidate.stated] : null)
      : result.type === 'session-finding' && candidate.kind === 'claim_contradicted' ? candidate.receipts : null;
    if (said !== null && helperStatement(session, said)) result[HELPER_STATEMENT_MARK] = true;
  }
  return record;
}

// Why a supplied resolution was not accepted — one closed token each, counted per reason in
// `counts.resolutions.rejected`, never shown as a finding. Checked in this order:
//   malformed        resolvedBy is not exactly {observation, statement}, each an {eventId, role, quote}
//   role_mismatch    the observation is not role observation, or the statement is not role commentary
//   unsupplied       a resolution receipt cites a source its review window was not shown
//   ungrounded       a resolution quote is not in the source it cites (after the one deterministic repair)
//   out_of_order     not after the claim and its contradicting result, or the statement is not after the
//                    result it states (C-06: "a later observation ... and a later commentary")
//   cross_actor      a resolution event is not of the claim's own actor
//   failed_result    (M33 C event binding) the resolution's observation is recorded as failed or cancelled, or
//                    with a nonzero exit code — exactly as a support's (`SUPPORT_REJECTIONS`): a run that failed
//                    shows no claimed state, whatever line of it is quoted, so a failed rerun never downgrades a
//                    true contradiction to FYI
//   turn_unrecorded  the claim or a resolution event carries no recorded turn (C-02 `turn`); never guessed
//   cross_turn       a resolution event is in another recorded turn than the claim
//   human_prompted   a human instruction is recorded after the claim and before the resolution's
//                    statement: the correction was asked for, not self-made (C-06 refreeze). Only the
//                    recorded instruction counts; a human's words inside a tool result are never read
//                    as one (the recording marks no human-originated tool rejection).
// Every check above passed (the resolution was put to the challengers as its own item, C-06 refreeze),
// and its challenge item did not survive with two grounded support votes:
//   refuted          a resolved majority refuted it
//   unsettled        every pass voted on it and it was not settled
//   unexecuted       some pass never voted on it, or no challenge outcome was recorded for it at all
export const RESOLUTION_REJECTIONS = Object.freeze(['malformed', 'role_mismatch', 'unsupplied', 'ungrounded',
  'out_of_order', 'cross_actor', 'failed_result', 'turn_unrecorded', 'cross_turn', 'human_prompted',
  'refuted', 'unsettled', 'unexecuted']);

/**
 * C-06 refreeze: how a resolution's own challenge item ended, as the code that ran the challenge
 * records it on the finding candidate (`resolutionChallenge`, run-review.js) — never a model field.
 * Only `upheld` (it survived with two grounded support votes) publishes FYI; each other outcome is
 * the rejection reason of the same name.
 */
export const RESOLUTION_CHALLENGE_OUTCOMES = Object.freeze(['upheld', 'refuted', 'unsettled', 'unexecuted']);
const [RESOLUTION_UPHELD] = RESOLUTION_CHALLENGE_OUTCOMES;
// ---- M33 written statements (C-06, owner decision 2026-09-29) --------------------------------------
//
// Statements the agent wrote into a file — the written body of one of its own write, create or edit
// actions — are their own proposal class (`writtenClaims`, written.js), never a chat claim, never a
// finding, and never a status change. Each published one carries one closed side label; code, never
// the model, assigns it:
//   unverified    the default: nothing this review checked settles it either way
//   contradicted  a grounded, supplied observation recorded after the write contradicts it, and its own
//                 challenge item upheld that with two grounded support votes
export const WRITTEN_LABELS = Object.freeze(['unverified', 'contradicted']);

// Why a proposed written statement was withheld — one closed cause each, counted in `withheld.causes`
// beside the proposal it was (`withheld.proposals`), never published. A withheld written statement
// never makes a window or the review incomplete (C-06). Causes, never JUDGMENT_REASONS.
//   written_unreadable     not the response contract's shape: not an object, no text, a stated receipt
//                          that is not role code, a contradiction that is not role observation, a rating
//                          or any other field the contract does not name
//   written_not_own_write  its stated receipt cites no write, create or edit action of the agent — a
//                          delete (its code is the file as found), a command, any other event, or none
//   written_ungrounded     its quote is not in that action's written body as its window was shown it
//   written_not_landed     the record says that write failed or was cancelled (C-02 outcome, as
//                          `actionOutcomeOf` proves it), or (D98, F9: its effect is `none`, session.js `effectOf`)
//                          that it, or the command it was parsed from, was refused before it ran — judged after
//                          UNRUN_WRITE_REASON for a parsed write: the text was never written into the file. A write
//                          whose outcome is not recorded is not this: it is published, and the session's
//                          own `write_outcome_unknown` gap says the outcome is missing.
//   write_command_not_run_or_failed  (D80, UNRUN_WRITE_REASON) the write is one the slicer parsed from a command that
//                          did not run, failed or stopped before it finished (`unrunEnd`), and its quote is nowhere
//                          else that happened (`quotesOnlyUnrunWrite`): the text may never have been written into the
//                          file.
export const WRITTEN_WITHHELD_CAUSES = Object.freeze(['written_unreadable', 'written_not_own_write', 'written_ungrounded',
  'written_not_landed', UNRUN_WRITE_REASON]);

// Why a published written statement's proposed contradiction left it `unverified` — one closed reason
// each, counted in `counts.writtenClaims.contradictionsRejected`. Checked in this order:
//   unsupplied   the observation is no source of role observation its window was shown (W2: nor, for role code, of
//                role code)
//   ungrounded   its quote is not in that supplied source (a strict string search, no repair); W2: or, for role code,
//                it is over EVIDENCE_QUOTE_MAX characters
//   not_later    it was not recorded after the write it is said to contradict
//   not_own_written   (W2, owner decision 2026-10-13; role code only, where the contract admits it) it is not text the
//                statement's own actor's edit or write added, run to a recorded success and recorded before the
//                statement's write (ledger.js `ownWrittenCheck`)
//   source_rewritten  (W2; role code only) it is such text, but a later change to the same typed path, not recorded as
//                failed or cancelled, was recorded before the statement's write
// Every check above passed, so it was put to the challengers as its own item, which did not survive
// with two grounded support votes — `refuted`, `unsettled` or `unexecuted`, exactly as
// RESOLUTION_CHALLENGE_OUTCOMES names them.
export const WRITTEN_CONTRADICTION_REJECTIONS = Object.freeze(['unsupplied', 'ungrounded', 'not_later',
  'not_own_written', 'source_rewritten', 'refuted', 'unsettled', 'unexecuted']);

// ---- M33 C: claims are facts (C-06 "M33 claims are facts", 2026-10-01) ------------------------------------
//
// A chat claim is the agent's assertion that something IS true or WAS done: a completed state or an observed
// fact. A plan, an intention, a prediction, a conditional, a question, or a restatement of what a document or a
// hand-off brief says is not one. (M33 H repair, `sonah.narrative/13`, `sonah.challenge/10`: an agent passing on what
// a helper or another agent reported makes it its own claim, unless it says it did not check it or doubts it; until
// then "what another agent says" was excluded too.) (H3, `sonah.narrative/15`, `sonah.challenge/12`:
// a claim is now every statement the agent makes about the current state or the outcome of its work, hedged or not;
// only an action not taken yet, a question, or a restatement of a document or a hand-off brief is not one. Its review
// repair, `sonah.narrative/16`, `sonah.challenge/13`: no example phrasings left in any claims text, and a hedge on what
// an agent passes on is not doubt.) The narrative prompt says so (prompt.js), and the challengers'
// explicit criteria (challenge.js v8) refute a statement that is not a claim, and a contradiction the agent's own
// statement already disclosed. Code withholds no claim before its challenge: a claim code withholds is a NONE no
// challenger can undo. (M33 C recheck 2, 2026-10-01: the two code withholds this section once defined —
// `claim_not_factual`, a quote opening with a first-person future form, and `claim_disclosed`, a statement that
// echoed 12 characters of the contradicting result around a failure word — each hid true contradictions the
// review then read CLEAN: "Let's merge since all 42 tests pass", "Let's ship the green build", a failing test's
// own name reused to describe the work, and a failure echoed and dismissed in words that are no remedy. No closed
// word list separates a premise from a plan, or a dismissal from a disclosure; the vocabularies are gone.)

/**
 * C-06 `PromiseRecord.status` as code sets it (M33 C): `open` — nothing this review checked settles the claim
 * either way (a reader is shown "not checked", never "open"); `verified` — a grounded `supportedBy`, a result
 * recorded after the claim, or before it in its own turn with no in-repository change between (owner decision
 * 2026-10-05), that confirms it, was upheld by its own challenge item — by every counted vote (challenge /30 (5); an
 * invalid vote counts for nothing, as before) — and the claim by its own (a reader is shown
 * "confirmed by a recorded result"), and no published `claim_contradicted` finding — nor (M33 C
 * recheck 2) a contradicted claim whose own challenge ended unsettled or unexecuted — cites the claim's own
 * statement: the same stated event, whatever words of it each quotes (M33 C event binding; run-review.js
 * `unverifiedBesideFindings`).
 * D71 (S2): `incomplete` — the claim cites no contradiction and no support, and every action it
 * rests on (`restsOn`) is the agent's own, recorded before the claim and shown to its window, and its result's typed
 * outcome (`resultOutcome`) is did-not-run or no-terminal-status (`RESTS_ON_OUTCOMES`): the check it rests on
 * never completed (a reader is shown "check did not complete").
 */
export const PROMISE_STATUSES = Object.freeze(['open', 'verified', 'incomplete']);
/**
 * S6 (S5 review H1), owner decision D71 (b): why a session-only claim is published `open` (not checked) with none of the
 * basis its answer proposed — its own challenge item did not settle, so it is KEPT with its weakest status instead of
 * left out (a refuted claim is still left out: that is not unsure). On the promise as `reason`; a reader says it in
 * fixed words.
 *   challenge_unsettled   every pass voted on it and it was not settled
 *   challenge_unexecuted  some pass never voted on it (a check that did not run: the window is incomplete, D58)
 */
export const PROMISE_UNCHECKED_REASONS = Object.freeze(['challenge_unsettled', 'challenge_unexecuted']);

// Why a claim's proposed `supportedBy` did not make its promise `verified` — one closed token each, counted in
// `counts.promiseSupport.rejected`; the claim stays a promise `open` (a support never withholds, unreads or
// unpublishes its claim). The code checks, in this order, before a support may be asked about at all:
//   contradicted   the claim also cites contradictedBy: the contradiction wins (the DECIDE route, as before);
//                  M33 C recheck: and, after publication, a published claim_contradicted finding cites the claim's
//                  own statement — or (M33 C recheck 2) a contradicted claim whose own challenge ended unsettled
//                  or unexecuted does: a check that did not settle is no leave to call it confirmed. M33 C event
//                  binding: the same stated event, whatever words of it each quotes
//   malformed      not exactly {eventId, role, quote}, each a string
//   role_mismatch  not role observation
//   unsupplied     its window was not shown that event as an observation
//   ungrounded     its quote is not an exact substring of that supplied result (strict: no repair)
//   not_later      the result was recorded neither after the claim's statement nor, earlier, in its own turn (owner
//                  decision 2026-10-05: an earlier run in the same turn may support it), or their order is unknown
//   cross_actor    the result is not of the claim's own actor
//   failed_result  (M33 C recheck) the result is recorded as failed or cancelled, or with a nonzero exit code: a
//                  run that failed confirms nothing, whatever line of it is quoted. W3 F2 (owner decision 2026-10-13):
//                  a combined review's only; a session-only review asks it (`failedAsked`, below)
//   not_same_turn  (M33 C recheck) a human instruction is recorded between the statement and the result, or
//                  the two carry different recorded turns (an earlier result must carry the statement's own turn):
//                  the rule a resolution already follows
//   stale_run      (owner decision 2026-10-05) a result recorded BEFORE the statement, with an in-repository
//                  change recorded between its run's invocation and the statement that did not provably fail —
//                  the run tested other code — or an order code cannot read. W3 F1(a) (owner decision
//                  2026-10-13): for the result of the claim actor's own write, only a later change to one of that
//                  write's typed paths (`samePathChangedBetween`)
// (D71 S2's `no_terminal_status`, a result whose typed outcome was did-not-run, no-terminal-status or
// failed-or-refused, is removed: no code check reads a support's typed outcome; its challenge item judges it.)
// then (M33 C repair) how the support's own challenge item ended, for a claim that survived its own:
//   refuted        a resolved majority refuted it
//   unsettled      every pass voted and it was not settled (a support vote that cites neither the result nor
//                  the command that produced it is no vote for it: `support_unbound`, challenge.js) — and (challenge
//                  /30 (5)) a majority upheld it but one counted vote did not (the run is `unanimous`)
//   unexecuted     some pass never voted on it
export const SUPPORT_REJECTIONS = Object.freeze(['contradicted', 'malformed', 'role_mismatch', 'unsupplied',
  'ungrounded', 'not_later', 'cross_actor', 'failed_result', 'not_same_turn', 'stale_run', 'refuted', 'unsettled',
  'unexecuted']);
/**
 * W3 (owner decision 2026-10-13): the closed counters of a session-only review's supports a
 * code check once refused and the support's challenge item now judges, each counted by how that item ended
 * (RESOLUTION_CHALLENGE_OUTCOMES: upheld, refuted, unsettled, unexecuted) in `counts.promiseSupport`:
 *   staleAsked   (F1(b)) a result recorded before the claim with in-repository changes recorded since its run, asked
 *                with those changes listed (claims.js `changedSince`, under the label "changed since:"), where a
 *                combined review still refuses it `stale_run`
 *   failedAsked  (F2) a result the record says failed or was cancelled, or with a nonzero exit code
 *                (`recordedFailure`), asked and judged on its "outcome:" line, where a combined review still refuses it
 *                `failed_result`; and (the review of W3, 2026-10-14) a result whose typed outcome says it was stopped
 *                before it finished or cancelled (STOPPED_OUTCOME_FORMS), marked and judged exactly as a failed one
 */
export const SUPPORT_ASKED = Object.freeze(['staleAsked', 'failedAsked']);
/** W3 F1(b) (owner decision 2026-10-13): the closed label of the one fixed line a support item recorded before the
 *  claim is shown under when in-repository changes were recorded since its run (claims.js `changedSinceLine`; the
 *  challenge lists it beside the item's proposition, outside any fence, built like status-fact.js's line). Moved here
 *  from claims.js by the review of the W1-W3 fixes, beside the counter it goes with (`staleAsked`). */
export const CHANGED_SINCE_LABEL = 'changed since:';

// ---- D71 (S2): the reviewer brief as the checklist — its closed words ----

/**
 * A RESULT's typed outcome, by class — built ONLY from fields the recorder typed (the result's `result`, its exit
 * code and the source of its status, and the call's `recorded.denial`, `recorded.interrupted`, `recorded.isError`,
 * `recorded.backgroundTaskId`, and the slicer's `refusalUntyped` mark), never a word of the output (`resultOutcome`).
 *   ran-exit-0          a native or hook exit code 0 (a "status:" line still says when it does not cover every command)
 *   ran-completed       the recorder's own typed success with no exit code (a file write; Claude Code's completed verdict)
 *   ran-failed          a native or hook failure, a nonzero exit code or the error flag, with no denial typed
 *   did-not-run         the recorder typed the call as refused before it ran (Claude Code `toolDenialKind`, a kind
 *                       other than STOPPED_DENIALS): it never ran
 *   no-terminal-status  run in the background with no terminal status, or typed as interrupted or cancelled before it
 *                       finished, or (D80) denied with a STOPPED_DENIALS kind (an ACTION with no result recorded at
 *                       all reads so too: `actionOutcome`)
 *   failed-or-refused   recorded as failed by a recorder that types no refusal (the slicer's `refusalUntyped`)
 *   output-no-status    a result was recorded with no status typed for the tool: its output shown (a read that shows its
 *                       content), or none of it shown (`unread`)
 *   end-unread          (D99, F1 guard) run in the background with no typed end, where the slicer could not prove the
 *                       recording holds none (its launch's `backgroundEnd` is `unread`: a notification is linked to it, or
 *                       its task id is in a later row the agent did not write, or in a row before its launch, or the
 *                       search could not run): Sonah could not read whether or how it ended. Not a failure and no
 *                       check that did not complete (neither FAILURE_OUTCOMES nor RESTS_ON_OUTCOMES): not checked. A
 *                       background run with neither mark (no-terminal-status `background`) is one whose recording code
 *                       proved holds no end of it; one typed stopped or killed reads no-terminal-status `interrupted`.
 * S7: `stopped` and `not-typed` left the table: an interrupted or cancelled
 * call is a form of no-terminal-status (every list held both, so no check moved), and the fallback is output-no-status
 * `unread` (no list held not-typed, so no check moved). And a result recorded with no status and no output read from it
 * (the former no-terminal-status `empty`) is output-no-status `unread`: the recorder recorded a result for every one of
 * them (Claude Code's carry a non-empty, non-error tool result the slicer does not read; Codex's mostly an output item),
 * so "no terminal status recorded" was not the recorder's fact; it no longer lists them as failures.
 */
export const RESULT_OUTCOME_CLASSES = Object.freeze(['ran-exit-0', 'ran-completed', 'ran-failed', 'did-not-run',
  'no-terminal-status', 'failed-or-refused', 'output-no-status', 'end-unread']);
/** D99 (F1 guard): the class of a background run whose end Sonah could not read (RESULT_OUTCOME_CLASSES). */
export const END_UNREAD_CLASS = RESULT_OUTCOME_CLASSES[7];
/** D99 (review of A1b): the form of that class for a run whose end Sonah could not read and could not check for (the
 *  slicer's `backgroundEnd` `unchecked`: no later mention of it is established). Its readers say "Sonah could not check
 *  whether the recording holds an end of this run", never that later records mention it; the run's other form
 *  (`background`) is one a later record mentions. */
export const END_UNCHECKED_FORM = 'unchecked';
/** Owner decision D80 (2026-10-12): the members of the recorder's closed denial vocabulary (Claude Code's
 *  `toolDenialKind`, the slicer's `recorded.denial`; redact `RECORDED_FACTS.denial`) that mean the call was stopped,
 *  not refused: it started and did not finish. Such a call reads as `STOPPED_WORDS` everywhere (the class
 *  no-terminal-status in its `interrupted` form here; the story's and the page's "stopped before it finished"), never
 *  as did-not-run; every other kind means refused before it ran (did-not-run; the story's `REFUSED_DENIALS`). D98: the
 *  list is declared once, in session.js beside `REFUSED_DENIALS`, where the effect rule (`effectOf`) reads it too. */
export { STOPPED_DENIALS };
/** D80: the one phrase for a call that started and was stopped before it finished (typed as interrupted, or denied with
 *  a STOPPED_DENIALS kind): the evidence's words, the checklist's, and the story's and the page's alike. */
export const STOPPED_WORDS = 'stopped before it finished';
/** D80: what is said of a write parsed from a command (`shellWriteOf`) whose command failed or was stopped (`end`, a
 *  SHELL_WRITE_ENDS key): the record does not say whether the write happened (C-02), so it is never read as done. One
 *  phrase, after "its" (or "Its"): read by `RESULT_OUTCOME_WORDS` (the forms `command-failed`, `command-stopped`) and the
 *  checklist's words. D100 (review of A1c): the write has no result of its own and its command's typed end proves
 *  neither way, but a later record (a read of the file) can show it, so the words say what Sonah could read, never that
 *  the recording does not record it. No request carries them: `resultOutcome`, which a request's words come from, never
 *  returns these forms (`actionOutcome` does). */
export const SHELL_WRITE_ENDS = Object.freeze({ failed: 'failed', stopped: STOPPED_WORDS });
export const shellWriteWords = (end) => `command ${SHELL_WRITE_ENDS[end]}, so Sonah could not read whether this write `
  + 'happened';
/** The fixed words of each class's `outcome:` line, by class and, where a class has several, by what the
 *  recorder typed. `{n}` is a recorded exit code and `{kind}` a member of the recorder's closed denial vocabulary
 *  (redact `RECORDED_FACTS.denial`); nothing else is ever substituted. */
export const RESULT_OUTCOME_WORDS = Object.freeze({
  'ran-exit-0': Object.freeze({ exit: 'ran, exit 0' }),
  'ran-completed': Object.freeze({ typed: 'ran, completed' }),
  'ran-failed': Object.freeze({ exit: 'ran, failed (exit {n})', flag: 'ran, failed (error flag set)',
    typed: 'ran, failed (the recorder typed it as failed)' }),
  'did-not-run': Object.freeze({ denial: 'did not run (the recorder typed the call as {kind})' }),
  'no-terminal-status': Object.freeze({ background: 'no terminal status recorded (run in the background)',
    none: 'no terminal status recorded (no result recorded)',
    interrupted: `no terminal status recorded (${STOPPED_WORDS})`,
    cancelled: 'no terminal status recorded (the recorder typed it as cancelled)',
    // D80: a write parsed from a command that failed, or was stopped (`actionOutcome`).
    'command-failed': `no terminal status recorded (its ${shellWriteWords('failed')})`,
    'command-stopped': `no terminal status recorded (its ${shellWriteWords('stopped')})` }),
  'failed-or-refused': Object.freeze({ untyped: 'failed or refused before it ran; the recorder does not type which' }),
  // S6 (S5 review L5): words that deny no typed fact — a call of this class may carry a typed code of its own (a fetch's
  // HTTP status, shown on its "recorded:" line); what it lacks is a typed exit code or completion.
  'output-no-status': Object.freeze({ output: 'output recorded; no exit code or completion typed for it',
    unread: 'result recorded; none of its output is shown, and no exit code or completion is typed for it' }),
  // D99 (F1 guard): words that state no absence; they never say "no terminal status", which the brief's failures and
  // rests-on steps name. Nor do they presume an end, or a later mention: the run may still be running, and its id may be
  // only in a row before its launch. Review of A1b: so the form of a run no later record is shown to mention
  // (END_UNCHECKED_FORM) carries the same words, and no request byte moves for it.
  'end-unread': Object.freeze({ background: 'run in the background; Sonah could not read whether or how it ended',
    unchecked: 'run in the background; Sonah could not read whether or how it ended' }),
});
/** W3 F2 review (2026-10-14): the forms of the no-terminal-status class (RESULT_OUTCOME_WORDS) a RESULT takes when the
 *  recorder typed that its call started and did not run to its end: stopped before it finished (`interrupted`: a call
 *  typed interrupted, or denied with a STOPPED_DENIALS kind) or cancelled (`cancelled`: a result typed cancelled). On the
 *  session route a support whose result has one of them is marked exactly as one whose result failed (claims.js
 *  `supportCheck`), and the readers say either as STOPPED_WORDS. */
export const STOPPED_OUTCOME_FORMS = Object.freeze(['interrupted', 'cancelled']);
/** D100 (the audit of absence sentences): the form of the no-terminal-status class an ACTION takes when Sonah read no
 *  result of it (`actionOutcome`). It proves no absence: a result in a record Sonah could not read, or recorded after a
 *  window's end, reads the same. A reader says it as what Sonah found, never as "no recorded end". */
export const NO_RESULT_OUTCOME_FORM = 'none';
/** D100: the form of the no-terminal-status class a background run takes when the slicer proved that its recording holds
 *  no end of it (D99's verified absence: no `backgroundEnd` mark). The one form a reader may say as "no recorded end". */
export const PROVED_NO_END_FORM = 'background';
/** The classes whose RESULT shows no check that ran to an end — a deliverable citing one is refused
 *  (`check_not_completed`). */
export const NOT_COMPLETED_OUTCOMES = Object.freeze(['did-not-run', 'no-terminal-status', 'failed-or-refused',
  'end-unread']);
/** The classes an action a row rests on (`restsOn`) must have: its check did not run or did not finish. */
export const RESTS_ON_OUTCOMES = Object.freeze(['did-not-run', 'no-terminal-status']);
/** The style linter's declarations (docs/STYLE.md, packages/render/test/style-lint.js) for the words of this file that a
 *  person reads. Every session-only review request carries the outcome words of a result (prompt.js writes each
 *  result's `outcome:` line from `resultOutcome`), so they are not rewritten in place: `request-bytes` lists their style
 *  errors and counts them, and none fails. D100 (review of A1c): `shellWriteWords` is read only by forms that
 *  `resultOutcome` never returns, so no request carries it, and it passes every rule as it is. */
export const STYLE_KINDS = Object.freeze({ STOPPED_WORDS: 'fragment', RESULT_OUTCOME_WORDS: 'fragment',
  shellWriteWords: 'fragment' });
export const STYLE_FIXTURES = Object.freeze({ shellWriteWords: [['failed'], ['stopped']] });
export const STYLE_ALLOW = Object.freeze({ STOPPED_WORDS: ['request-bytes'], RESULT_OUTCOME_WORDS: ['request-bytes'] });


const TYPED_RESULT_SOURCES = Object.freeze(['native', 'hook']);
// D71 (S4): `form` names which of its class's fixed phrases it is (a RESULT_OUTCOME_WORDS key), for a reader that says
// it in its own words; never a word of the output.
const outcomeOf = (cls, form, fill = {}) => ({ class: cls, form,
  words: RESULT_OUTCOME_WORDS[cls][form].replace('{n}', String(fill.n ?? '')).replace('{kind}', String(fill.kind ?? '')) });

/**
 * One RESULT's typed outcome — `{ class, form, words }`, the class a member of RESULT_OUTCOME_CLASSES and the words its
 * fixed phrase. Structure only: the result's typed fields and its call's recorder facts, never its output's words
 * (only whether any output was recorded, or withheld). Deterministic.
 */
export function resultOutcome(session, observation) {
  const call = typeof observation?.invocation === 'string' && typeof session?.event === 'function'
    ? session.event(observation.invocation) : null;
  const recorded = call?.recorded !== null && typeof call?.recorded === 'object' ? call.recorded : {};
  const exit = Number.isFinite(observation?.exitCode) ? observation.exitCode : null;
  const typed = TYPED_RESULT_SOURCES.includes(observation?.sourceOfResult);
  // D80: a stopped kind (STOPPED_DENIALS) started and did not finish, as an interrupted call; any other did not run.
  if (STOPPED_DENIALS.includes(recorded.denial)) return outcomeOf('no-terminal-status', 'interrupted');
  if (typeof recorded.denial === 'string' && recorded.denial) return outcomeOf('did-not-run', 'denial', { kind: recorded.denial });
  if (recorded.interrupted === true) return outcomeOf('no-terminal-status', 'interrupted');
  if (call?.refusalUntyped === true) return outcomeOf('failed-or-refused', 'untyped');
  if (exit !== null && exit !== 0) return outcomeOf('ran-failed', 'exit', { n: exit });
  if (recorded.isError === true) return outcomeOf('ran-failed', 'flag');
  if (observation?.result === 'failed' && typed) return outcomeOf('ran-failed', 'typed');
  if (observation?.result === 'cancelled' && typed) return outcomeOf('no-terminal-status', 'cancelled');
  if (observation?.terminalStatusProven === true && exit === 0) return outcomeOf('ran-exit-0', 'exit');
  if (observation?.terminalStatusProven === true && (observation.result === 'succeeded'
      || observation.lastStatus?.verdict === 'completed')) return outcomeOf('ran-completed', 'typed');
  // D99 (F1 guard): a background run's end as the slicer read it (`backgroundEnd`): stopped or killed is stopped before it
  // finished; an end it could not read, and could not prove absent, is end-unread; only a run with neither mark — one
  // whose recording code proved holds no end of it — reads as having no recorded end.
  if (typeof recorded.backgroundTaskId === 'string' && recorded.backgroundTaskId) {
    if (call?.backgroundEnd === 'stopped') return outcomeOf('no-terminal-status', 'interrupted');
    if (call?.backgroundEnd === 'unread') return outcomeOf('end-unread', 'background');
    if (call?.backgroundEnd === 'unchecked') return outcomeOf('end-unread', END_UNCHECKED_FORM);
    return outcomeOf('no-terminal-status', PROVED_NO_END_FORM);
  }
  const output = Array.isArray(observation?.output) ? observation.output.length > 0
    : typeof observation?.output === 'string' && observation.output.length > 0;
  if (output || observation?.outputWithheld === true) return outcomeOf('output-no-status', 'output');
  // S7: a result was recorded (the adapter emits a RESULT only for a recorded one) and none of its output is shown.
  return outcomeOf('output-no-status', 'unread');
}

/**
 * An ACTION's typed outcome — its recorded result's (`resultOutcome`; the last terminal one when it has
 * several), or `no-terminal-status` (no result recorded) when the recording holds none. Structure only.
 * D59 (S6, S5 review M1): `until` — a window's end (`windowEnd`) — reads only the results recorded at or before it, so a
 * window's check never rests on a result its request was not shown (one recorded in a later window, or one whose order
 * is unknown). Without it (a reader of the whole recording) every recorded result is read.
 * D79 (owner decision 2026-10-11): a write the slicer parsed from a command (`shellWriteOf`: a heredoc's body, a
 * `sed -i`) has no result of its own; it is read through its command's results (those recorded against
 * `shellWriteOf`, bounded the same way) and takes only one of them: did-not-run (the recorder typed the command as
 * denied: it never ran, so neither did the write). Any other end of its command (a success, a failure, a stop) leaves
 * the write's outcome unknown: `no-terminal-status` (no result recorded), as before D79, so it is never a completed
 * check (C-02: a command's status never proves whether its write happened; C-06 item 6).
 * D80 (owner decision 2026-10-12): that unknown outcome says why when its command failed (ran-failed: the form
 * `command-failed`) or was stopped by a STOPPED_DENIALS denial (the form `command-stopped`): whether the write happened
 * is not recorded. Its class stays no-terminal-status, so no check reads it differently.
 */
export function actionOutcome(session, action, { until = null } = {}) {
  const events = Array.isArray(session?.events) ? session.events : [];
  const bounded = Number.isSafeInteger(until);
  const shell = typeof action?.shellWriteOf === 'string' && action.shellWriteOf ? action.shellWriteOf : null;
  const of = shell ?? action?.id;
  const results = events.filter((event) => event?.kind === 'observation' && event.invocation === of
    && event.phase === 'terminal' && (!bounded || (Number.isSafeInteger(event.sequence) && event.sequence <= until)));
  const none = outcomeOf('no-terminal-status', NO_RESULT_OUTCOME_FORM);
  if (!results.length) return none;
  const outcome = resultOutcome(session, results.at(-1));
  if (shell === null || outcome.class === 'did-not-run') return outcome;
  if (outcome.class === 'ran-failed') return outcomeOf('no-terminal-status', 'command-failed');
  const command = typeof session?.event === 'function' ? session.event(shell) : null;
  return STOPPED_DENIALS.includes(command?.recorded?.denial) ? outcomeOf('no-terminal-status', 'command-stopped')
    : none;
}

/**
 * D80 (owner decision 2026-10-12): the typed ends of a command (RESULT_OUTCOME_CLASSES, its own `actionOutcome`) after
 * which a write the slicer parsed from it (`shellWriteOf`: a heredoc's body, a redirect) may not have happened: the
 * recorder typed the command as denied (did-not-run), it ran and failed (ran-failed), or it failed or was refused by a
 * recorder that types no refusal (failed-or-refused). C-02: a failed command never proves its write either way, and a
 * write that may not have happened cannot prove work was done. A call denied with a STOPPED_DENIALS kind is such an
 * end too (`unrunEnd`): D80 item 4 reads it no-terminal-status (`interrupted`), where it read did-not-run when this
 * rule was written, and its write is not recorded as done (the form `command-stopped`).
 */
export const UNRUN_WRITE_ENDS = Object.freeze(['did-not-run', 'ran-failed', 'failed-or-refused']);

/** D80 integration: does `event`'s own typed end, by its results recorded at or before `until`, say a write of it may
 *  not have happened? One of UNRUN_WRITE_ENDS, or a call denied with a STOPPED_DENIALS kind (no-terminal-status in its
 *  `interrupted` form since D80 item 4). Typed fields only. */
const unrunEnd = (session, event, until) => {
  const end = actionOutcome(session, event, { until });
  return UNRUN_WRITE_ENDS.includes(end.class)
    || (end.form === 'interrupted' && STOPPED_DENIALS.includes(event?.recorded?.denial));
};

/** D80: is `event` a write the slicer parsed from a command (`shellWriteOf`) whose own typed end, by its results
 *  recorded at or before `until` (D59), is one of UNRUN_WRITE_ENDS or a stopped denial (`unrunEnd`)? Any other event,
 *  or a command the session does not hold: false. Typed fields only. */
export function unrunWrite(session, event, { until = null } = {}) {
  const of = typeof event?.shellWriteOf === 'string' && event.shellWriteOf ? event.shellWriteOf : null;
  const command = of !== null && typeof session?.event === 'function' ? session.event(of) : null;
  return command != null && unrunEnd(session, command, until);
}

/** D80: a write that did not happen as far as the record types it: a parsed write of such a command (`unrunWrite`), or
 *  any other action carrying changes whose own typed end is such an end (`unrunEnd`: a structured write the recorder
 *  typed as denied, stopped or failed). */
const writeNotMade = (session, event, until) => unrunWrite(session, event, { until })
  || (!(typeof event?.shellWriteOf === 'string' && event.shellWriteOf) && Array.isArray(event?.changes)
    && event.changes.length > 0 && unrunEnd(session, event, until));

/**
 * D80 (owner decision 2026-10-12): does `receipt` quote ONLY the body of a write that may not have happened? True when
 * it is a code receipt on a write the slicer parsed from a command whose typed end is one of UNRUN_WRITE_ENDS or a
 * stopped denial (`unrunWrite`, `unrunEnd`),
 * its quote lies in that write's body (the `after` side of one of its changes: what it would have put in the file), and
 * no other place the window was shown (`sourceMap`, as its request carried it; with none, every event the session
 * holds) holds the quote verbatim: no result's output (role observation) and no code of an action that is not a write
 * `writeNotMade` (role code). A quote also found there is attested by what did happen, and still grounds. Only a place
 * recorded after the write, in the write's own session (`oneSession`) and, with `until`, at or before it (D59) is
 * read: the write itself passed its caller's checks of order and session (after the ask, after the failed RESULT, in
 * that session), so such a place would pass them too; one recorded before the write (even before the ask or the
 * failure), in another session or after the window's end attests nothing here (review of D80 Q). Every caller
 * that verifies a quote against the session reads this one check (a decision's value, a deliverable, an acted-on
 * response, a written statement, a pivot's receipt, a challenge vote's receipt) and refuses with UNRUN_WRITE_REASON
 * (a pivot is withheld). Structure and verbatim search only: the cited event's typed fields and sequence, its
 * command's typed end and where the quote literally is, never what it says. Pure; never throws (false).
 */
export function quotesOnlyUnrunWrite(session, receipt, { sourceMap = null, until = null } = {}) {
  try {
    if (!plainObject(receipt) || receipt.role !== 'code' || typeof receipt.quote !== 'string' || !receipt.quote)
      return false;
    const write = session.event(receipt.eventId);
    if (write?.kind !== 'invocation' || !unrunWrite(session, write, { until })) return false;
    const holds = (text) => typeof text === 'string' && text.includes(receipt.quote);
    if (!(Array.isArray(write.changes) ? write.changes : []).some((change) => plainObject(change)
      && session.textSpansOf(change, 'after').some(holds))) return false;
    const ids = sourceMap != null ? Object.keys(sourceMap)
      : (Array.isArray(session.events) ? session.events : []).map((event) => event?.id);
    for (const id of ids) {
      const event = typeof id === 'string' ? session.event(id) : null;
      if (!event || event.id === write.id) continue;
      if (!Number.isSafeInteger(event.sequence) || !Number.isSafeInteger(write.sequence)
        || !(event.sequence > write.sequence) || (until != null && !(event.sequence <= until))
        || !oneSession(session, [write, event])) continue;
      const role = event.kind === 'observation' ? 'observation' : event.kind === 'invocation' ? 'code' : null;
      if (role === null) continue;
      const sources = sourceMap != null ? (Array.isArray(sourceMap[id]) ? sourceMap[id] : [])
        : session.sourcesFor(event);
      // The typed end is read only for an action whose code holds the quote (it scans the recorded results).
      if (sources.some((source) => source?.role === role && holds(source.text))
        && (role === 'observation' || !writeNotMade(session, event, until))) return false;
    }
    return true;
  } catch { return false; }
}

/**
 * A session-only requirement's status (the checklist's "what you asked"): `done` — its deliverable meets every part
 * of the ask; `partly-done` — part of it, with a shortfall; `not-done` — a shortfall shows it was not met; `not-checked`
 * — what would settle it is not in the window, or code could not check what was cited (one of
 * REQUIREMENT_UNCHECKED_REASONS). The combined route, and every report an earlier instrument wrote, keep the legacy
 * tokens (`LEGACY_REQUIREMENT_STATUSES`); a report's `promptVersion` says which set it holds.
 */
export const REQUIREMENT_STATUSES = Object.freeze(['done', 'partly-done', 'not-done', 'not-checked']);
export const LEGACY_REQUIREMENT_STATUSES = Object.freeze(['addressed', 'partly-addressed', 'open']);

/**
 * Owner decision D71 (b) ("when unsure, keep the row with its weakest status"): why code published a
 * session-only requirement `not-checked` in place of the status its answer proposed — the row is never dropped and never
 * shown stronger than its checked evidence:
 *   deliverable_ungrounded  a done or partly-done row's deliverable is not one exact quote (at most 120 characters) of a
 *                           source its window showed
 *   deliverable_not_after   its deliverable was not recorded after the instruction, in the instruction's session
 *   check_not_completed     its deliverable is a RESULT whose typed outcome is NOT_COMPLETED_OUTCOMES
 *   shortfall_ungrounded    a partly-done or not-done row's shortfall does not ground, or was not recorded after the
 *                           instruction, in its session
 * D101 (owner decision 2026-10-17): a row lowered for its deliverable or shortfall at the quote gate (the three reasons
 * that name one) also carries the cause of the grounding test that refused it (GROUNDING_CAUSES; the anchor's causes,
 * GROUNDING_ANCHOR_CAUSES, for `deliverable_not_after`), the quote's place (QUOTE_PLACES, the report's only) and, for a
 * length cause, `quoteLength`.
 *   ask_unreviewed          code's own row for a human message recorded in the window that no row cites (fixed words:
 *                           REQUIREMENT_UNREVIEWED_TEXT)
 *   challenge_refuted       its status's proposition was refuted by the challenge
 *   challenge_unsettled     every pass voted on it and it was not settled
 *   challenge_unexecuted    some pass never voted on it (a check that did not run: the window is incomplete, D58)
 *   write_command_not_run_or_failed  (D80, UNRUN_WRITE_REASON) its deliverable quotes only the body of a write the
 *                           slicer parsed from a command that did not run, failed or stopped before it finished
 *                           (`unrunEnd`, `quotesOnlyUnrunWrite`); checked after every check above it, so no row an
 *                           earlier reason lowers moves
 *   check_end_unread        (D99, F1 guard) its deliverable is a RESULT or an ACTION whose typed outcome is end-unread:
 *                           later records mention the run, and Sonah could not read whether or how it ended. Lowered
 *                           where `check_not_completed` would be, with words that say no absence
 *   check_end_unchecked     (D99, review of A1b) the same, in the form END_UNCHECKED_FORM: no later mention of the run
 *                           is established, and Sonah could not check whether the recording holds an end of it
 */
export const REQUIREMENT_UNCHECKED_REASONS = Object.freeze(['deliverable_ungrounded', 'deliverable_not_after',
  'check_not_completed', 'shortfall_ungrounded', 'ask_unreviewed', 'challenge_refuted', 'challenge_unsettled',
  'challenge_unexecuted', UNRUN_WRITE_REASON, 'check_end_unread', 'check_end_unchecked']);
/** The fixed words of code's own row for a human message no row cites (`ask_unreviewed`). */
export const REQUIREMENT_UNREVIEWED_TEXT = 'the review named no ask from this message';
/**
 * S3 (the asks fixes, 2026-10-13): why the re-ask of a requirement whose status the challenge refuted
 * (run-review.js `restatedRequirements`) published no new status — the row then stays not-checked with
 * `challenge_refuted`, as it was before the re-ask existed. Counted per window; never a row's reason:
 *   request_bound  the re-ask's request does not fit the review's request bound, or there is no request to re-ask
 *   no_answer      the re-ask's call failed, or its answer is not in the narrative's shape
 *   no_row         the answer holds no readable requirement row (in the response contract's shape) whose instruction is
 *                  the ask's own (the same human message and words), or more than one
 *   ungrounded     the row's status does not hold under code's checks (checklist.js `checkedRequirement` lowered it)
 *   not_checked    the answer gave the ask not-checked
 *   same_status    the answer gave the ask the very status the challenge refuted
 * A new status that passed all of these is asked as its own item and published only when that check upholds it; how
 * that check ended is counted by RESOLUTION_CHALLENGE_OUTCOMES.
 */
export const REQUIREMENT_RESTATUS_WITHHELD = Object.freeze(['request_bound', 'no_answer', 'no_row', 'ungrounded',
  'not_checked', 'same_status']);
/**
 * W1 A (owner decision 2026-10-13): why a session-only decision the challenge refuted on who decided it — its choice
 * upheld by its own check — got no new column from its one re-ask (run-review.js `recolumnedDecisions`); it is then
 * published "could not tell" with DECISION_COLUMN_REFUTED. Counted per window; never a row's reason:
 *   request_bound   the re-ask's request does not fit the review's request bound, or there is no request to re-ask
 *   no_answer       the re-ask's call failed, or its answer is not in the narrative's shape
 *   no_row          the answer holds no readable decision row (in the response contract's shape) whose choice is the
 *                   decision's own (the same set of actions, the same stated receipt, the same notActing), or more than
 *                   one
 *   could_not_tell  the row gives neither constrainedBy nor instructionReview
 *   ungrounded      the row's column does not hold under code's checks (ledger.js `groundDecision` derives none)
 *   same_column     the row's column is the very column the challenge refuted, as code derives it
 * A new column that passed all of these is asked as its own item and published only when that check upholds it; how
 * that check ended is counted by RESOLUTION_CHALLENGE_OUTCOMES, and how the existence check ended likewise.
 */
/** W1 A (the review of the W1-W3 fixes: one spelling, never retyped): the members of a window's `recolumn` record, in
 *  order — `refuted` (the decisions refuted on who decided them), `existence` (how their existence check ended, by
 *  RESOLUTION_CHALLENGE_OUTCOMES), `asked` (the re-asks sent), `withheld` (by DECISION_RECOLUMN_WITHHELD) and `challenged`
 *  (how the new column's check ended, by RESOLUTION_CHALLENGE_OUTCOMES). Closed. */
export const DECISION_RECOLUMN_RECORD = Object.freeze(['refuted', 'existence', 'asked', 'withheld', 'challenged']);
export const DECISION_RECOLUMN_WITHHELD = Object.freeze(['request_bound', 'no_answer', 'no_row', 'could_not_tell',
  'ungrounded', 'same_column']);
/**
 * G2 (owner decision 2026-10-15): a session-only choice not to act (a decision proposal with `notActing` true) that the
 * challenge refuted and whose existence check (W1 A, run-review.js `recolumnedDecisions`) refuted too is put to the
 * reviewer once more, for the agent's own words that state the choice (run-review.js `reanchoredChoices`). Why no new
 * anchor went on to its own existence check — counted per window, never a row's reason:
 *   request_bound  the re-ask's request does not fit the review's request bound, or there is no request to re-ask
 *   no_answer      the re-ask's call failed, or its answer is not in the narrative's shape
 *   none_stated    the answer gives no decision row: the reviewer found no words of the agent that state the choice
 *   no_row         the answer gives rows, but not exactly one readable decision row that is this choice: a choice not
 *                  to act on the decision's own set of actions, dimension, choice and value, character for character
 *   same_anchor    the row's `stated` is in the refuted anchor's event, and one of the two quotes holds the other
 *   ungrounded     the choice on the row's anchor does not hold under code's checks (ledger.js `groundDecision`)
 */
export const NOT_ACTING_REANCHOR_WITHHELD = Object.freeze(['request_bound', 'no_answer', 'none_stated', 'no_row',
  'same_anchor', 'ungrounded']);
/** G2: why no check of who decided it was asked for a re-anchored choice its existence check upheld — the column words
 *  of DECISION_RECOLUMN_WITHHELD, the same meanings: `could_not_tell` (the row gives neither constrainedBy nor
 *  instructionReview), `ungrounded` (that column does not hold under code's checks). Such a choice is published as the
 *  ledger grounds any decision whose column does not hold (`groundDecision`: "could not tell", with the ledger's own
 *  column reason), never with a check's reason. Counted per window; never a row's reason. Closed. */
export const NOT_ACTING_REANCHOR_COLUMN_WITHHELD = Object.freeze(['could_not_tell', 'ungrounded']);
/** G2: the members of a window's `reanchor` record, in order — `refuted` (its choices not to act whose existence check
 *  refuted them: the re-asks proposed), `asked` (the re-asks sent), `withheld` (by NOT_ACTING_REANCHOR_WITHHELD),
 *  `existence` (how the new anchor's existence check ended, by RESOLUTION_CHALLENGE_OUTCOMES: `upheld` is the choices
 *  kept), `columnWithheld` (by NOT_ACTING_REANCHOR_COLUMN_WITHHELD) and `challenged` (how the new column's check ended,
 *  by RESOLUTION_CHALLENGE_OUTCOMES). Closed. */
export const NOT_ACTING_REANCHOR_RECORD = Object.freeze(['refuted', 'asked', 'withheld', 'existence', 'columnWithheld',
  'challenged']);
/**
 * A fact code adds beside a requirement row at report time, never a stronger status:
 *   no_deliverable_by_end  a not-checked row with no deliverable, whose last reporting window holds the recording's last
 *                          event (fixed words: REQUIREMENT_FACT_WORDS)
 */
export const REQUIREMENT_FACTS = Object.freeze(['no_deliverable_by_end']);
export const REQUIREMENT_FACT_WORDS = Object.freeze({
  no_deliverable_by_end: 'the recording ends in this part; the review cites nothing that delivers this ask' });

/**
 * An ask's status never contradicts Sonah's own findings (D87, amended): how the code step tied a published item to an
 * ask, read from structure only (ask-code-links.js `askCodeLinks`) and written as `codeLinks` on a copy of the ask's row
 * beside its status — never in it: no status, receipt, reason or fact is read from or written by a link. Closed.
 *   leads_from            a published finding's `leadsFrom` names the ask's row (`source` requirements, its `index`)
 *   trace_quotes_ask      a published finding's trace has a step quoting the person's instruction in the ask's own
 *                         instruction event, at a place that overlaps the ask's instruction quote by half the shorter
 *                         (the rule "Cited in" uses: `locateQuote`, `overlapping`)
 *   contradicted_by_code  the row's code check reads contradicted by the code at review time
 *   withheld_finding      a withheld finding's `leadsFrom` names the ask's row
 *   question_concerns     a published open question of the code review concerns the ask's row
 *   unconfirmed_finding   (code-verify/3, D110) the `leadsFrom` of a finding Sonah could not confirm (one premise of
 *                         its check rests outside the repository and the language: `codePass.unconfirmed`) names the
 *                         ask's row
 * ASK_CODE_ATTENTION_LINKS: the links that make an ask done (or addressed) or not checked an attention row (review.js
 * `askRowKind`, `asksCodeFinding`); the others are a line beside the row only, so a finding Sonah could not confirm never
 * moves an ask. (`shown_in_code`, a row's code check reading shown in the code, went with code-pass/9: a link of that
 * name on an earlier report is read as no link.)
 */
export const ASK_CODE_LINKS = Object.freeze(['leads_from', 'trace_quotes_ask', 'contradicted_by_code', 'withheld_finding',
  'question_concerns', 'unconfirmed_finding']);
export const ASK_CODE_ATTENTION_LINKS = Object.freeze(ASK_CODE_LINKS.slice(0, 3));

/**
 * Why an id a row cites in `restsOn` was not accepted (counted; the row keeps its status, and a claim whose
 * every id was refused is published as if it cited none):
 *   malformed     not an event id string
 *   not_action    not an ACTION its window showed
 *   out_of_order  a requirement's: not recorded after its instruction; a claim's: not recorded before its statement
 *   cross_actor   not of the row's own session (a requirement's instruction, a claim's statement)
 *   completed     its typed outcome is not one of RESTS_ON_OUTCOMES: its check ran to an end, or (D99) Sonah could not
 *                 read whether or how it ended (end-unread; counted here until each refusal names a cause of its own)
 * W2 (owner decision 2026-10-13): a cited RESULT whose recorded `invocation` is an ACTION its window showed is checked as
 * that ACTION (checklist.js `restsOnCheck`), never refused `not_action`; each such move is counted in the closed counter
 * `restsOnRepaired` (requirements, claims) beside these reasons.
 */
export const RESTS_ON_REJECTIONS = Object.freeze(['malformed', 'not_action', 'out_of_order', 'cross_actor', 'completed']);
/** W2: the name of that closed counter, in a window's checklist record and the report's `counts.checklist` (the review of
 *  the W1-W3 fixes: one spelling, never retyped). */
export const RESTS_ON_REPAIRED = 'restsOnRepaired';

/**
 * Why a `notClaims` entry was not accepted (counted):
 *   malformed          not `{ eventId, lines: [whole numbers >= 1] }`
 *   not_closing        it names no closing message of its window (`windowClosingMessages`)
 *   line_out_of_range  a line number past the closing message's lines
 */
export const NOT_CLAIM_REJECTIONS = Object.freeze(['malformed', 'not_closing', 'line_out_of_range']);
/** The closed name of a closing-message line no grounded claim quote covers and no accepted `notClaims` lists. */
export const CLOSING_LINE_UNREVIEWED = 'closing_line_unreviewed';

// ---- D71 (S3): the new channels — their closed words (owner decisions D71 c, d, e, f, g; C-06 "D71 (S3)") ----------

/**
 * D71 (c): the typed outcomes (`resultOutcome`, recorder fields only) of a RESULT the failures step lists — the owner's
 * "failed, did not run, or no terminal status": failed (ran-failed, and failed-or-refused, a failure a recorder that
 * types no refusal recorded), did not run (did-not-run), no terminal status (no-terminal-status: run in the background,
 * or stopped before it finished, so no terminal outcome of its check was recorded).
 */
export const FAILURE_OUTCOMES = Object.freeze(['ran-failed', 'failed-or-refused', 'did-not-run', 'no-terminal-status']);
/**
 * D71 (c): what the agent did about one listed failure, as the answer says and code checks it (checklist.js
 * `checkedFailure`):
 *   acted-on     an ACTION of the failed action's own session, recorded after the RESULT, responds to it
 *   told-human   a message of the main agent (the only words the human is shown), recorded after the RESULT, tells the
 *                human about it
 *   passed-over  the failed action's session ended the turn the RESULT was recorded in (its first closing message after
 *                the RESULT) without acting on it or telling the human about it
 *   not-checked  what settles it is not in the window, or code could not check what was cited (FAILURE_UNCHECKED_REASONS)
 */
export const FAILURE_HANDLINGS = Object.freeze(['acted-on', 'told-human', 'passed-over', 'not-checked']);
/**
 * D71 (c) and (b): why code published a failure row `not-checked` in place of the handling its answer proposed — never
 * dropped, never stronger than its checked evidence:
 *   response_ungrounded          its response is not one exact quote (at most 120 characters) of a source its window
 *                                showed, in a role its handling admits
 *   response_not_after           its response was not recorded after the RESULT
 *                                (D101: a row lowered for one of these two also carries the cause of the grounding test
 *                                that refused it, GROUNDING_CAUSES, as a requirement row does)
 *   response_other_agent         acted-on or passed-over: the response is not of the failed action's own session
 *   response_not_shown_to_human  told-human: the response is a helper's words, which the human is not shown
 *   turn_end_not_cited           passed-over: the response is not the first closing message of the failed action's session
 *                                recorded after the RESULT (the end of the turn it was recorded in)
 *   failure_unreviewed           code's own row for a listed RESULT the answer gave no row
 *   challenge_refuted            its handling's proposition was refuted by the challenge
 *   challenge_unsettled          every pass voted on it and it was not settled
 *   challenge_unexecuted         some pass never voted on it (a check that did not run: the window is incomplete, D58)
 *   write_command_not_run_or_failed  (D80, UNRUN_WRITE_REASON) an acted-on response that quotes only the body of a
 *                                write the slicer parsed from a command that did not run, failed or stopped before it
 *                                finished (`unrunEnd`, `quotesOnlyUnrunWrite`); checked after every check above it
 */
export const FAILURE_UNCHECKED_REASONS = Object.freeze(['response_ungrounded', 'response_not_after',
  'response_other_agent', 'response_not_shown_to_human', 'turn_end_not_cited', 'failure_unreviewed',
  'challenge_refuted', 'challenge_unsettled', 'challenge_unexecuted', UNRUN_WRITE_REASON]);
/**
 * D71 (c): why a proposed failure row was left out (counted; nothing anchors it):
 *   malformed   not `{ eventId, handling, response? }` of the contract's shape
 *   not_listed  its eventId names no RESULT the window listed (FAILURE_OUTCOMES among the window's own results)
 *   merged      a second row for a RESULT an earlier row already answers
 */
export const FAILURE_REJECTIONS = Object.freeze(['malformed', 'not_listed', 'merged']);
/** D71 (c): the challenge item type of a failure row (its own run, `challenge:<label>:failure:…`). */
export const FAILURE_ITEM_TYPE = 'failure';

// ---- D101 (owner decision 2026-10-17): which grounding test refused a quote ---------------------------------------------

/**
 * D101: the grounding tests a quote gate runs on one receipt, in this fixed order, each named by the one cause a refusal
 * carries. The order decides only which cause is named: a receipt that fails any test is refused as before, and its row
 * is lowered to the same status with the same closed reason (REQUIREMENT_UNCHECKED_REASONS, FAILURE_UNCHECKED_REASONS).
 * Each test reads structure, provenance or the verbatim text only, never a word for its meaning.
 *   receipt_malformed    no receipt, or not one of the field's shape: only `eventId`, `role` and `quote`, an event id that
 *                        is a non-empty string, a role and a quote that are strings
 *   role_not_allowed     its role is not one the field may cite, or not a grounding role (session.js GROUNDING_ROLES)
 *   quote_too_short      its quote, trimmed, is shorter than the field's least length (QUOTE_LIMITS `min`)
 *   quote_over_limit     its quote is longer than the field's greatest length (QUOTE_LIMITS `max`)
 *   event_missing        the recording, as Sonah read it (the session's events), holds no event of its id
 *   role_not_event_kind  its role is not one Sonah reads from the event's kind (session.js `eventRoles`, a rule by kind,
 *                        never the event's words)
 *   session_mismatch     it names a session other than the recording's
 *   event_not_shown      the window was not shown that event in that role (its source map): another window may have
 *                        shown it, and this one the event in another role
 *   synthetic_marker     its quote holds a mark like those Sonah writes into a source (receipt-repair.js
 *                        `spansSyntheticMarker`, which says yes when in doubt: the recording's own text may hold one)
 *   not_found            every test above held, and its quote is not one exact substring of a source of that event and
 *                        role (in a window, of a span the window showed: the caller's `shownSession` view): the literal
 *                        search ran there and failed; the quote can be elsewhere in the window or in the recording
 *   not_anchor_session   (a field whose anchor must share its session) code cannot place its event in the anchor's
 *                        session (`oneSession`): a helper's event for a root anchor, or the reverse, an observation whose
 *                        call another session recorded, or no anchor event
 *   not_after            (a field that has an anchor) code cannot place its event after the anchor: both carry a
 *                        recorded order (`sequence`) and its event's is not greater, or either carries none
 * A refusal also records where the quote is (QUOTE_PLACES), found by the same literal search, for the report only: no
 * reader shows it.
 */
export const GROUNDING_CAUSES = Object.freeze(['receipt_malformed', 'role_not_allowed', 'quote_too_short',
  'quote_over_limit', 'event_missing', 'role_not_event_kind', 'session_mismatch', 'event_not_shown', 'synthetic_marker',
  'not_found', 'not_anchor_session', 'not_after']);
const [RECEIPT_MALFORMED, ROLE_NOT_ALLOWED, QUOTE_TOO_SHORT, QUOTE_OVER_LIMIT, EVENT_MISSING, ROLE_NOT_EVENT_KIND,
  SESSION_MISMATCH, EVENT_NOT_SHOWN, SYNTHETIC_MARKER, NOT_FOUND, NOT_ANCHOR_SESSION, NOT_AFTER] = GROUNDING_CAUSES;
/** D101: the two causes that are a length test; a refusal for one carries the lengths code measured and the limit. */
export const GROUNDING_LENGTH_CAUSES = Object.freeze([QUOTE_TOO_SHORT, QUOTE_OVER_LIMIT]);
/** D101: the two causes of the anchor's tests (its session, then its order), by name for every reader that maps them to
 *  its own reason (`deliverable_not_after`, `response_not_after`): the test the beta.2 gate ran as one. */
export const GROUNDING_ANCHOR_CAUSES = Object.freeze([NOT_ANCHOR_SESSION, NOT_AFTER]);
/** D101: the reasons the checklist's quote gate lowers a row for, by name from their closed lists (a row lowered for one
 *  carries a cause): a requirement's deliverable or shortfall, a failure row's response. */
export const GROUNDING_GATE_REASONS = Object.freeze({
  requirement: Object.freeze([REQUIREMENT_UNCHECKED_REASONS[0], REQUIREMENT_UNCHECKED_REASONS[1],
    REQUIREMENT_UNCHECKED_REASONS[3]]),
  failure: Object.freeze([FAILURE_UNCHECKED_REASONS[0], FAILURE_UNCHECKED_REASONS[1]]),
});
/**
 * D125 (its review, 2026-10-20): the reasons a not-checked ask may carry for the code review's `holds` verdict to be
 * noted on its row (code-pass.js `askCodeHolds`; D125 amended, option 3: a note only, its status and every count as
 * before), which also admits a row with no reason (the session review's own not checked: what would settle the ask was
 * not in its window), by name from the closed list: the session review proposed the ask delivered, done or in part, and
 * Sonah's quote gate refused only the evidence that it cited — not one exact quote of what its window showed
 * (`deliverable_ungrounded`), or not recorded after the ask in the ask's session (`deliverable_not_after`). Every
 * other reason is a check of Sonah's that speaks against the ask or did not settle it: the cited run did not complete,
 * its end is unread or its write did not run; the session review proposed the ask not done or partly done
 * (`shortfall_ungrounded`); the challenge refuted the status, did not settle it or did not run; or the row is code's own
 * (`ask_unreviewed`). A verdict that no check of Sonah's challenged never reads over such a reason: ambiguous evidence is
 * NONE.
 */
export const ASK_CODE_HOLDS_REASONS = Object.freeze([REQUIREMENT_UNCHECKED_REASONS[0], REQUIREMENT_UNCHECKED_REASONS[1]]);
/**
 * D101: where a refused receipt's quote is, by the literal search alone — for the report, never for a reader:
 *   cited    in a source of the cited event, in the cited role, that the window showed
 *   shown    elsewhere in what the window showed (another event, or another role)
 *   nowhere  in nothing the window showed, or the receipt holds no quote
 */
export const QUOTE_PLACES = Object.freeze(['cited', 'shown', 'nowhere']);
const [PLACE_CITED, PLACE_SHOWN, PLACE_NOWHERE] = QUOTE_PLACES;
/**
 * D101: the least and greatest length of a quote, per field that a grounding gate checks (`groundingCheck`). One table;
 * every gate reads its bounds here. The least is of the trimmed quote (MIN_QUOTE_CHARS); the greatest is a project rule
 * (EVIDENCE_QUOTE_MAX).
 *   deliverable  a checklist requirement's deliverable (checklist.js `checkedRequirement`)
 *   shortfall    a checklist requirement's shortfall
 *   response     a failure row's response (checklist.js `checkedFailure`)
 */
export const QUOTE_LIMITS = Object.freeze({
  deliverable: Object.freeze({ min: MIN_QUOTE_CHARS, max: EVIDENCE_QUOTE_MAX }),
  shortfall: Object.freeze({ min: MIN_QUOTE_CHARS, max: EVIDENCE_QUOTE_MAX }),
  response: Object.freeze({ min: MIN_QUOTE_CHARS, max: EVIDENCE_QUOTE_MAX }),
});
const RECEIPT_FIELDS = Object.freeze(['eventId', 'role', 'quote']);

/** Was the window shown this event, in this role (its source map)? A source map lists exactly what it showed. */
export const shownInRole = (sourceMap, eventId, role) => sourceMap != null && typeof eventId === 'string'
  && Object.hasOwn(sourceMap, eventId) && Array.isArray(sourceMap[eventId])
  && sourceMap[eventId].some((source) => source?.role === role);

/** The event a receipt cites, or null (a session that cannot read its id holds none). */
function citedEvent(session, eventId) {
  try { return typeof session?.event === 'function' ? session.event(eventId) ?? null : null; } catch { return null; }
}
/** Is `quote` one exact substring of a source of `event` in `role` (the literal search: verifyReceipt's own)? */
function literalIn(session, event, role, quote) {
  try {
    return event != null && session.sourcesFor(event)
      .some((source) => source?.role === role && typeof source.text === 'string' && source.text.includes(quote));
  } catch { return false; }
}

const recordedOrder = (event) => (Number.isSafeInteger(event?.sequence) ? event.sequence : null);

/** D101: each grounding test as a predicate of one check `c` (`{ session, value, roles, limits, sourceMap, shown,
 *  anchor, event }`), in GROUNDING_CAUSES order. A test is run only after every test before it held, so it may read what
 *  they proved (a receipt of the shape, its event). */
const GROUNDING_TESTS = Object.freeze({
  [RECEIPT_MALFORMED]: ({ value }) => plainObject(value)
    && Object.keys(value).every((key) => RECEIPT_FIELDS.includes(key)) && typeof value.eventId === 'string'
    && value.eventId.length > 0 && typeof value.role === 'string' && typeof value.quote === 'string',
  [ROLE_NOT_ALLOWED]: ({ value, roles }) => roles.includes(value.role) && GROUNDING_ROLES.includes(value.role),
  [QUOTE_TOO_SHORT]: ({ value, limits }) => value.quote.trim().length >= limits.min,
  [QUOTE_OVER_LIMIT]: ({ value, limits }) => value.quote.length <= limits.max,
  [EVENT_MISSING]: ({ event }) => event !== null,
  [ROLE_NOT_EVENT_KIND]: ({ value, event }) => eventRoles(event).includes(value.role),
  [SESSION_MISMATCH]: ({ value, session }) => value.sessionKey == null || value.sessionKey === session.sessionKey,
  [EVENT_NOT_SHOWN]: ({ value, sourceMap, shown }) => !shown || shownInRole(sourceMap, value.eventId, value.role),
  [SYNTHETIC_MARKER]: ({ value }) => !spansSyntheticMarker(value.quote),
  [NOT_FOUND]: ({ value, session, event }) => literalIn(session, event, value.role, value.quote),
  [NOT_ANCHOR_SESSION]: ({ session, anchor, event }) => anchor === null || anchor.sameSession !== true
    || oneSession(session, [anchor.event, event]),
  [NOT_AFTER]: ({ anchor, event }) => anchor === null || (recordedOrder(anchor.event) !== null
    && recordedOrder(event) !== null && recordedOrder(event) > recordedOrder(anchor.event)),
});

/** The one check object every grounding test reads. `anchor` is null (the field has none) or `{ event, sameSession }`:
 *  the event the cited one must be recorded after (null when there is none to read) and whether it must share its
 *  session. Throws (a caller's error, never the model's) on a field with no row in QUOTE_LIMITS. */
function groundingContext(session, value, { field, roles = [], sourceMap = null, shown = true, anchor = null }) {
  if (!Object.hasOwn(QUOTE_LIMITS, field)) throw new RangeError(`no quote limits for ${field}`);
  const event = plainObject(value) && typeof value.eventId === 'string' ? citedEvent(session, value.eventId) : null;
  return { session, value, roles: Array.isArray(roles) ? roles : [], limits: QUOTE_LIMITS[field], sourceMap, shown,
    anchor: plainObject(anchor) ? { event: anchor.event ?? null, sameSession: anchor.sameSession === true } : null, event };
}

/** D101: the lengths a length test measured on a quote, for the reader's words: `chars`, its characters as given (code
 *  points: an emoji is one); `counted`, the length the bound is tested on (JavaScript string length, where some
 *  characters count as two, of the trimmed quote for the least); `limit`, the bound it broke. */
function measuredLength(quote, cause, limits) {
  const least = cause === QUOTE_TOO_SHORT;
  return { chars: [...quote].length, counted: least ? quote.trim().length : quote.length,
    limit: least ? limits.min : limits.max };
}

/** D101: where a refused receipt's quote is (QUOTE_PLACES), by the literal search alone. A gate with no window test
 *  (`shown` false) places a quote in its cited event and role wherever the session holds it. */
export function quotePlace(session, value, sourceMap, { shown = true } = {}) {
  if (!plainObject(value) || typeof value.quote !== 'string' || !value.quote) return PLACE_NOWHERE;
  const holds = (eventId, role) => literalIn(session, citedEvent(session, eventId), role, value.quote);
  if ((!shown || shownInRole(sourceMap, value.eventId, value.role)) && holds(value.eventId, value.role))
    return PLACE_CITED;
  for (const [eventId, listed] of Object.entries(sourceMap ?? {})) {
    if (!Array.isArray(listed)) continue;
    for (const role of new Set(listed.map((source) => source?.role).filter((r) => typeof r === 'string')))
      if (!(eventId === value.eventId && role === value.role) && holds(eventId, role)) return PLACE_SHOWN;
  }
  return PLACE_NOWHERE;
}

/**
 * D101: one receipt through every grounding test, in GROUNDING_CAUSES order — the one quote gate the checklist's fields
 * share. `field` names its bounds in QUOTE_LIMITS; `roles` the roles it may cite; `sourceMap` what its window showed
 * (`shown` false: a gate with no window test); `anchor` the field's anchor, `{ event, sameSession }`, or null (none).
 * Returns `{ ok: true, receipt }` (the receipt, its three fields copied) or `{ ok: false, cause, place, quoteLength? }`:
 * the first test that failed, where the quote is (`quotePlace`, for the report only), and, for a length cause, `{ chars,
 * counted, limit }` (`measuredLength`). Pure; never throws on model output.
 */
export function groundingCheck(session, value, options) {
  const c = groundingContext(session, value, options);
  for (const cause of GROUNDING_CAUSES) {
    let held;
    try { held = GROUNDING_TESTS[cause](c) === true; } catch { held = false; }
    if (held) continue;
    const quoteLength = GROUNDING_LENGTH_CAUSES.includes(cause) ? measuredLength(value.quote, cause, c.limits) : null;
    return { ok: false, cause, place: quotePlace(session, value, c.sourceMap, { shown: c.shown }),
      ...(quoteLength ? { quoteLength } : {}) };
  }
  return { ok: true, receipt: { eventId: value.eventId, role: value.role, quote: value.quote } };
}

/** D101: does the one grounding test `cause` hold for this receipt, run alone (`groundingCheck`'s options)? For a check
 *  of a recorded cause: its test fails, and every test before it holds. False on a cause outside the list. */
export function groundingTestHolds(session, value, cause, options) {
  if (!GROUNDING_CAUSES.includes(cause)) return false;
  try { return GROUNDING_TESTS[cause](groundingContext(session, value, options)) === true; } catch { return false; }
}

/** D101: the fields a row lowered at a quote gate carries beside its closed reason — its `cause`, the quote's place
 *  (`quotePlace`, the report's only) and, for a length cause, `quoteLength` — from a `groundingCheck` refusal; none
 *  from anything else. */
export const groundingRefusalFields = (refusal) => (plainObject(refusal) && refusal.ok === false
  && GROUNDING_CAUSES.includes(refusal.cause)
  ? { cause: refusal.cause, quotePlace: refusal.place,
    ...(GROUNDING_LENGTH_CAUSES.includes(refusal.cause) && plainObject(refusal.quoteLength)
      ? { quoteLength: { chars: refusal.quoteLength.chars, counted: refusal.quoteLength.counted,
        limit: refusal.quoteLength.limit } } : {}) }
  : {});
/** D101: the same fields, copied from a row (or a checked row) that already carries them; none from any other. */
export const groundingFieldsOf = (row) => groundingRefusalFields(plainObject(row)
  ? { ok: false, cause: row.cause, place: row.quotePlace, quoteLength: row.quoteLength } : null);

/**
 * D71 (e), (g): what recorded evidence a contradicted claim's `contradictedBy` cites, set by code from the receipt's
 * verified role and its event (`contradictionSourceOf`), never by the model; a published finding carries it when it is
 * not a result, and its finding title names it (fixed words):
 *   result                a RESULT (role observation), as before
 *   human_message         data the human supplied: a human message recorded before the statement (role instruction)
 *   file_content          a file's recorded content: the removed or context lines of an edit recorded before the
 *                         statement that ran to a recorded success (role code)
 *   project_instructions  the project's own instruction file as the harness gave it to the same agent, recorded before
 *                         the statement (role project-instructions)
 *   own_written           (W2, owner decision 2026-10-13) the text the statement's own actor's edit or write added (role
 *                         code): its added lines or the body it wrote, never its removed or context lines (those are
 *                         file_content, which a quote found there stays), the edit or write recorded before the statement
 *                         and run to a recorded success (FILE_CONTENT_OUTCOMES), with no later change to the same typed
 *                         path recorded between them (`source_rewritten` otherwise)
 */
export const CONTRADICTION_SOURCES = Object.freeze(['result', 'human_message', 'file_content', 'project_instructions',
  'own_written']);
/** W2: the two code sources, by name for every reader (the review of the W1-W3 fixes: one spelling, read from the
 *  vocabulary, never retyped). */
export const FILE_CONTENT_SOURCE = CONTRADICTION_SOURCES[2];
export const OWN_WRITTEN_SOURCE = CONTRADICTION_SOURCES[4];
/** D71 (e), (g): the receipt role each contradiction source quotes. W2: file_content and own_written both quote code; which
 *  one a receipt is, code reads from the recorded region that holds its quote (`contradictionSourceOf`). */
export const CONTRADICTION_ROLES = Object.freeze({ result: 'observation', human_message: 'instruction',
  file_content: 'code', project_instructions: 'project-instructions', own_written: 'code' });
/** The distinct roles a contradiction may quote, in CONTRADICTION_SOURCES order (a contract lists each once). */
export const CONTRADICTION_RECEIPT_ROLES = Object.freeze([...new Set(Object.values(CONTRADICTION_ROLES))]);
/** D71 (e): the typed outcomes of an edit whose removed or context lines are recorded file content: it ran to a recorded
 *  success (a failed edit's text is what the agent expected, never what the file held). */
export const FILE_CONTENT_OUTCOMES = Object.freeze(['ran-completed', 'ran-exit-0']);

// ---- M33 N: an edit against a human instruction, session-only (owner decision 2026-10-01) -------------------------
//
// A change the agent, or a helper it delegated to, made against an explicit instruction of the human — the human said
// not to do something and a later edit, write or command did it — is the existing finding kind
// `edit_under_negative_requirement`, reached in a session-only review by its own route (forbidden.js): the narrative
// proposes it (`forbiddenEdits`, `sonah.narrative/14`), code checks it, three challengers judge one proposition in
// code's fixed words (challenge.js FORBIDDEN_EDIT_PROPOSITION, `sonah.challenge/11`), and code alone sets its status.
// The combined (PR) route is unchanged: its joint request proposes the kind as before (code-review.js).

/** The challenge item type of a forbidden edit (its own three-pass run, `challenge:wN:forbidden:…`). */
export const FORBIDDEN_EDIT_ITEM_TYPE = 'forbidden-edit';

// Why a proposed forbidden edit was not put to the challengers — one closed reason each, checked by code in this order
// (forbidden.js `readForbiddenEdit`), counted in `counts.forbiddenEdits.withheld`. Fail closed: no check is skipped,
// and none reads meaning.
//   malformed               not exactly the response contract's shape: {text, instruction, violation, reportedBy?},
//                           each receipt {eventId, role, quote}, the two quotes 4–120 characters. No check could read
//                           it: like any unread proposal (D58) it leaves its window incomplete
//   instruction_not_human   the instruction receipt names an event that is not an instruction of the root session
//                           recorded with human authority: the agent's own words, an agent assignment, a helper's brief.
//                           W1 B (owner decision 2026-10-13): a project instruction file the main agent was given is
//                           read as the person's words; one given to a helper is this
//   instruction_context     M33 N repair; M34 labels: the instruction is material the human attached (its block the
//                           slicer labelled `human` + `attached`: an @-mentioned file's content), never words the human
//                           said. Read from the label, never from tag names (the tag list is deleted). A row the
//                           recorder marks as its own (a loaded skill, a slash command's expansion) is no instruction
//                           event at all (labelled harness), so it is never cited here; nor is a harness's context
//                           message (Codex's, by its typed human channel)
//   instruction_ungrounded  the instruction quote is not an exact substring (strict, no repair) of that event's text as
//                           the window was shown it, or names no event. M33 N repair: or it starts or ends inside a word
//                           of that text (a cut word can turn what it says around: "not" read as "no")
//   instruction_partial     the instruction's words are not all recorded (elided, capped, redacted, several spans): what
//                           is missing may change what it ruled out
//   violation_not_action    the violation receipt names an event that is not an action (an invocation)
//   violation_carried       the action is one carried into the window from before it: the window it was recorded in
//                           reports it
//   violation_ungrounded    the violation quote is not an exact substring (strict, no repair) of that action's text of
//                           its role as the window was shown it, or names no event; M33 N repair: or it starts or ends
//                           inside a word of that text
//   violation_not_written   the quote is not in what the action did: for a write, create or edit, the body it wrote
//                           (never its path or its tool input) or (M33 brittleness M3) the text it removed; for a
//                           command, the command it ran; for a delete (M33 brittleness M3), exactly the path it
//                           recorded; any other action (a read, a hand-off, another tool) writes and runs nothing
//                           quotable. M33 N repair: text the change kept is neither what it wrote nor what it removed —
//                           the quote must occur more often (wrote) or fewer times (removed) in what it wrote to that
//                           path than in the path's text it replaced (its before side). A before side must be recorded
//                           whole when it is recorded, and for a removal it must be recorded, and so must the after
//                           side; an edit whose before side was not recorded at all cannot be told apart from text it
//                           kept
//   actor_unlinked          the action is a helper's that no verified child link attributes, or its actor cannot be
//                           named
//   violation_not_landed    the action's effect (session.js `effectOf`, D98) is not `landed` — its C-02 outcome
//                           (`actionOutcomeOf`) is not `succeeded`, or it was refused before it ran: recorded as
//                           failed or cancelled, or (M33 N repair) unknown or never recorded — a Codex apply_patch
//                           with no native typed status, a write with no result, a command with no result. What is
//                           not proved to have happened is never published as done
//   not_after               the action was not recorded after the instruction (by sequence; never guessed). W1 B: for a
//                           project instruction file, it is not one its window showed the main agent whole before the
//                           action (`projectFilesBefore`; its place is `afterSequence`)
//   history_partial         a human instruction recorded between them is not whole, a loss of the human instruction
//                           channel is unlocated or located between them, or an event between them cannot be placed:
//                           a later instruction that lifted the constraint could be missing from what is shown. M33 N
//                           repair: or an action between them whose result can record a human choice
//                           (`humanChoice`; M33 brittleness L3 review: or a question no instruction answers,
//                           forbidden.js `humanChoicesBetween`), or one of its results, was not shown to the window
export const FORBIDDEN_EDIT_REJECTIONS = Object.freeze(['malformed', 'instruction_not_human', 'instruction_context',
  'instruction_ungrounded', 'instruction_partial', 'violation_not_action', 'violation_carried', 'violation_ungrounded',
  'violation_not_written', 'actor_unlinked', 'violation_not_landed', 'not_after', 'history_partial']);

// M33 brittleness M4 session route (owner decision 2026-10-06): a forbidden edit's optional `reportedBy` (the agent's
// statement that told the human about the change) is the edit's proposed disclosure, checked and counted by the one
// disclosure vocabulary of both routes, DISCLOSURE_REJECTIONS (`counts.disclosures`). Its own vocabulary,
// FORBIDDEN_EDIT_REPORT_REJECTIONS (`counts.forbiddenEdits.reportRejected`), is deleted.

/** What a forbidden edit's violation quote is: what the action `wrote` into a file (role code, more often in what it
 *  wrote than in what it replaced) or the command it `ran` (role action); M33 brittleness M3: what it `removed` from a
 *  file (role code, fewer times in what it wrote than in the text it replaced, both sides recorded whole). Code derives
 *  it from the verified receipt and the recorded change (forbidden.js `breachOf`, again here: `forbiddenBreachOf`); the
 *  renderers' words follow it. M3 review: a `deleted` kind (a delete action quoted by its recorded path) is held back —
 *  a delete's outcome is not recorded, so it could not land; a delete stays `violation_not_written` until its outcome
 *  is captured. */
export const FORBIDDEN_EDIT_BREACHES = Object.freeze(['wrote', 'ran', 'removed']);

/** The marks (C-02, adapters/sonah-ledger.js F136) that say a recorded body is NOT the file's new whole state: text
 *  appended at the end, a new notebook cell, text the file received after shell expansion. */
const PARTIAL_BODY_MARKS = Object.freeze(['append', 'insert', 'expanded']);

/**
 * M33 brittleness M3 review: is a write or edit change's recorded before side exactly the text its after side replaced,
 * so that a quote occurring fewer times after than before was taken out by it? Read from the recorder adapter's own
 * statement of what that before side is (C-02 `extent.priorState`, adapters/sonah-ledger.js PRIOR_STATE), never
 * inferred from the texts:
 *   `edit-text`    the change's own replaced span, beside its own new text: comparable;
 *   `first-write`  the file as the record found it: comparable only on a whole-file write whose body is the file's new
 *                  whole state (none of PARTIAL_BODY_MARKS). On an edit it is not: the adapter places the whole prior
 *                  file on an edit's first change while its after side is only that edit's new text, so every line the
 *                  edit left untouched would read as taken out;
 *   any other state, or none: not comparable.
 * A removal over a path any of whose changes has a recorded before side that is not comparable fails closed
 * (forbidden.js `removedMore`, `removes`; `forbiddenBreachOf` here). Structure only; pure.
 */
export function replacedSideComparable(operation, change) {
  const prior = extentOf(change)?.priorState;
  if (prior === PRIOR_STATE.editText) return true;
  return prior === PRIOR_STATE.firstWrite && operation === 'write' && wholeFileBody(change);
}
const extentOf = (change) => (change !== null && typeof change === 'object' && change.extent !== null
  && typeof change.extent === 'object' && !Array.isArray(change.extent) ? change.extent : null);
/** Is a write change's recorded body the file's new whole state: its extent recorded, none of PARTIAL_BODY_MARKS? */
export function wholeFileBody(change) {
  const extent = extentOf(change);
  return extent !== null && PARTIAL_BODY_MARKS.every((mark) => extent[mark] !== true);
}

/**
 * M33 N repair (C-06 "M33 forbidden edits"): can this action's recorded result hold a choice the human made — a plan the
 * human approves, or rejects? A root action of that kind recorded between the instruction and the violating action is
 * named for the challengers (`humanChoicesBetween`), and shown whole with its results in every profile: the human may
 * have lifted the constraint by approving a plan that held what the action did. Code names it and never judges it. An
 * answer to a question is already a human instruction (OWNER DECISION B) when the adapter reads it as one (`answerTo`);
 * M33 brittleness L3 review: a question (`asksHuman`) no instruction answers is named as a choice too, its answer being
 * in its result alone (forbidden.js `humanChoicesBetween`). M33 brittleness L3: read from the recorder
 * adapter's flag (`humanChoice`, set from each recorder's own schema: adapters/sonah-ledger.js HUMAN_INTERACTION_TOOLS),
 * never from a tool name here. Only strictly true counts; a recorder whose schema cannot say declares that loss itself.
 */
export const humanChoice = (event) => event?.kind === 'invocation' && event.humanChoice === true;

/**
 * Code's own mark on a forbidden-edit challenge result whose change code proved undone in the same turn (forbidden.js
 * `forbiddenRevert`): upheld it publishes FYI `self_corrected`, so it is FYI-bound, never DECIDE-bound, and its unsettled
 * check holds nothing off CLEAN (as M33 H's helper statement). Set from the recording when the window's record is
 * built, never from the candidate; only strictly true counts, so a result without it is DECIDE-bound.
 */
export const FORBIDDEN_EDIT_REVERTED_MARK = 'revertedInTurn';

/** The withheld cause (`withheld.causes`) a forbidden edit a code check withheld is counted under, for every reason but
 *  `malformed`; each reason is in `counts.forbiddenEdits.withheld`. */
export const FORBIDDEN_WITHHELD_CAUSE = 'forbidden_edits';

const RESOLUTION_ROLES = Object.freeze({ observation: 'observation', statement: 'commentary' });
const RESOLUTION_PARTS = Object.freeze(Object.keys(RESOLUTION_ROLES));
const RESOLUTION_RECEIPT_KEYS = Object.freeze(['eventId', 'role', 'quote', 'sessionKey']);

const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

/**
 * The proposed `{observation, statement}` pair when `value` has exactly the resolution's shape —
 * two receipts, each with a nonempty eventId and string role and quote, and nothing else — or null.
 * Roles are not checked here (`resolutionRoles`), so a wrong role is named as itself.
 */
export function resolutionShape(value) {
  if (!plainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== RESOLUTION_PARTS.length || !RESOLUTION_PARTS.every((part) => keys.includes(part))) return null;
  const receipt = (r) => plainObject(r) && Object.keys(r).every((key) => RESOLUTION_RECEIPT_KEYS.includes(key))
    && typeof r.eventId === 'string' && r.eventId.length > 0 && typeof r.role === 'string'
    && typeof r.quote === 'string' && (r.sessionKey === undefined || typeof r.sessionKey === 'string');
  return RESOLUTION_PARTS.every((part) => receipt(value[part]))
    ? { observation: value.observation, statement: value.statement } : null;
}

/** Does a shaped pair carry the roles C-06 names: an observation and a commentary? */
export const resolutionRoles = (pair) => RESOLUTION_PARTS.every((part) => pair?.[part]?.role === RESOLUTION_ROLES[part]);

/**
 * M36 phase 3 (owner decision D68 F, critique c6): were these events recorded in ONE session — the same recorded child id
 * on every one (null: the root's), and an observation in the session of the call it answers? Structure only: an id code
 * cannot read as a helper's (C-03) is still one session with itself; an observation whose call another session recorded,
 * or a missing event, is never one session with anything.
 */
export function oneSession(session, events) {
  const keys = new Set();
  for (const event of events) {
    if (!event) return false;
    const own = event.childId ?? null;
    const call = event.kind === 'observation' && typeof event.invocation === 'string' ? session.event(event.invocation) : null;
    if (call && (call.childId ?? null) !== own) return false;
    keys.add(own);
  }
  return keys.size <= 1;
}

/**
 * Whose event this is, structurally: the delegated agent it was transferred from (`childId`), or the
 * root (null). An observation must agree with the invocation it answers. Undefined when that cannot
 * be named — a malformed id, or an observation and its invocation that disagree — and then no actor
 * is shared with it.
 */
export function actorKeyOf(session, event) {
  const own = event?.childId ?? null;
  const call = event?.kind === 'observation' && typeof event.invocation === 'string' ? session.event(event.invocation) : null;
  if (call && (call.childId ?? null) !== own) return undefined;
  return own === null || (typeof own === 'string' && own.length > 0) ? own : undefined;
}

/**
 * D102 (owner decision 2026-10-17): the one structural key for "the same place twice": two receipts that cite one
 * event, where one quote holds the other (equal included). The evidence re-ask's merge drops a first-answer statement
 * on it (run-review.js `servedAnswer`), and G2 refuses a re-anchor that names the refuted anchor again
 * (`reanchoredChoices`). The role is not read, and no word is: event ids and string containment only. An empty quote
 * is held by every quote of its event. Pure; false for anything that is not two such receipts.
 */
export function nestedReceipts(a, b) {
  return plainObject(a) && plainObject(b) && typeof a.eventId === 'string' && a.eventId === b.eventId
    && typeof a.quote === 'string' && typeof b.quote === 'string'
    && (a.quote.includes(b.quote) || b.quote.includes(a.quote));
}

/**
 * C-06 "M33 self-corrected claims", every condition, in `RESOLUTION_REJECTIONS` order. `receipts` are
 * the finding's own verified receipts: its commentary receipts are the claim, its observation
 * receipts the contradiction. Returns the two verified resolution receipts, or the first reason; a
 * resolution that passed every code check and whose challenge item was not upheld says so
 * (`codeChecked`), so the review knows it was one it could put to the challengers.
 */
function selfCorrection(session, candidate, receipts) {
  const pair = resolutionShape(candidate.resolvedBy);
  if (!pair) return { ok: false, reason: 'malformed' };
  if (!resolutionRoles(pair)) return { ok: false, reason: 'role_mismatch' };
  // The window's own fact (run-review.js `toCandidates`): a source its request was not shown.
  if (candidate.resolutionSupplied === false) return { ok: false, reason: 'unsupplied' };
  const check = verifyReceipts(session, [pair.observation, pair.statement], { repair: true });
  if (check.rejected.length || check.verified.length !== 2) return { ok: false, reason: 'ungrounded' };
  const [observation, statement] = check.verified;
  const eventOf = (receipt) => session.event(receipt.eventId);
  const claims = receipts.filter((r) => r.role === 'commentary').map(eventOf);
  // D71 (e), (g): the contradiction is the finding's one other receipt — a RESULT, or the recorded evidence it cites.
  const against = receipts.filter((r) => r.role !== 'commentary').map(eventOf);
  const later = [eventOf(observation), eventOf(statement)];
  const sequence = (event) => (Number.isSafeInteger(event?.sequence) ? event.sequence : null);
  const before = [...claims, ...against].map(sequence);
  const [seen, said] = later.map(sequence);
  if (!claims.length || !against.length || [...before, seen, said].some((s) => s === null)
      || !(seen > Math.max(...before) && said > seen)) return { ok: false, reason: 'out_of_order' };
  const actors = [...claims, ...later].map((event) => actorKeyOf(session, event));
  if (actors.includes(undefined) || new Set(actors).size !== 1) return { ok: false, reason: 'cross_actor' };
  // M33 C event binding: a run that failed shows no claimed state — the rule `supportCheck` (claims.js) applies to a
  // support, on the observation's recorded outcome (C-02), never its text. H1: `recordedFailure` — a native or hook
  // status, or a nonzero exit; a failure label with any other source concludes nothing.
  const [rerun] = later;
  if (recordedFailure(rerun)) return { ok: false, reason: 'failed_result' };
  // C-02 `turn` as the adapter recorded it. An event without one is never placed in a turn by
  // guessing from ids, order or instructions.
  const turns = [...claims, ...later].map((event) => (typeof event.turn === 'string' && event.turn ? event.turn : null));
  if (turns.includes(null)) return { ok: false, reason: 'turn_unrecorded' };
  if (new Set(turns).size !== 1) return { ok: false, reason: 'cross_turn' };
  // C-06 refreeze: a human instruction recorded after the claim and before the statement that
  // corrects it means the correction was asked for. The recorded event only — its kind and authority
  // (C-02) — never text, and never a tool result that happens to quote a human.
  const from = Math.min(...claims.map(sequence));
  if ((Array.isArray(session.events) ? session.events : []).some((event) => event?.kind === 'instruction'
      && event.authority === 'human' && Number.isSafeInteger(event.sequence)
      && event.sequence > from && event.sequence < said)) return { ok: false, reason: 'human_prompted' };
  // Every code check passed. C-06 refreeze: the resolution is its own challenge item, and only one
  // that survived it with two grounded support votes publishes. Anything else — refuted, unsettled,
  // never voted on, or no outcome recorded — is that closed reason; `unexecuted` when none is known.
  const outcome = candidate.resolutionChallenge;
  if (outcome !== RESOLUTION_UPHELD) return { ok: false, codeChecked: true,
    reason: RESOLUTION_CHALLENGE_OUTCOMES.includes(outcome) ? outcome : 'unexecuted' };
  return { ok: true, resolvedBy: { observation, statement }, repaired: check.repaired };
}

// Each kind states the evidence that must exist before an accusation is shown. "Missing evidence
// rejects the accusation and marks the affected scope unchecked; no generic fallback finding."
const FINDING_KINDS = Object.freeze({
  edit_under_negative_requirement: {
    requires: ['instruction', 'action'],
    // M33 N: the session-only forbidden-edit route (`forbiddenEdit` on a code-built candidate, run-review.js) cites the
    // violating action by what it wrote (role code on the action's event) or by the command it ran (role action): an
    // entry that is a list is satisfied by any one of its roles. W1 B (owner decision 2026-10-13): and its rule by a
    // human instruction or a project instruction file the main agent was given before the action (`groundFinding`).
    forbiddenEditRequires: [['instruction', PROJECT_INSTRUCTIONS_ROLE], ['action', 'code']],
    // C-06 requires an "applicable EARLIER human prohibition". A rule stated after the work is
    // a reaction to it, not a rule the agent broke — publishing that as a breach accuses
    // someone of disobeying an instruction that did not yet exist.
    earlierInstruction: true,
    // Pinned legacy disclosure policy: disclosed -> FYI, otherwise DECIDE. M33 N: and FYI when code proved the change
    // undone in the same turn (`self_corrected`, the forbidden-edit route only). M33 brittleness M4: "disclosed" is the
    // closed reason code sets (`disclosed`, an upheld `disclosedBy` proposition), never an agent statement among the
    // receipts — those only show what happened. Owner decision 2026-10-06: on both routes alike.
    status: (f) => (DISCLOSURE_REASONS.includes(f.disclosureReason) ? 'FYI' : 'DECIDE'),
  },
  claim_contradicted: {
    requires: ['commentary', 'observation'],
    // D71 (e), (g): a session-only claim whose contradiction is not a RESULT (`contradictionRole` on a code-built candidate,
    // run-review.js `toCandidates`) cites the human's message, an edit's recorded file content or the project's
    // instruction file; which one, and whether it holds, is code's (`contradictionSourceOf`).
    contradictionRequires: ['commentary', Object.values(CONTRADICTION_ROLES)],
    // M36 phase 3 (D68 F, c6): its receipts are one session's (`findingReceiptCheck`: `other_session`).
    sameSession: true,
    // Pinned legacy policy: DECIDE. M33 (C-06): FYI only when code verified the self-correction, or (M33 H) when
    // the statement is a helper's own — a disclosure code set from the recording, never a model field.
    status: (f) => (DISCLOSURE_REASONS.includes(f.disclosureReason) ? 'FYI' : 'DECIDE'),
  },
  code_issue: {
    requires: ['code'],
    status: () => 'DECIDE',
  },
});

export const SUPPORTED_FINDING_KINDS = Object.freeze(Object.keys(FINDING_KINDS));

/**
 * The receipt and role check of a finding of `kind`: the one `groundFinding` applies right after its
 * forbidden-field and kind checks, and (M33 I2) the one a window applies to a contradicted claim's own
 * count (run-review.js `groundedExtras`), so a claim is withheld exactly when its finding's receipts
 * are rejected and never when they publish. `{ ok: true, verified, repaired }`, or the rejection
 * `groundFinding` returns. The unsupported-kind branch serves a direct caller only: `groundFinding`
 * has already returned that rejection itself. Pure; no receipt passed in is changed.
 */
export function findingReceiptCheck(session, kind, receipts, { forbiddenEdit = false, contradiction = false,
  until = null } = {}) {
  const spec = FINDING_KINDS[kind];
  if (!spec) return { ok: false, reason: 'kind_rejected', detail: `unsupported kind ${kind}` };

  // W3-3: each near-miss gets one deterministic repair, and the repaired quote is verified by
  // the same string search as any other. A quote that cannot be snapped is still rejected, and
  // one rejected receipt still withholds the whole accusation.
  const { verified, rejected, repaired } = verifyReceipts(session, receipts ?? [], { repair: true });
  if (rejected.length) return { ok: false, reason: 'receipt_rejected', detail: `${rejected.length} rejected` };

  const roles = new Set(verified.map((r) => r.role));
  // M33 N: the forbidden-edit route's own requirement, where the kind names one; an entry that is a list is met by any
  // one of its roles.
  const requires = forbiddenEdit && spec.forbiddenEditRequires ? spec.forbiddenEditRequires
    : contradiction && spec.contradictionRequires ? spec.contradictionRequires : spec.requires;
  const missing = requires.filter((role) => (Array.isArray(role) ? !role.some((r) => roles.has(r)) : !roles.has(role)))
    .map((role) => (Array.isArray(role) ? role.join(' or ') : role));
  if (missing.length) return { ok: false, reason: 'receipt_rejected', cause: 'role_missing',
    detail: `missing ${missing.join(', ')} receipt` };
  // M36 phase 3 (owner decision D68 F, critique c6): a contradicted claim and the result that contradicts it are one
  // agent's record. A result recorded in another session — a helper's run beside its parent's statement, in a window
  // that holds both or as a failure riding back with the helper's report — was never received by the agent that made the
  // claim, so it never contradicts it (`oneSession`: by the events' recorded lineage).
  if (spec.sameSession && !oneSession(session, verified.map((receipt) => session.event(receipt.eventId))))
    return { ok: false, reason: 'receipt_rejected', cause: 'other_session',
      detail: 'the result was recorded in another session than the statement' };
  // D71 (e), (g): what the contradiction cites, and whether it holds as that source, by structure only.
  if (contradiction && spec.contradictionRequires) {
    const source = contradictionSourceOf(session, verified, { until });
    return source.ok ? { ok: true, verified, repaired, source: source.source } : source;
  }
  return { ok: true, verified, repaired };
}

/**
 * D71 (e), (g): the source a contradicted claim's verified receipts cite (CONTRADICTION_SOURCES), checked by structure
 * only — the receipt's role and event, the recorded order, the event's authority and typed outcome, and which recorded
 * region of an edit holds the quote; never what any of it says. `verified` are the finding's receipts after
 * `verifyReceipts`: its statements (role commentary) and exactly one contradicting receipt. `{ ok: true, source }`, or a
 * withheld rejection (`receipt_rejected` with its WITHHELD_REJECTION_CAUSES cause).
 *   result                role observation: as before (its own checks are the challenge's and `oneSession`'s)
 *   human_message         role instruction: a human message (authority human) recorded before every statement
 *   file_content          role code: the quote lies in the context or removed lines the recorder recorded for an edit
 *                         (its hunk runs of those sides, or the text an edit replaced), the edit recorded before every
 *                         statement and ran to a recorded success (FILE_CONTENT_OUTCOMES) by the results recorded at or
 *                         before `until` (D59: the window's end; S5 review M1). S6 rejected S5 review L1 (no rule on a
 *                         later write to the same file): a removed line is by construction no longer in the file once
 *                         the cited edit ran, so a later write adds no structural fact; whether the words speak of the
 *                         file before or after is meaning, the challenge's (S6)
 *   project_instructions  role project-instructions: a project instruction file the harness gave the agent, recorded
 *                         before every statement (its `afterSequence` is below the earliest statement's sequence); and
 *                         (the fourth review of the code step) the person's words (`personsProjectFile`: given to the
 *                         main agent, written by no typed change of the session; else `source_not_human`)
 * S6 (S5 review L2): the quote of a source other than a result is at most EVIDENCE_QUOTE_MAX characters (a project rule); a
 * longer one is withheld like a quote that does not match (`receipt_rejected`, no cause).
 */
export function contradictionSourceOf(session, verified, { until = null } = {}) {
  const rejected = (cause, detail) => ({ ok: false, reason: 'receipt_rejected', cause, detail });
  const list = Array.isArray(verified) ? verified : [];
  const statements = list.filter((r) => r?.role === 'commentary').map((r) => session.event(r.eventId));
  const against = list.filter((r) => r?.role !== 'commentary');
  const role = against.length === 1 ? against[0].role : undefined;
  let source = CONTRADICTION_SOURCES.find((name) => CONTRADICTION_ROLES[name] === role);
  if (!statements.length || statements.some((event) => !Number.isSafeInteger(event?.sequence)) || source === undefined)
    return rejected('role_missing', 'one statement and one contradicting receipt of a contradiction role');
  if (source === 'result') return { ok: true, source };
  const [receipt] = against;
  if (typeof receipt.quote !== 'string' || receipt.quote.length > EVIDENCE_QUOTE_MAX)
    return { ok: false, reason: 'receipt_rejected', detail: `quote over ${EVIDENCE_QUOTE_MAX} characters` };
  const event = session.event(receipt.eventId);
  const said = Math.min(...statements.map((statement) => statement.sequence));
  const at = source === 'project_instructions' ? event?.afterSequence : event?.sequence;
  if (!Number.isSafeInteger(at) || !(at < said)) return rejected('source_not_before', 'not recorded before the statement');
  if (source === 'human_message' && !(event.kind === 'instruction' && event.authority === 'human'))
    return rejected('source_not_human', 'the message is not the human\'s');
  // The fourth review of the code step: a project instruction file the session wrote, or one given to a helper, is not
  // the person's words, so it is never labelled the project's instruction file against a claim.
  if (source === 'project_instructions' && !(event?.kind === PROJECT_INSTRUCTIONS_ROLE && personsProjectFile(session, event)))
    return rejected('source_not_human', 'the project instruction file is not the person\'s words');
  // W2 (owner decision 2026-10-13): code is decided by the region that holds the quote — the removed or context lines of
  // an edit that ran (file_content, as before), else the text the statement's own actor's edit or write added
  // (own_written, `ownWrittenCheck`).
  if (source === 'file_content' && !(event.kind === 'invocation'
      && FILE_CONTENT_OUTCOMES.includes(actionOutcome(session, event, { until }).class)
      && fileContentSpans(session, event).some((span) => span.includes(receipt.quote)))) {
    const own = ownWrittenCheck(session, receipt, statements, { said, until });
    if (own === SOURCE_REWRITTEN_CAUSE)
      return rejected(own, 'a later change to the same path was recorded before the statement');
    if (own !== null)
      return rejected(SOURCE_NOT_FILE_CONTENT_CAUSE, 'not in the removed or context lines of an edit that ran, nor in '
        + 'the text the statement\'s own edit or write added');
    source = OWN_WRITTEN_SOURCE;
  }
  return { ok: true, source };
}

/**
 * W2 (owner decision 2026-10-13; root cause 1): does a code receipt quote the text its
 * statements' own actor's edit or write added, as that file still held it when the first statement was recorded? By
 * structure only — the cited event, the region of it that holds the quote, its actor, its typed outcome and the recorded
 * order; never what any of it says. Null when it does; otherwise `source_not_file_content` (it is no write, the quote is
 * not in what it added, it is another actor's, it did not run to a recorded success, or it is not recorded before `said`)
 * or `source_rewritten` (a later non-failed change to a path whose written body holds the quote was recorded between the
 * write and `said`: `samePathChangedBetween`). `statements` are the statement events (a claim's words, or a written
 * statement's write); `said` the sequence of the first, `until` the window's end (D59).
 */
export function ownWrittenCheck(session, receipt, statements, { said, until = null }) {
  const write = writeActionOf(session, receipt?.eventId);
  if (!write || typeof receipt.quote !== 'string' || !receipt.quote) return SOURCE_NOT_FILE_CONTENT_CAUSE;
  const holding = ownWrittenChanges(session, write, receipt.quote);
  if (holding === null) return SOURCE_NOT_FILE_CONTENT_CAUSE;
  const actor = actorKeyOf(session, write);
  if (actor === undefined || !statements.length || statements.some((event) => actorKeyOf(session, event) !== actor))
    return SOURCE_NOT_FILE_CONTENT_CAUSE;
  if (!FILE_CONTENT_OUTCOMES.includes(actionOutcome(session, write, { until }).class)) return SOURCE_NOT_FILE_CONTENT_CAUSE;
  if (!Number.isSafeInteger(write.sequence) || !Number.isSafeInteger(said) || !(write.sequence < said))
    return SOURCE_NOT_FILE_CONTENT_CAUSE;
  const paths = holding.map((change) => change?.path);
  return samePathChangedBetween(session, write, paths, said) ? SOURCE_REWRITTEN_CAUSE : null;
}

/**
 * W2 (owner decision 2026-10-13): which code source a contradiction's code receipt names, by the recorded region that
 * holds its quote alone: `file_content` when a removed or context line of the cited edit holds it (as before), else
 * `own_written` when the text the cited edit or write added holds it, else `file_content` (the source the receipt
 * always named; its own checks then refuse it). For the words a candidate is shown and titled with before its checks
 * run (`contradictionSourceOf` decides whether it holds). Structure and verbatim search only; never throws.
 */
export function codeContradictionSource(session, receipt) {
  try {
    const event = typeof receipt?.eventId === 'string' ? session.event(receipt.eventId) : null;
    if (!event || typeof receipt.quote !== 'string' || !receipt.quote) return FILE_CONTENT_SOURCE;
    if (fileContentSpans(session, event).some((span) => span.includes(receipt.quote))) return FILE_CONTENT_SOURCE;
    const write = writeActionOf(session, receipt.eventId);
    return write && ownWrittenChanges(session, write, receipt.quote) !== null ? OWN_WRITTEN_SOURCE : FILE_CONTENT_SOURCE;
  } catch { return FILE_CONTENT_SOURCE; }
}

/** W2: the changes of a write whose added text holds `quote` — a change whose written body (`after`) holds it, or, when
 *  only the call's recorded added hunk lines (`hunkRunsOf`, side added) hold it, every change of the call — or null when
 *  none does. A quote found only in removed or context lines is no added text. Structure and verbatim search only. */
function ownWrittenChanges(session, write, quote) {
  const changes = write.changes.filter((change) => plainObject(change));
  const bodies = changes.filter((change) => session.textSpansOf(change, 'after').some((span) => span.includes(quote)));
  if (bodies.length) return bodies;
  let runs = null;
  try { runs = session.hunkRunsOf(write); } catch { runs = null; }
  const added = (Array.isArray(runs) ? runs : []).some((run) => run?.side === 'added'
    && (Array.isArray(run.spans) ? run.spans : []).some((span) => span.includes(quote)));
  return added && changes.length ? changes : null;
}

/**
 * W2 (owner decision 2026-10-13): was a change to one of `paths` recorded after `write` and before the sequence `before`,
 * by any action whose typed `changes` name it, that could have changed it (D98, F9: the one effect rule,
 * `CHANGING_EFFECTS`: not refused before it ran, failed or cancelled)? Typed
 * changes only: a command the slicer parsed no write from is not read. Precision over recall: a path that is not a
 * string, a change whose path is not one, or such an action whose place in the order code cannot read, counts as one.
 * Shared by the `own_written` contradiction source (`ownWrittenCheck`) and an own write's support (claims.js).
 */
export function samePathChangedBetween(session, write, paths, before) {
  if (!Array.isArray(paths) || !paths.length || paths.some((path) => typeof path !== 'string')) return true;
  const named = new Set(paths);
  const effect = effectReader(session);
  return (Array.isArray(session?.events) ? session.events : []).some((event) => {
    if (event === write || event?.kind !== 'invocation' || !Array.isArray(event.changes)) return false;
    if (!event.changes.some((change) => !plainObject(change) || typeof change.path !== 'string' || named.has(change.path)))
      return false;
    if (!Number.isSafeInteger(event.sequence)) return true;
    if (event.sequence <= write.sequence || event.sequence >= before) return false;
    return CHANGING_EFFECTS.includes(effect(event));
  });
}

/** C-02 operations that put a body into a file: a create is `write`; a delete writes none. */
const BODY_WRITE_OPERATIONS = Object.freeze(['write', 'edit']);
/** The agent's own action that wrote a body into a file — an invocation whose operation writes one —
 *  or null. A delete, a command, a read, any other event and no event are not. (Moved here from written.js, which
 *  re-exports it, by W2: the `own_written` contradiction source reads it too.) */
export function writeActionOf(session, eventId) {
  const event = typeof eventId === 'string' && typeof session?.event === 'function' ? session.event(eventId) : null;
  return event?.kind === 'invocation' && BODY_WRITE_OPERATIONS.includes(event.operation) && Array.isArray(event.changes)
    ? event : null;
}


/** D71 (e): the recorded file content an edit carries — each context or removed run of its recorded hunks
 *  (session.js `hunkRunsOf`) and each text it replaced (a change's `replaced`) — as spans. Never its added lines. */
export function fileContentSpans(session, event) {
  const spans = [];
  let runs = null;
  try { runs = session.hunkRunsOf(event); } catch { runs = null; }
  for (const run of Array.isArray(runs) ? runs : [])
    if (run?.side === 'context' || run?.side === 'removed') spans.push(...(Array.isArray(run.spans) ? run.spans : []));
  for (const change of Array.isArray(event?.changes) ? event.changes : [])
    if (Array.isArray(change?.replaced)) spans.push(...session.textSpansOf(change, 'replaced'));
  return spans;
}

/**
 * M33 N: the forbidden-edit route's own fields of a code-built candidate (run-review.js), or null for any other
 * candidate. Only an `edit_under_negative_requirement` candidate carrying a plain `forbiddenEdit` object is one — the
 * combined route's joint answer can carry no such member (code-review.js admits exactly its seven fields).
 */
const forbiddenRouteOf = (candidate) => (candidate?.kind === 'edit_under_negative_requirement'
  && plainObject(candidate.forbiddenEdit) ? candidate.forbiddenEdit : null);

export function groundFinding({ repo, session, pr, candidate, upTo = null }) {
  const forbidden = carriesForbiddenField(candidate);
  if (forbidden) return { ok: false, reason: 'kind_rejected', detail: `model supplied ${forbidden}` };

  const spec = FINDING_KINDS[candidate.kind];
  if (!spec) return { ok: false, reason: 'kind_rejected', detail: `unsupported kind ${candidate.kind}` };

  const route = forbiddenRouteOf(candidate);
  // D71 (e), (g): a session-only claim's contradiction that is not a RESULT (`contradictionRole`, set by `toCandidates`).
  const contradiction = candidate.kind === 'claim_contradicted' && typeof candidate.contradictionRole === 'string';
  const receiptCheck = findingReceiptCheck(session, candidate.kind, candidate.receipts, { forbiddenEdit: route !== null,
    contradiction, until: upTo });
  if (!receiptCheck.ok) return receiptCheck;
  const { verified, repaired } = receiptCheck;

  // An instruction cited as the broken rule must be human, and must predate every cited action. M33 N: the route's
  // violation quoting what an action wrote (role code on its event) is that action. W1 B (owner decision 2026-10-13; D83
  // (2) carried into step 5): on the forbidden-edit route the rule may be a project instruction file, the person's words
  // written for the agent, published only when it is one the window showed the main agent before every cited action
  // (`projectFilesBefore`, the set a decision's covering receipt may cite); else, like a rule given after the action,
  // it is withheld (`rule_after_action`). The fourth review of the code step: and only when it is the person's words.
  const files = route !== null ? verified.filter((r) => r.role === PROJECT_INSTRUCTIONS_ROLE) : [];
  if (spec.earlierInstruction && files.length) {
    // The fourth review of the code step: a file the session wrote, or one given to a helper, is not the person's words
    // (`personsProjectFile`): withheld as a prohibition that is not a human instruction.
    if (!files.every((file) => personsProjectFile(session, session.event(file.eventId))))
      return { ok: false, reason: 'ambiguous_authority', detail: 'the project instruction file is not the person\'s words' };
    const actions = verified.filter((r) => r.role === 'action' || r.role === 'code').map((r) => session.event(r.eventId));
    const listed = new Set(projectFilesBefore(session, actions, upTo).map((file) => file.eventId));
    if (!actions.length || !files.every((file) => listed.has(file.eventId)))
      return { ok: false, reason: 'receipt_rejected', cause: 'rule_after_action',
        detail: 'the project instruction file was not given to the main agent before the action' };
  } else if (spec.earlierInstruction) {
    const instructions = verified.filter((r) => r.role === 'instruction').map((r) => session.event(r.eventId));
    const actions = verified.filter((r) => r.role === 'action' || (route !== null && r.role === 'code'))
      .map((r) => session.event(r.eventId));
    if (!instructions.some((i) => i.authority === 'human'))
      return { ok: false, reason: 'ambiguous_authority', detail: 'prohibition is not a human instruction' };
    const earliestAction = Math.min(...actions.map((a) => a.sequence ?? Infinity));
    if (!instructions.some((i) => i.authority === 'human' && (i.sequence ?? Infinity) < earliestAction))
      return { ok: false, reason: 'receipt_rejected', cause: 'rule_after_action', detail: 'prohibition post-dates the action' };
  }

  // C-10: "Never invent inline anchors for session-only concerns." An anchor is a claim that
  // this line of THIS PR is the problem, so it must name a file the PR actually contains.
  const anchor = candidate.anchor ?? null;
  const scope = candidate.scope ?? 'session-effect';
  let anchorOk = anchor == null;
  if (anchor != null) {
    const validShape = typeof anchor.path === 'string'
      && ['LEFT', 'RIGHT'].includes(anchor.side)
      && Number.isSafeInteger(anchor.startLine) && Number.isSafeInteger(anchor.endLine)
      && anchor.startLine > 0 && anchor.endLine >= anchor.startLine;
    const inPr = Boolean(pr?.files?.some((f) => f.path === anchor.path));
    anchorOk = validShape && inPr && scope === 'current-code';
  }
  // A bad anchor drops to an unanchored finding rather than rejecting the whole item: the
  // evidence may still be real, but its claimed location is not verified.
  const safeAnchor = anchorOk ? anchor : null;
  if (scope === 'current-code' && anchor != null && !anchorOk)
    return { ok: false, reason: 'relevance_unchecked', detail: 'anchor is not in this PR' };

  const finding = {
    origin: candidate.origin ?? 'session-review',
    kind: candidate.kind,
    title: candidate.title,
    explanation: candidate.explanation,
    receipts: verified,
    scope,
    anchor: safeAnchor,
    // D71 (e), (g): what contradicts the claim, when it is not a RESULT — code's word from the verified receipt, so every
    // other finding keeps its bytes.
    ...(receiptCheck.source && receiptCheck.source !== 'result' ? { contradictionSource: receiptCheck.source } : {}),
  };
  // M33 (C-06): a supplied resolution is judged only here, and only for a contradiction that already
  // grounded. A resolution that fails any condition changes nothing about the finding — not its
  // status, its receipts or its identity — and its reason is returned to be counted. It never
  // throws the finding away: any error inside the check is a malformed resolution, never a rejection.
  // C-06 refreeze: passing every code check is not enough; its own challenge item must be upheld.
  let resolution = null;
  if (candidate.kind === 'claim_contradicted' && candidate.resolvedBy != null) {
    try { resolution = selfCorrection(session, candidate, verified); }
    catch { resolution = { ok: false, reason: 'malformed' }; }
  }
  // M33 H (C-06 "M33 helper-internal claims"): a contradicted statement that is a helper's own — read from the
  // recording's actor of its verified stated events (`helperStatement`) — publishes FYI `helper_internal`. Its
  // verified resolution, if any, is kept beside it (and counted as verified exactly as before). The parent's own
  // statement is never one, so a parent relaying the claim is its own finding, DECIDE by the rule above.
  const helper = candidate.kind === 'claim_contradicted' && helperStatement(session, verified);
  // M33 N (C-06 "M33 forbidden edits"): the route's own fields, each verified again here by strict string search —
  // `breach` from the violation receipt's verified role; and `revertedBy`, the action code proved undid the change in
  // the same turn (forbidden.js `forbiddenRevert`), which makes it FYI `self_corrected` (unchanged by M33 brittleness M4).
  const routeFields = route === null ? null : forbiddenRouteFields(session, route, verified);
  // M33 brittleness M4: a proposed disclosure of an edit (`disclosedBy`: the combined route's joint finding's, and —
  // owner decision 2026-10-06 — the session-only route's edit's `reportedBy`) is judged only here, once the finding
  // grounded, by the one check of both routes; one that fails any condition changes nothing about the finding and its
  // reason is returned. A code-proved undoing comes first (`self_corrected`), as before.
  const disclosed = candidate.disclosedBy != null ? editDisclosure(session, candidate, verified) : null;
  const disclosure = helper ? HELPER_INTERNAL : resolution?.ok || routeFields?.revertedBy ? SELF_CORRECTED
    : disclosed?.ok ? DISCLOSED : null;
  if (disclosure !== null) Object.assign(finding, { disclosureReason: disclosure,
    ...(resolution?.ok ? { resolvedBy: resolution.resolvedBy } : {}),
    ...(disclosure === DISCLOSED ? { disclosedBy: disclosed.disclosedBy } : {}) });
  if (routeFields !== null) Object.assign(finding, routeFields);
  finding.status = spec.status(finding);   // code policy, never a model field
  // C-06 identity: repo, origin, kind, scope, receipts, anchor. The disclosure and its resolution
  // receipts are not the accusation, so one contradiction keeps one identity whatever its status.
  finding.id = findingIdentity(repo, finding);
  return { ok: true, finding, receiptsRepaired: repaired + (resolution?.ok ? resolution.repaired : 0),
    ...(resolution ? { resolution: resolution.ok ? SELF_CORRECTED : resolution.reason,
      resolutionCodeChecked: resolution.ok || resolution.codeChecked === true } : {}),
    ...(disclosed ? { disclosure: disclosed.ok ? DISCLOSED : disclosed.reason,
      disclosureCodeChecked: disclosed.ok || disclosed.codeChecked === true } : {}) };
}

/**
 * M33 N: the published fields of a forbidden-edit route finding, from its verified receipts and the route's code-built
 * receipts: `breach` (FORBIDDEN_EDIT_BREACHES) from the violation receipt's verified role and its action's recorded
 * change (`forbiddenBreachOf`); `revertedBy` when it grounds strictly as an action receipt of an event recorded after the
 * violation. A receipt that does not ground is left out: the row then reads as without it (never FYI on a revert code
 * cannot verify again). M33 brittleness M4 session route: no `reportedBy` — the agent's statement is the finding's
 * proposed disclosure (`disclosedBy`), published only when upheld, as on the combined route. Pure; never throws.
 */
function forbiddenRouteFields(session, route, verified) {
  const out = {};
  try {
    const violation = verified.find((r) => r.role === 'code') ?? verified.find((r) => r.role === 'action');
    const breach = violation ? forbiddenBreachOf(session, session.event(violation.eventId), violation) : null;
    if (breach !== null) out.breach = breach;
    const strict = (receipt, role) => {
      if (!plainObject(receipt) || receipt.role !== role) return null;
      const check = verifyReceipt(session, receipt);
      return check.ok ? withoutRepairFields(check.receipt) : null;
    };
    const reverted = strict(route.revertedBy, 'action');
    const after = (receipt) => session.event(receipt.eventId)?.sequence;
    if (reverted && violation && Number.isSafeInteger(after(reverted)) && Number.isSafeInteger(after(violation))
        && after(reverted) > after(violation)) out.revertedBy = reverted;
  } catch { return out; }
  return out;
}

/** Occurrences of `quote` in `text`, overlapping ones counted. */
function occurrencesOf(text, quote) {
  let n = 0;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) n++;
  return n;
}

/**
 * M33 brittleness M3: what a forbidden edit's verified violation receipt is (FORBIDDEN_EDIT_BREACHES), from its role and
 * its action's recorded change alone, or null: role action on a command is `ran`; role code on a write or edit is
 * `wrote` when, on some path, the quote occurs more often in what the action wrote than in the text it replaced, else
 * `removed` when it occurs fewer times on a path whose every
 * recorded before side is the text its change replaced (`replacedSideComparable`; a write's change with none recorded
 * replaced nothing). The forbidden-edit route checked this with its fail-closed rules before it was asked (forbidden.js
 * `breachOf`); this names the same kind again for the published row, so its words follow the recording, never a
 * candidate field. Pure; never throws.
 */
export function forbiddenBreachOf(session, action, receipt) {
  try {
    const [WROTE, RAN, REMOVED] = FORBIDDEN_EDIT_BREACHES;
    if (action?.kind !== 'invocation' || typeof receipt?.quote !== 'string' || !receipt.quote) return null;
    const changes = (Array.isArray(action.changes) ? action.changes : []).filter(plainObject);
    if (receipt.role === 'action') return action.operation === 'command' ? RAN : null;
    if (receipt.role !== 'code' || !['write', 'edit'].includes(action.operation)) return null;
    const count = (change, side) => session.textSpansOf(change, side).reduce((n, text) => n + occurrencesOf(text, receipt.quote), 0);
    // M33 brittleness M3 review: a before side that is not the text its change replaced compares nothing for a removal.
    const comparable = (change) => (session.textSpansOf(change, 'before').length || plainObject(change.beforeExtent)
      ? replacedSideComparable(action.operation, change) : action.operation === 'write');
    const sides = [...new Set(changes.map((change) => change.path))].map((path) => changes.filter((c) => c.path === path)
      .reduce(([written, kept, whole], change) => [written + count(change, 'after'), kept + count(change, 'before'),
        whole && comparable(change)], [0, 0, true]));
    return sides.some(([written, kept]) => written > kept) ? WROTE
      : sides.some(([written, kept, whole]) => whole && written < kept) ? REMOVED : null;
  } catch { return null; }
}

/**
 * C-06 refreeze: may this contradiction's proposed resolution be shown to the challengers, as its own
 * item? Only when the contradiction itself grounds as a finding and the resolution has already passed
 * every code check — shape, roles, supplied, grounded, order, actor, a run that did not fail (M33 C event
 * binding), turn and no human instruction between — exactly as `groundFinding` will apply them after the
 * challenge. Whatever outcome the candidate already carries is ignored: this asks about the code checks alone.
 * Never throws.
 */
export function resolutionChallengeable({ repo, session, pr = null, candidate }) {
  if (!plainObject(candidate) || candidate.kind !== 'claim_contradicted' || candidate.resolvedBy == null) return false;
  const { resolutionChallenge: _outcome, ...unchallenged } = candidate;
  try {
    const result = groundFinding({ repo, session, pr, candidate: unchallenged });
    return result.ok === true && result.resolutionCodeChecked === true;
  } catch { return false; }
}

// ---- one finding per defect (W3-6) ------------------------------------------------------

/**
 * Do two findings describe the same defect?
 *
 * STRUCTURE ONLY — anchor, receipts, kind, origin. Never title or explanation similarity: two
 * genuinely different problems in one file are often phrased alike, and a merge on wording
 * would delete one of them with no trace. Every test here is a fact about where the evidence
 * points, so a merge is checkable by the same standard as the findings themselves.
 */
function sameDefect(a, b, occursOnce) {
  // A code review and a session review are two capabilities making two claims. Merging across
  // them would let one capability's coverage stand in for the other's.
  if (a.origin !== b.origin || a.kind !== b.kind) return false;

  if (a.anchor && b.anchor) {
    if (a.anchor.path !== b.anchor.path) return false;   // never across files
    // F93: line 40 on the LEFT is the base file's line 40, a different line of different text
    // from line 40 on the RIGHT. Side is part of where a finding points, so it is identity.
    if (a.anchor.side !== b.anchor.side) return false;
    // F94: one defect framed from different lines of one function is still one defect when the
    // framings cite the same code. The evidence is the key, never the wording.
    if (sharesCodeReceipt(a, b, occursOnce)) return true;
    const lines = [a.anchor.startLine, a.anchor.endLine, b.anchor.startLine, b.anchor.endLine];
    // A range that is not a range establishes no overlap, so it establishes no duplicate.
    if (!lines.every((n) => Number.isSafeInteger(n))) return false;
    return a.anchor.startLine <= b.anchor.endLine && b.anchor.startLine <= a.anchor.endLine;
  }
  // One claims a line in the diff and the other does not. Those are different claims.
  if (a.anchor || b.anchor) return false;

  // A session finding has no line to overlap, so what makes it the same defect is that it rests
  // on exactly the same events. A superset is a different reading of a wider span of session.
  const ids = (f) => [...new Set((f.receipts ?? []).map((r) => r.eventId))].sort();
  const left = ids(a), right = ids(b);
  return left.length > 0 && left.length === right.length && left.every((id, i) => id === right[i]);
}

/**
 * F94's second key: do two anchored findings cite one identical CODE receipt — the same event and
 * the same exact quote? Only a `code` receipt counts, because only code locates a defect. An
 * instruction quote locates the RULE (two edits under one prohibition cite the same one), and an
 * action quote of a path is shared by every finding in that file; merging on either would delete
 * a second, distinct place with no trace. Exact string equality, no normalisation: a receipt is
 * already an exact substring of its source, so two that differ by a character are two quotes.
 *
 * And the shared quote must locate ONE place (W3c-3's F94 risk; L5):
 * `return null;` sits in every guard clause of a file, so two defects in two functions can cite it
 * without being one, and a merge on it deletes the second with no trace. A shared quote counts
 * only when it occurs exactly once in the cited recorded source — every code span of that event
 * (`occursOnce`). That is structure, in every language: the keyword list of "bare" lines and the
 * 24-character threshold that decided it before (BARE_CODE_LINE: `nil`, `Ok(())`, `END;` passed it)
 * are deleted. A source this merge cannot read proves no quote distinctive, so it merges nothing
 * on a receipt (the line-overlap key still applies).
 * The count is one total over every span, an edit's two sides included (review F2): a path's first edit records the
 * whole file as its prior state and only the written segment after it, so a line the write kept and a line it added
 * beside an identical old one record the same counts, and the second is two places; two changes of one event are two
 * places too. Counting each side apart would merge both.
 */
function sharesCodeReceipt(a, b, occursOnce) {
  const code = (f) => (Array.isArray(f.receipts) ? f.receipts : []).filter((r) => r && r.role === 'code'
    && typeof r.eventId === 'string' && typeof r.quote === 'string' && r.quote !== '');
  const theirs = code(b);
  return code(a).some((r) => theirs.some((s) => s.eventId === r.eventId && s.quote === r.quote)
    && occursOnce(r.eventId, r.quote));
}

/**
 * The recorded code an event's `code` receipts may cite: every code source span of that event in `source` (a Session,
 * or a code review's source facade), or null when the source is absent or holds no such event.
 */
export function codeSourceTexts(source, eventId) {
  if (!source || typeof source.event !== 'function' || typeof source.sourcesFor !== 'function') return null;
  const event = source.event(eventId);
  if (!event) return null;
  // M36 phase 2: a call's recorded hunk runs (session.js `hunkRunsOf`) show the same change its bodies hold; counted
  // once, as the bodies, so a quote of what it wrote still occurs once. A window's view (`shownSession`) lists only what
  // the window showed, and is counted as shown.
  if (typeof source.sourceGroupsFor === 'function')
    return source.sourceGroupsFor(event).filter((group) => group?.role === 'code' && group.hunk !== true)
      .flatMap((group) => (Array.isArray(group.spans) && group.spans.length ? group.spans : ['']))
      .filter((text) => typeof text === 'string');
  return source.sourcesFor(event).filter((s) => s?.role === 'code' && typeof s.text === 'string').map((s) => s.text);
}

/** Does `quote` occur exactly once across `texts`, overlapping occurrences counted? False for no texts. */
function exactlyOnce(texts, quote) {
  if (!Array.isArray(texts)) return false;
  let n = 0;
  for (const text of texts)
    for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) if (++n > 1) return false;
  return n === 1;
}

// DECIDE outranks FYI. Used only to stop a merge SOFTENING a verdict; nothing here ever raises
// one, and no model supplies either value.
const STATUS_RANK = Object.freeze({ DECIDE: 0, FYI: 1 });

/**
 * Collapse findings that describe one defect into one row (W3-6).
 *
 * The same defect arrived twice in two framings in every review run so far — a reader had no way
 * to tell that from two defects. The survivor is the framing with MORE receipts (more evidence
 * is more of the thing a reader came for); the other's title rides along as `alsoReportedAs` so
 * the second framing is visible rather than deleted, and the count is published so a silent
 * disappearance is impossible.
 *
 * `sourcesOf(eventId)` gives the recorded code a code receipt's event holds (`codeSourceTexts`), or null; without it no
 * shared receipt is distinctive. Returns { findings, merged } and mutates nothing it was given.
 */
export function mergeDuplicateFindings(findings = [], { sourcesOf = null } = {}) {
  const kept = [];
  let merged = 0;
  const once = new Map();
  const occursOnce = (eventId, quote) => {
    const key = JSON.stringify([eventId, quote]);
    if (!once.has(key)) once.set(key, exactlyOnce(typeof sourcesOf === 'function' ? sourcesOf(eventId) : null, quote));
    return once.get(key);
  };
  for (const finding of findings) {
    const index = kept.findIndex((k) => sameDefect(k, finding, occursOnce));
    if (index < 0) { kept.push(finding); continue; }
    merged++;
    const incumbent = kept[index];
    const [survivor, absorbed] = (finding.receipts?.length ?? 0) > (incumbent.receipts?.length ?? 0)
      ? [finding, incumbent] : [incumbent, finding];
    const titles = [...(survivor.alsoReportedAs ?? []), absorbed.title, ...(absorbed.alsoReportedAs ?? [])]
      .filter((t) => typeof t === 'string' && t.trim() && t !== survivor.title);
    const row = {
      ...survivor,
      alsoReportedAs: [...new Set(titles)],
      // A merge reorganises the report; it must never clear a decision. If either framing was
      // DECIDE, the one finding that replaces both is DECIDE.
      status: (STATUS_RANK[absorbed.status] ?? Infinity) < (STATUS_RANK[survivor.status] ?? Infinity)
        ? absorbed.status : survivor.status,
    };
    // M33 (C-06): a disclosure is the reason for an FYI. A row the merge keeps DECIDE carries none,
    // so it is never shown as corrected while it asks for a decision.
    // M33 N: and a forbidden edit's verified undoing is the reason for its FYI, so it goes with it. M33 brittleness M4
    // session route: so does an edit's upheld disclosure (`disclosedBy`), on either route.
    if (row.status !== 'FYI') {
      delete row.disclosureReason; delete row.resolvedBy; delete row.revertedBy; delete row.disclosedBy;
    }
    kept[index] = row;
  }
  return { findings: kept, merged };
}

// ---- D87: the code pass (owner decisions 2026-10-13/14; code-pass.js) -----------------------------------------------

/**
 * D87: what the code step published on a row of the session review, in its own `codeCheck` — beside the row's status,
 * never in it: no promise, requirement or decision status is read from or written by it, and no attention count is
 * lowered by it. Closed.
 *   contradicted-by-code  the code at review time shows what the row states is not so. The agentic code step: a
 *                         published `claim_false` finding keyed to the row (`by: 'finding'`), the only code check it
 *                         sets
 *   not-checked-in-code   the check did not settle it either way: its `reason` (CODE_CHECK_REASONS) says why. Written
 *                         only by the code step before code-pass/7; a reader shows nothing for it
 * (`shown-in-code`, the code at review time showing what the row states, went with code-pass/9: a statement the review
 * agent traced and found to hold no longer marks a row, and a reader shows nothing for an earlier report's.)
 */
export const CODE_CHECK_OUTCOMES = Object.freeze(['contradicted-by-code', 'not-checked-in-code']);
/**
 * D87: why a row read not-checked-in-code before code-pass/7 (step 1, retired by the agentic code step). Kept so a
 * reader can still read a report written then; the code step writes none of them. Closed.
 *   file_not_shown              a receipt or an anchor names a file the pass did not show, or no file was shown
 *   quote_ungrounded            a quote is not word for word in its frozen file after the one repair, or is shorter than
 *                               MIN_QUOTE_CHARS or longer than EVIDENCE_QUOTE_MAX characters
 *   anchor_off_quote            the lines an answer or a finding names are no lines of the file, or no occurrence of its
 *                               quote lies on them
 *   file_changed_since_session  a file the row's events named, or the answer cites, no longer holds what the session
 *                               last wrote to it, so the file is not the session's
 *   request_bound               the request was over the review's request bound, so it was never sent
 *   no_answer                   the reviewer gave no usable answer for the row
 *   challenge_refuted           the checking passes refuted the answer (a majority of definite votes)
 *   challenge_unsettled         every pass voted and they did not all uphold it (the run is unanimous)
 *   challenge_unexecuted        a pass never voted on it
 *   cannot_tell                 the reviewer answered that the shown code cannot settle the row
 */
export const CODE_CHECK_REASONS = Object.freeze(['file_not_shown', 'quote_ungrounded', 'anchor_off_quote',
  'file_changed_since_session', 'request_bound', 'no_answer', 'challenge_refuted', 'challenge_unsettled',
  'challenge_unexecuted', 'cannot_tell']);
/**
 * D87, as the agentic code step reads it (code-snapshot/9, D90: nothing is withheld for privacy's sake, so a harness
 * home, a credential-shaped path and the home folder as the repository are no states any more): the closed state of
 * each path of the change under review (the paths a recorded write, edit or delete changed, then the paths git shows
 * differing from the session's start commit) — the review agent's starting map, never its limit: it may read any file
 * of the repository itself.
 *   shown                  its hunks are in the review request's change block
 *   binary                 holds a NUL byte, or is not UTF-8; or git reports it binary: its diff from the start commit has
 *                          no text hunk though its text changed (a `binary` or `-diff` attribute, git's "Binary files …
 *                          differ"), so no line of it is in the change block
 *   oversize               the file, or its side at the start commit, is over the review's request bound on its own: its
 *                          hunks are not in the change block (D109: a file whose hunks the request left out for room is
 *                          `left_out`, never this); since D109's review also a file whose hunks alone are over what the
 *                          change block's cap leaves beside its table of contents (the manifest's `alone`): no request
 *                          can show them
 *   changed_since_session  a fact: its last recorded successful write is no longer literally in it (it changed after
 *                          the session's last recorded edit, so its lines now may not all be the agent's). Since
 *                          code-snapshot/10 its hunks are in the change block like any changed file's, the footer says
 *                          so, and its coverage is not lowered; unless the footer names it as withheld: the session
 *                          deleted it and it is there again, and its hunks are not shown
 *   deleted                not there at review time (a deleted path of the diff shows its removed lines)
 *   outside_root           a recorded write outside the working directory: not part of the change block. One that still
 *                          lies in the repository's top folder is a part of its change the review did not cover (named
 *                          in the footer as withheld; coverage partial); one outside every folder the review can read
 *                          (the working directory and the repository's top folder) is only counted
 *   unreadable             could not be read as a regular file, or its diff could not be read consistently (fail closed)
 *   left_out               (D109) its hunks fit within the review's bound on their own, but the request left them out for
 *                          room: the request manifest's entry says which bound (CODE_LEFT_OUT_REASONS)
 *   other_repository       (D109, code-snapshot/12) a recorded write that lies in a folder the review can read, in a git
 *                          repository other than the review's own (a repository nested in the working directory, or
 *                          one where the working directory has none): not part of the change block, and a part of the
 *                          change the review did not cover
 *   outside_writer_root    (D109, code-snapshot/12) a recorded write under the working directory, in its repository (or
 *                          in none, as the working directory), that the recording marks outside the working directory of
 *                          the agent that wrote it (the slicer's write scope: a helper that worked in another folder; a
 *                          harness home folder is never one): not part of the change block, and a part of the change the
 *                          review did not cover
 * Its declarations are the gaps `code_unreviewable` and `source_changed` on the `code` channel with scope `repository`
 * — kept in the code pass's own record, never among the report's gaps, so no session coverage reads them. From D109
 * `code_unreviewable` counts the files of the change the code review did not see (code-pass.js `codeChangeTally`, the
 * one tally of the request manifest and the reading record every coverage line reads), by their state.
 */
export const CODE_FILE_STATES = Object.freeze(['shown', 'binary', 'oversize', 'changed_since_session', 'deleted',
  'outside_root', 'unreadable', 'left_out', 'other_repository', 'outside_writer_root']);
// ---- the code step (code-pass/2; agentic since code-pass/7): closed vocabularies ---------------------------------

/**
 * Where the code step's diff starts. Closed.
 *   git             the session's start commit, read with git (cli/src/code-snapshot.js); every differing path
 *   recorded_edits  no git base: each changed file's hunks are the recorded edits
 */
export const CODE_DIFF_BASES = Object.freeze(['git', 'recorded_edits']);
/**
 * How the session's start commit was found, by structure only. Closed.
 *   recorded     the recording names it (a Codex rollout's session_meta `git.commit_hash`)
 *   reflog       the HEAD reflog entry in effect at the recording's first timestamp
 *   commit_date  the newest first-parent commit of HEAD committed at or before that timestamp (no reflog entry reaches it)
 */
export const CODE_START_COMMIT_SOURCES = Object.freeze(['recorded', 'reflog', 'commit_date']);
/** What a differing path is, as git (or the recorded edits) say: closed. */
export const CODE_CHANGE_TYPES = Object.freeze(['added', 'modified', 'deleted']);
/**
 * The state of one path of the diff (its table-of-contents row). Closed.
 *   recorded           a recorded write, edit or delete names the path: its hunks are shown
 *   unrecorded_change  it differs from the start commit, but no recorded edit names it (a `sed -i`, a generator): its
 *                      hunks are shown, marked
 *   base_unknown       no git base: its hunks are the session's recorded edits
 *   withheld           the file's own state keeps its hunks out (CODE_FILE_STATES: binary, oversize,
 *                      changed_since_session for a file the session deleted that is there again, unreadable): listed
 *                      by name, no hunk shown
 *   unreadable         its diff could not be read consistently (git failed, a hunk does not match the file or the base,
 *                      or the hunks do not turn the base into the file now): listed by name, no hunk shown (fail closed)
 * A path whose diff is withheld or unreadable keeps the code step's coverage from reading complete.
 */
export const CODE_DIFF_STATES = Object.freeze(['recorded', 'unrecorded_change', 'base_unknown', 'withheld', 'unreadable']);
/**
 * The lenses of the code step's review (code-pass/7: one review agent works through them all, as its method's
 * checklist; each finding names the one it came from). Closed, so each lens's wrong rate stays computable.
 *   behaviour  trace concrete inputs through the changed lines: missed cases, edge inputs, error paths
 *   tests      can each new assertion fail with the bug present; does a cited test reach the changed lines
 *   contracts  callers, callees, defaults, exceptions and docs the change makes wrong
 *   ask        each ask of the person's delivered or not, judged on the code
 *   rules      a rule of the project's files or the person's words that the change breaks
 *   claims     a claim or decision of the agent's that the code settles
 */
export const CODE_PASS_LENSES = Object.freeze(['behaviour', 'tests', 'contracts', 'ask', 'rules', 'claims']);
/** What a code-step finding is: closed. No severity, confidence or rank is ever attached to one. `rule_break`: a rule of
 *  the project's files or the person's words the change breaks; `claim_false`: a claim or decision of the agent's that
 *  the code contradicts. */
export const CODE_FINDING_KINDS = Object.freeze(['bug', 'missed_case', 'weak_test', 'contract_break', 'ask_not_met',
  'rule_break', 'claim_false']);
/** A checking agent's verdict on a finding's title (code-pass/7): closed. `holds` — the code, as it traced it, shows
 *  the stated problem; `refuted` — it does not; `cannot_tell` — settling it needs something outside the repository (a
 *  run, a dependency's source, the platform). Since code-verify/3 (D110) `holds` is never a label by itself: the checking
 *  agent lists the premises the problem rests on, each with its source (CODE_PREMISE_SOURCES), and code computes from
 *  them whether a finding that holds is confirmed; `cannot_tell` is a trace that settles nothing either way. */
export const CODE_VERIFY_VERDICTS = Object.freeze(['holds', 'refuted', 'cannot_tell']);
/** A checking agent's verdict on each supporting claim of a finding: closed. A claim judged `false` is cut from the
 *  finding: the record keeps it with its verdict, and no reader shows it. */
export const CODE_CLAIM_VERDICTS = Object.freeze(['holds', 'false']);
/**
 * What settles one premise a finding rests on, as its checking agent names it (code-verify/3, D110; the owner's bucket
 * C, 2026-10-17): each of the 1 to 6 premises it lists has one source. Closed.
 *   repository  lines of the repository show it: at least one receipt, each a quote code finds literally on the lines of
 *               the file it names (that a test, bench or command reaches some code is shown only by its call chain:
 *               its entry point and each call on the way)
 *   language    documented behaviour of the language or of its standard library settles it, named in the premise;
 *               any receipt it gives grounds like any other
 *   outside     anything else: toolchain or compiler internals, a dependency the agent cannot open, timing, a run
 * Code computes the label from these alone (code-pass.js `findingConfirmed`): a finding is confirmed only when its
 * verdict holds and every premise is `repository` or `language`, each receipt grounded; one `outside` premise makes it
 * not confirmed, published apart (`codePass.unconfirmed`) with that premise in the checking agent's words. No model
 * rates its own confidence: the source says where a premise's evidence is, and code reads only that and the receipts.
 */
export const CODE_PREMISE_SOURCES = Object.freeze(['repository', 'language', 'outside']);
/** A checking agent's verdict on an open question for the person: closed. `false_premise` — the code shows what it rests
 *  on is not so. */
export const CODE_QUESTION_VERDICTS = Object.freeze(['sound', 'false_premise']);
/**
 * Why a checking agent refuted a finding: ReviewBench's false-positive classes (MIT) plus the trace check and the goal
 * test. Closed, so each reason's rate stays computable.
 *   incorrect          the finding misreads the code (its refutation must quote the code that shows it)
 *   mitigation_shown   another line handles the case (quoted)
 *   input_unreachable  the input cannot reach the anchor (quoted)
 *   step_unsupported   a step does not follow from its quote
 *   out_of_scope       the root cause is not in the change
 *   not_against_goal   the behaviour is as stated, but it does not defeat what the person asked for or what a caller is
 *                      promised: the finding becomes an open question for the person, never a silent withholding
 * (`rests_on_unshown_code` and `unverifiable` went with code-pass/7: the checker reads the repository itself, and the
 * verdict `cannot_tell` says what it cannot settle. `duplicate` went with the review of the code step.)
 */
export const CODE_REFUTATION_REASONS = Object.freeze(['incorrect', 'mitigation_shown', 'input_unreachable',
  'step_unsupported', 'out_of_scope', 'not_against_goal']);
/**
 * Why the code step withheld a finding or a question it was given (`withheld[].reason`; code-pass/7, which replaced
 * CODE_FINDING_WITHHELD). A withheld item keeps its text and is shown folded with its reason, never
 * counted. Closed.
 *   malformed                  it broke the contract after the one repair (its `cause`: a CODE_ITEM_ERRORS member; its
 *                              `repair`, a CODE_REPAIR_UNCHECKED member, when no item of the repair stood in its place)
 *   evidence_grounding_failed  a quote or an anchor did not ground after the one repair (its `cause`, its `repair`)
 *   out_of_scope               the anchor does not touch the change, and no step quotes a changed line where its kind
 *                              allows that (contract_break, rule_break, claim_false)
 *   verify_refuted             its checking agent refuted it, with a quoted reason where the reason needs one
 *   verify_cannot_tell         its checking agent could not settle it from the repository
 *   verify_unexecuted          its check did not complete: the verdict was void after its one re-ask (its `cause`: a
 *                              CODE_VOID_CAUSES member)
 *   false_premise              a question whose premise its checking agent showed false in the code
 *   request_failed             its checking request was not answered (the call failed; before code-pass/12, also a
 *                              request over the bound)
 *   request_too_large          (code-pass/12, D105) its checking request was too large to send: Sonah did not send it
 */
export const CODE_WITHHELD_REASONS = Object.freeze(['malformed', 'evidence_grounding_failed', 'out_of_scope',
  'verify_refuted', 'verify_cannot_tell', 'verify_unexecuted', 'false_premise', 'request_failed', 'request_too_large']);
/**
 * Why no item of the one repair stood in the place of an item withheld by its shape or its grounding
 * (`withheld[].repair`, code-pass/10; reasons `malformed`, `evidence_grounding_failed` and `out_of_scope`). Absent, an
 * item of the repair matched it one to one (CODE_REPAIR_FATES: by identity, never by its index alone and never by
 * order; code-pass.js `mergeRepair`), stood in its place, was checked and failed too; present, none did, so no reader
 * says it failed "even after one repair". Each member says only what code compared: an item of the repair that corrects
 * the very part an identity reads (its anchor's lines, a missing anchor, a question's words) matches no item, and is
 * checked as a new item (D107). Closed; set by structure (which call was made, which items have an identity, and which
 * items of the repair matched it).
 *   unmatched           Sonah compared it with every item of the repair, past its list's limit included, and none
 *                       matched it: none of the same value, no finding of its kind on its file version with anchor
 *                       lines that overlap its anchor's, no question with its words on its dossier item
 *   uncompared          none matched it, but at least one item of the repair has no identity (a finding whose anchor is
 *                       missing, is not in its closed shape, names lines that are not all lines of a readable file
 *                       version or ends before it starts; a question with no words): Sonah compared it with that one by
 *                       value only
 *   ambiguous           items of the repair up to its list's limit matched it, but not one to one: more than one item
 *                       of the repair matched it (past its list's limit included), or the one that matched it matched
 *                       another item of the answer too. Sonah breaks no such tie, by order or otherwise: no item takes
 *                       its place
 *   matched_past_limit  only items of the repair past its list's limit matched it, and those take no place: unchecked
 *   unnamed             it has no identity and no anchor in its closed shape (a finding whose anchor is missing or not
 *                       in its shape, an item that is not an object, a question with no words), and no item of the
 *                       repair is of the same value
 *   unplaced            a finding whose anchor is in its closed shape, but whose lines are not all lines of a readable
 *                       file version, or whose last line is before its first: it has no identity, and no item of the
 *                       repair is of the same value
 *   brought             the item came in the one repair and holds no place of the answer: no repair was left for it
 *   failed              the repair's call failed, or its answer was not an object (before code-pass/12, also a
 *                       request over the bound)
 *   spent               the one repair went to asking again for an answer that could not be used whole, and the item is
 *                       of the answer that it brought
 *   unasked             the item is past its list's limit (CODE_REVIEW_ITEMS_MAX): withheld unchecked, named in no
 *                       repair
 *   too_large           (code-pass/12, D105) the repair's request was too large to send, even with the lowest blocks
 *                       left out: Sonah did not send it
 *   accounted           (F3b, D111) a finding that came with the accounting of the code review (code-pass.js
 *                       `accountItems`): no repair is asked for one, so none stood in its place
 * A member never changes its meaning: an earlier report's `different`, `absent` and `repeated` (code-pass/10, read at
 * the item's index) keep their words in the readers (code-report.js `unrepaired`) and are written no more.
 */
export const CODE_REPAIR_UNCHECKED = Object.freeze(['unmatched', 'uncompared', 'ambiguous', 'matched_past_limit',
  'unnamed', 'unplaced', 'brought', 'failed', 'spent', 'unasked', 'too_large', 'accounted']);
/**
 * What became of each item of the review agent's answer and of its one repair's answer (`codePass.fates`, F3a): every
 * item of either answer, each list to its end, gets exactly one fate record. Items are matched by identity, never by
 * their index alone and never by order (code-pass.js `mergeRepair`): an item matches another when they are the same
 * value; two findings when they are of the same kind on the same file version and their anchors' lines overlap (the
 * kind takes part when the answer gave it valid; an anchor names lines only when it is in its closed shape and they are
 * lines of a readable file version, the first not after the last); two questions when they have the same words and name
 * the same dossier item (the key takes part when it names one). An item of the repair takes the place of an item of the
 * answer only one to one: each is the only item of the other answer that it matches. Closed.
 *   kept      it stands and goes to its checking agent: an item of the answer that passed its checks, or an item of the
 *             repair that passed its checks and stands in place of the item of the answer it replaces (`replaces`)
 *   replaced  an item of the answer that failed its checks, in whose place the one item of the repair that matched it,
 *             which matched no other item of the answer, stands, or is withheld when it failed too (`by`)
 *   added     an item of the repair that passed its checks, holds no place and matches no item of the answer that
 *             stands: it stands and goes to its checking agent (two such items, or one beside an item of the repair
 *             that holds a place, stand as two items of one answer do)
 *   folded    an item of the repair that matches items of the answer that stand, so it never stands beside one
 *             (`into`: all of them); an item of the repair that does not stand on its own (it failed and holds no
 *             place, or it is past its list's limit), into every item of the answer of its value, else into every item
 *             that stands that it matches
 *   withheld  an item withheld by its shape, its grounding or its list's limit (`reason`, a CODE_WITHHELD_REASONS
 *             member, as its withheld record gives it); an item of the repair withheld in the place of the item of the
 *             answer it replaces says which (`replaces`)
 */
export const CODE_REPAIR_FATES = Object.freeze(['kept', 'replaced', 'added', 'folded', 'withheld']);
/** Which answer the item of a fate record is of (`codePass.fates[].from`): the review agent's answer, or its one
 *  repair's; or (F3b, D111) an answer of the accounting of the code review, whose findings are numbered across its
 *  answers in the order code read them (code-pass.js `accountItems`). Closed. */
export const CODE_ANSWER_SOURCES = Object.freeze(['answer', 'repair', 'account']);
/** What a withheld item of the code step is (`withheld[].what`): a finding or an open question. Closed. (`held`, a
 *  statement found to hold, went with code-pass/9: an earlier report's such entry is listed nowhere.) */
export const CODE_WITHHELD_ITEMS = Object.freeze(['finding', 'question']);
/**
 * What is wrong with one item of the review agent's answer, by code (code-pass/7): named, with the item's index and
 * the offending key or quote, in the one repair request, and kept as a withheld item's `cause`. Closed.
 *   key_missing           a key of the contract is missing
 *   key_outside_contract  a key the contract does not hold
 *   value_outside_list    a value outside its closed list, or of the wrong type
 *   text_over_limit       a text or a list outside its length limits
 *   dossier_key_unknown   a key that is not one of the dossier's
 *   ask_key_required      an ask_not_met that names no ask of the dossier
 *   claim_key_required    a claim_false that names no claim or decision of the dossier
 *   quote_ungrounded      a quote is not word for word in the file (or the session text) it names
 *   anchor_off_quote      the lines named are no lines of the file, hold no occurrence of the quote, or the anchor
 *                         touches no line the trace quotes
 *   file_not_readable     the file named is not a readable text file of the repository (now, or at the start commit)
 *   out_of_scope          the anchor does not touch the change, and no step quotes a changed line where its kind allows
 *   path_ambiguous        D122 (d): a relative path names an existing file in more than one place of the change (the
 *                         working folder's repository when it holds a file of the change, and each other place that
 *                         holds one: cli code-snapshot.js `createRepositoryReader`'s `name`), so it names none of them;
 *                         also a file note's path (code-pass.js `fileNoteShape`)
 */
export const CODE_ITEM_ERRORS = Object.freeze(['key_missing', 'key_outside_contract', 'value_outside_list',
  'text_over_limit', 'dossier_key_unknown', 'ask_key_required', 'claim_key_required', 'quote_ungrounded',
  'anchor_off_quote', 'file_not_readable', 'out_of_scope', 'path_ambiguous']);
/**
 * Why a checking agent's verdict is void (code-pass/7): named in its one re-ask, and kept as a `verify_unexecuted`
 * item's `cause`. Closed.
 *   shape               the verdict broke its contract
 *   receipt_ungrounded  a receipt's quote is not word for word on the lines of the file it names
 *   support_off_anchor  a "holds" quotes no line of the anchor
 *   support_off_trace   a "holds" quotes no line any code step of the trace quotes
 *   refutation_uncited  a refutation that must quote the code (incorrect, mitigation_shown, input_unreachable; a
 *                       question's false premise) quotes none that grounds
 */
export const CODE_VOID_CAUSES = Object.freeze(['shape', 'receipt_ungrounded', 'support_off_anchor', 'support_off_trace',
  'refutation_uncited']);
/** How the review agent's request ended (code-pass/7, `codePass.agent.terminal`): closed. `answered` — an answer in the
 *  contract's top-level shape; `unusable` — an answer outside it; `failed` — the call failed; `not_sent` — no change to
 *  review, or a request too large to send (code-pass/12: its minimum over the review's bound, `manifest.review.sent`
 *  false). */
export const CODE_REVIEW_TERMINALS = Object.freeze(['answered', 'unusable', 'failed', 'not_sent']);
/**
 * D118 (a), the owner's go of 2026-10-18 ("cool go for it"): why the code step reviewed no code, as every reader's first
 * screen says it (code-report.js `codeNotReviewedOf`). Closed; exactly one per report, chosen by code from the code
 * pass's own record, never from a word.
 *   step_off           the report holds no code pass record: the review ran without the code step
 *   backend            the step did not run: its gap `code_step_backend` (it needs the claude-cli backend)
 *   no_folder          the step did not run and names no other gap: it could read no working directory of the session
 *   no_write           the change held no file to review: no recorded write of the session could have changed a file,
 *                      and the session ran no shell command (the code pass record's `unseenEdits` is not set)
 *   no_seen_write      (D123, the beta.5 end-to-end smoke) as `no_write`, but the session ran a shell command
 *                      (`unseenEdits`): a script can write files that no recorded write names, so Sonah saw none it can
 *                      read, never that the session wrote none
 *   no_seen_write_given (D124's review) as `no_seen_write`, but the code pass record names a repository that the
 *                      person gave with --code-repo (its base's or a place's `given`: code-pass.js `repositoriesGiven`),
 *                      and Sonah found no file of the change there: its words never tell them to give one again
 *   no_written_change  the change held no file to review: writes, none in the change, beside files that changed outside
 *                      them (D113)
 *   no_file            the change held no file to review, for any other reason
 *   none_shown         the change held files, none with changed lines the step could show (each deleted with no
 *                      hunks, binary, or outside the change block): no review request was made (`calls.review` 0)
 *   too_large          the review request was not sent: its minimum was over the review's bound (code-pass/12)
 *   no_answer          the request was sent, and its call shows no sign that it read it (code-pass.js
 *                      `codeReviewAnswered`)
 *   none_seen          the review answered, and the one tally holds every file of the change as not seen
 *   unknown            (D122, a review low of D118) no review request was made, and the record is one an earlier code
 *                      step wrote before it kept the request's manifest (`sonah.code-pass/12`), so it does not say why:
 *                      its code step could also drop a request too large to send then
 */
export const CODE_NOT_REVIEWED_REASONS = Object.freeze(['step_off', 'backend', 'no_folder', 'no_write', 'no_seen_write',
  'no_seen_write_given', 'no_written_change', 'no_file', 'none_shown', 'too_large', 'no_answer', 'none_seen', 'unknown']);
/** The kinds of the session dossier's items (code-context.js `codeDossier`), built by code from the saved report. */
export const CODE_DOSSIER_KINDS = Object.freeze(['ask', 'claim', 'decision', 'pivot', 'failure',
  'edit_against_instruction']);
/**
 * Where a dossier item tells the reviewer to look (session context decides where to look, never what is
 * true). Closed; chosen by code from the item's recorded structure, never from its words.
 *   claim_unconfirmed         a claim no run confirms: a hypothesis, find the input that breaks it
 *   claim_confirmed           a claim a run confirms: check that the run reached the changed lines
 *   design_point              a decision made without asking, asked and chosen how, or a change of approach: does it
 *                             fit the ask and the contracts
 *   not_acting                a choice not to act: find what it leaves broken
 *   failure_passed_over       a failure passed over: look for the bug there; does the head still fail
 *   never_ran                 no command that may have run was recorded after the file's last edit (one refused
 *                             before it ran is none, code-pass/11): the final state never ran
 *   ask_short                 an ask partly done or not done: find the shortfall in the diff
 *   edit_against_instruction  an edit against an instruction: find what it broke
 *   ask_done                  (code-pass/7) an ask the session review shows done: check the change delivers every part
 *                             of it
 */
export const CODE_DOSSIER_MOVES = Object.freeze(['claim_unconfirmed', 'claim_confirmed', 'design_point', 'not_acting',
  'failure_passed_over', 'never_ran', 'ask_short', 'edit_against_instruction', 'ask_done']);
/**
 * What the code step's coverage footer names (`footer[]`, each `{ kind, path?, count?, part? }`; code-pass/7, after
 * PR-Agent `pr_reviewer.py:1350-1376`). Closed.
 *   withheld        a path of the change whose hunks are not in the change block, by its own state (`path`; its
 *                   `files[]` entry gives the state), a recorded write outside the working directory in the repository
 *                   included
 *   clipped         a path of the change whose hunks the request left out for room (`path`; the manifest's entry says
 *                   which bound, CODE_LEFT_OUT_REASONS): the agent may read the file, not its diff
 *   failed          calls of a part of the code step (`part`, CODE_STEP_PARTS) that gave no usable answer (`count`)
 *   outside_root    recorded writes outside every folder the review can read (`count`; D109: the working directory and
 *                   the repository's top folder): an agent's scratch files, counted, not part of the change reviewed.
 *                   D109's review: `home`, how many of them lie in a harness home folder or are named from the home
 *                   folder (never project work, D69 b), which can lie in a folder the review can read: said apart
 *   source_changed  the repository changed while the code step ran (its state before the first request and after the
 *                   last differ), so what the agents read may mix two states
 *   too_large       (code-pass/12, D105) requests of a part of the code step (`part`) too large to send (`count`):
 *                   Sonah sent none of them, so none is a call that did not answer
 *   commands_left_out  (code-pass/12) commands of the session the review request left out for room (`count`): the
 *                   agent cannot read a command itself
 *   unaccounted     (F3b, D111) items of the session review in scope of the accounting (`scope`, a CODE_ACCOUNT_SCOPE
 *                   member) whose fate is `not_examined` or `missing` (`count`): one entry per scope member with any.
 *                   No entry ever counts the items the accounting examined: the page has no positive line of them
 * From code-pass/12, `withheld` and `clipped` name only a file the code review did not see (code-pass.js `codeSeenOf`:
 * not shown, and not read; a Read that failed read nothing): one it read in part, read whole whose change it did not see
 * (the request did not show its hunks' rows on the earlier side), or read with no lines Sonah could read, is named by the
 * readers' seen lines (and keeps the coverage short while its change is not seen); one whose change it saw whole is not
 * named.
 */
export const CODE_FOOTER_KINDS = Object.freeze(['withheld', 'clipped', 'failed', 'outside_root', 'source_changed',
  'too_large', 'commands_left_out', 'unaccounted']);
/** The parts of the code step (code-pass/7): the review agent, its one repair, a finding's checking agent, the batch
 *  checking agent of the questions; and (F3b, D111) an accounting agent. A failed call is named by its part in the
 *  footer. Closed. */
export const CODE_STEP_PARTS = Object.freeze(['review', 'repair', 'verify', 'batch', 'account']);
/**
 * The items of the session dossier (code-context.js `codeDossier`) that the code review's accounting accounts for (F3b,
 * D111; the owner's bucket C, 2026-10-17), in the order code sends them: the session review's asks (dossier kind `ask`:
 * every requirement, whoever's words it rests on, `CODE_ACCOUNT_ASK_SOURCES`), then the statements the agent wrote into
 * a file (the dossier items of the report's `writtenClaims`), then the agent's decisions not to act (dossier kind
 * `decision` with the move `not_acting`), each in the dossier's order. Chosen by the item's recorded structure, never by
 * its words. Closed.
 */
export const CODE_ACCOUNT_SCOPE = Object.freeze(['ask', 'written_claim', 'not_acting']);
/**
 * Whose words an ask of the session review rests on (D111 amended, 2026-10-18; the owner: "go for fix first"), read from
 * the recorded event its instruction receipt cites (code-context.js `askSourceOf`), never from its words: `person` — your
 * own words (a root instruction recorded with human authority, or a project instruction file you wrote that the main
 * agent was given: code-context.js `actorOf`); `helper_brief` — a brief an agent wrote for a helper (an instruction of a
 * helper's session, recorded with its parent agent's authority); `other` — anything else, or what Sonah cannot read
 * (another agent's message, a file given to a helper or written by the session, an event the session does not hold, an
 * ask with no instruction receipt): never said to be yours. Closed, in the order the readers say them.
 */
export const CODE_ACCOUNT_ASK_SOURCES = Object.freeze(['person', 'helper_brief', 'other']);
/**
 * What an accounting agent answers for one item in scope (F3b, D111): closed. The answer is the agent's; code checks its
 * shape and grounds each receipt by string search, and no reader shows it (the private report keeps it).
 *   breaks        the code, as it traced it, breaks the item: its entry names a finding or question of the code review
 *                 (`by`), or carries a finding of its own, which goes to a checking agent like any finding
 *   holds         the code, as it traced it, delivers the ask or bears out the statement or the decision
 *   outside       settling it needs what no file of the repository shows
 *   not_examined  it did not examine the item
 * `breaks`, `holds` and `outside` each need at least one receipt, a quote of the code that grounds.
 */
export const CODE_ACCOUNT_OUTCOMES = Object.freeze(['breaks', 'holds', 'outside', 'not_examined']);
/** What code records of each item in scope (`codePass.account.entries[].fate`), exactly one each (F3b, D111): the
 *  outcome of an entry code could use (CODE_ACCOUNT_OUTCOMES), or `missing` with its cause (CODE_ACCOUNT_MISSING).
 *  Closed. */
export const CODE_ACCOUNT_FATES = Object.freeze([...CODE_ACCOUNT_OUTCOMES, 'missing']);
/**
 * Why an item in scope has no entry that code could use (`missing`, F3b, D111): closed, set by structure (which call was
 * made, which entries came back, whether their quotes ground, which findings were published).
 *   not_returned               the answer of its batch gave no entry for it
 *   malformed                  its entry broke the contract (Sonah asked once more when its batch's re-ask was left)
 *   evidence_grounding_failed  a receipt of its entry is not word for word on the lines that it names (Sonah asked once
 *                              more when its batch's re-ask was left)
 *   unreported                 a `breaks` entry that names no finding or question of the code review and carries no
 *                              finding that stands
 *   inconsistent               a `holds` entry for an item that a published finding of the code review follows from: the
 *                              entry is voided, and the finding is kept as its check left it
 *   batch_failed               its batch's call did not answer, or its answer could not be read
 *   too_large                  its batch's request was too large to send: Sonah did not send it
 *   over_review_limit          it is past the most items one review accounts for (code-pass.js CODE_ACCOUNT_LIMITS)
 */
export const CODE_ACCOUNT_MISSING = Object.freeze(['not_returned', 'malformed', 'evidence_grounding_failed', 'unreported',
  'inconsistent', 'batch_failed', 'too_large', 'over_review_limit']);
/**
 * What a code-step request shows of one unit of its blocks (code-pass/12, D105): the state of each entry of the request
 * manifest (`codePass.manifest.review`). Closed.
 *   whole       the request shows every line of it
 *   in_part     the request shows some of its whole lines, named by their numbers: a command or a session text over
 *               its own cap (`item_cap`); with part B on (D106), a file the session read, the lines it read shown
 *   hunks_only  a changed file whose hunks the request shows, not every line of the file; with part B on (D106), its
 *               `reason` says why the file is not shown whole
 *   left_out    not shown for room, named in fixed words (its `reason`, CODE_LEFT_OUT_REASONS): a rule or skill file, a
 *               changed file's hunks, a command; with part B on (D106), a file the session read, none of its ranges
 *               shown (each range left out with its reason)
 *   not_shown   a changed file whose hunks cannot be shown, by its own state (its `reason`: the file's CODE_FILE_STATES
 *               member, or before D109 its diff's CODE_DIFF_STATES member); from D109 also a recorded write the change
 *               block does not hold that lies in a folder the review can read (its `reason` `outside_root`,
 *               `other_repository` or `outside_writer_root`)
 * From D109 each changed file's entry also says whether a recorded edit of the session wrote it (`recorded`), and a file
 * whose change is the whole file (git's `added`, or one a recorded edit wrote whole) keeps that change as every line of
 * it (`change`, `[[1, lines]]`) when the request shows it short of whole: the whole file is its change. Since D109's
 * review a `left_out` file whose hunks alone are over what the change block's cap leaves beside its table of contents
 * says so (`alone: true`): too large on its own (its file state `oversize`), never left out for room.
 * With part B on (D106, code-pass.js `CODE_WHOLE_FILES`, on since D108), a changed file the whole files block shows is
 * `whole`.
 */
export const CODE_SHOWN_STATES = Object.freeze(['whole', 'in_part', 'hunks_only', 'left_out', 'not_shown']);
/**
 * Why a code-step request left a unit out, or showed a text in part (code-pass/12, D105). Closed.
 *   block_cap      it is over its block's frozen cap (the change block's, the rule files' block; with part B on, D106,
 *                  the whole files' block, the reads' block)
 *   request_bound  the request's blocks were over its bound with it, the lower blocks already left out
 *   item_cap       a command or a session text over its own frozen cap (code-context.js SHOWN_SIDE_BYTES a side): its
 *                  first and last whole lines that fit are shown
 */
export const CODE_LEFT_OUT_REASONS = Object.freeze(['block_cap', 'request_bound', 'item_cap']);
/**
 * What the code review saw of a changed file or a rule or skill file the session loaded (code-pass/12, D105), computed
 * by code from the request manifest and the review agent's reading record (code-pass.js `codeSeenOf`), never from a
 * word. Closed. Seeing is not checking: no reader says a file seen whole is fine.
 *   whole       shown whole, or the shown and the read lines together cover every line
 *   in_part     the review read some of its lines beyond what the request showed, not every line (the lines named)
 *   hunks_only  the request showed its hunks, and the review read no other line of it
 *   not_seen    the request did not show it, and the review read no line of it
 *   lines_unknown  the review read it with a Read that did not fail but whose typed result gave no lines (an image, a
 *               repeated read, a format change), and the shown and read lines do not cover every line: never called not
 *               seen, nor seen only in part
 * A Read that failed (CODE_READ_FAILURES) read nothing: it makes no file seen in any state.
 * Each file of the change also carries whether the review saw its change (`changeSeen`): on each side of its hunks, every
 * line they hold seen — on the side the file has now, shown or read (or the file seen whole); on the earlier side of a
 * file that has one now, shown, since no Read can show it (a file whose hunks hold no row there has nothing to see on
 * it). A file read in part or whole whose hunks the request did not show keeps the coverage short.
 */
export const CODE_SEEN_STATES = Object.freeze(['whole', 'in_part', 'hunks_only', 'not_seen', 'lines_unknown']);
/**
 * Why a code-step agent's Read read nothing (code-pass/12, D105; the agent transport /2), from the CLI's typed fields
 * only, never from the result's text. Closed.
 *   refused  the CLI's result lists the Read among the tool uses it refused (`permission_denials`, by the use's id):
 *            `--restricted` refuses a path outside the working directory and its added folders
 *   failed   the CLI typed the Read's tool result as an error (`is_error`): a file too large to read at once, a path that
 *            is not there, … (which one, Sonah does not read)
 * The reading record keeps such a Read apart (its path and this reason), never as a read: no reader counts its file as
 * seen, in part, or with lines Sonah could not tell.
 */
export const CODE_READ_FAILURES = Object.freeze(['refused', 'failed']);

// ---- the report's items and their tiers (D96, D97): closed vocabularies ----------------------------------------------

/** The three tiers of the report, in display order (D97): what you must act on, what you must know, what is good to
 *  know (folded). The tier is the section, never a badge or a colour. Each item kind's default, floor and ceiling are
 *  frozen literals in triage.js (`ITEM_KIND_TABLE`). Closed. */
export const REPORT_TIERS = Object.freeze(['must_act', 'must_know', 'good_to_know']);
/** The importance the code step's review agent may propose for one item (D96, its `triage` list): `high` (must act),
 *  `medium` (must know) or `low` (good to know). Code maps it to a tier and keeps it inside the floor and ceiling of
 *  the item's kind (triage.js `boundTier`); no other rating, score, rank or confidence is accepted from a model.
 *  Closed. */
export const TRIAGE_LEVELS = Object.freeze(['high', 'medium', 'low']);
/**
 * The type of a report item, its first word, set by its kind (triage.js `ITEM_KIND_TABLE`), never by a model. Closed.
 *   fix     something checked is wrong in what the agent delivered
 *   decide  a decision the agent made on its own, or a question only you can settle
 *   read    something Sonah could not settle
 *   verify  something not proven, or proven false by the recording
 */
export const REPORT_ITEM_TYPES = Object.freeze(['fix', 'decide', 'read', 'verify']);
/**
 * The kinds of a report item (D97), in display order within a tier, each read from one row's closed tokens by
 * triage.js `itemKindOf`, never from its words. Closed.
 *   ask_not_done             an ask the session review shows not done (a legacy report's open)
 *   ask_partly_done          an ask shown partly done (a legacy report's partly addressed)
 *   code_ask_not_met         a published code finding of kind ask_not_met
 *   claim_contradicted       a session finding: a claim of the agent's the recording contradicts (DECIDE)
 *   code_claim_false         a published code finding of kind claim_false
 *   edit_against_instruction a session finding: an edit against something you said (DECIDE)
 *   code_bug                 a published code finding of kind bug or missed_case
 *   code_contract            a published code finding of kind contract_break or rule_break
 *   written_contradicted     a statement the agent wrote into a file, contradicted
 *   code_weak_test           a published code finding of kind weak_test
 *   failure_passed_over      a failure the agent passed over
 *   decision_not_acting      a decision not to act
 *   decision_unasked         a decision made without asking you
 *   code_question            a question of the code review for you
 *   decision_chose           you asked, and the agent decided how
 *   pivot                    a change of approach
 *   decision_whether_asked   a decision where Sonah could not check whether you asked
 *   code_question_finding    a code finding its check found real but not against your goal, asked of you
 *   code_finding_unconfirmed a code finding its check found to hold that Sonah could not confirm: a premise of the check
 *                            rests outside the repository and the language (`codePass.unconfirmed`, D110)
 *   claim_corrected          a contradicted claim the agent corrected or told you about, or a helper's (FYI)
 *   edit_undone              an edit against your words the agent undid or told you about, or a helper's (FYI)
 *   claim_not_checked        a claim Sonah did not check (listed; an item only when the code review raises it)
 *   claim_incomplete         a claim that rests on a check that did not finish (listed, as above)
 *   written_not_checked      a statement in a file Sonah did not check (listed, as above)
 *   code_finding_legacy      a finding of an earlier code review (the retired combined route, or a code finding of a
 *                            kind outside CODE_FINDING_KINDS)
 */
export const REPORT_ITEM_KINDS = Object.freeze(['ask_not_done', 'ask_partly_done', 'code_ask_not_met',
  'claim_contradicted', 'code_claim_false', 'edit_against_instruction', 'code_bug', 'code_contract',
  'written_contradicted', 'code_weak_test', 'failure_passed_over', 'decision_not_acting', 'decision_unasked',
  'code_question', 'decision_chose', 'pivot', 'decision_whether_asked', 'code_question_finding',
  'code_finding_unconfirmed', 'claim_corrected', 'edit_undone', 'claim_not_checked', 'claim_incomplete',
  'written_not_checked', 'code_finding_legacy']);
/**
 * Why an item's final tier is not the one proposed for it (triage.js `boundTier`). Closed.
 *   kind_floor            the proposal was below the floor of the item's kind
 *   kind_ceiling          the proposal was above the ceiling of the item's kind
 *   refused_call_ceiling  the item cites a call a permission rule or auto mode refused before it ran: never Must act
 */
export const TIER_BOUND_REASONS = Object.freeze(['kind_floor', 'kind_ceiling', 'refused_call_ceiling']);
/**
 * E1-F8 (D112, one point, one item): the checked ties that put a row inside the item of another row, as a member of
 * that item, instead of an item of its own. Code reads structure only, never a word. Closed.
 *   concerns  a question that the code review wrote (`from: 'review'`), whose `concerns` names a row that an item of the
 *             report holds; the code step grounded the question's quote in that row's words before it published it.
 *             D112 amended (2026-10-18): only when the question's own place (the recorded events, files and lines its
 *             receipt or anchor names) overlaps that item's place (render/report-model.js `placesOverlap`); one that
 *             names no place (quote null) stays an item. A question on an ask, and a question routed from a finding
 *             (`from: 'finding'`), are never members.
 * D112 amended (owner, 2026-10-18): the tie `nested` (a decision whose stated receipt is nested in another decision's)
 * is removed.
 */
export const REPORT_GROUP_TIES = Object.freeze(['concerns']);
/**
 * E1-F8 (D112): which row places an item in its tier. Closed.
 *   lead    the item's own row
 *   member  a member of the item whose own tier is higher than the lead's: the item takes the higher tier, so no row of
 *           an item sits below the tier it has alone
 */
export const REPORT_TIER_SOURCES = Object.freeze(['lead', 'member']);
/**
 * What is wrong with one entry of the code review's `triage` or `files` list, beside the shape errors of
 * CODE_ITEM_ERRORS (code-pass/10): named in the one repair when a failing finding or question asks for it, and kept as
 * a dropped entry's `cause`, one record an entry. Closed.
 *   triage_key_unknown   a key that names no finding or question of the answer and no dossier item; or, in a file
 *                        note's `asks`, a key that names no ask of the dossier
 *   triage_key_repeated  a later entry for a key (or a file path) an earlier entry holds
 *   triage_not_item      a dossier key whose row can be no item of the report (a done ask, a settled decision, a
 *                        confirmed claim)
 *   file_not_in_change   a file note for a path that is no file of the change
 *   where_ungrounded     an entry's `where` did not ground: the place alone is dropped, the entry is kept (a reader
 *                        counts it among the kept entries, not the dropped ones)
 *   item_withheld        the finding or question the entry names was withheld, so the entry has nothing to stand on
 */
export const TRIAGE_ERRORS = Object.freeze(['triage_key_unknown', 'triage_key_repeated', 'triage_not_item',
  'file_not_in_change', 'where_ungrounded', 'item_withheld']);

// ---- two readers of a row's closed tokens, shared by the report's readers and triage.js -------------------------------

const rowObject = (row) => row !== null && typeof row === 'object' && !Array.isArray(row);
const [, CLAIM_VERIFIED_STATUS, CLAIM_INCOMPLETE_STATUS] = PROMISE_STATUSES;
/** D88: the kind of one claim (a published promise) by its status: confirmed by a recorded result is neither (it is
 *  listed under what the agent told you); resting on a check that never completed is folded; any other status reads not
 *  checked (PROMISE_STATUS_WORDS) and is folded. (Moved here from review.js, which re-exports it, so triage.js reads it
 *  without importing review.js.) */
export const claimRowKind = (p) => (!rowObject(p) || p.status === CLAIM_VERIFIED_STATUS ? null
  : p.status === CLAIM_INCOMPLETE_STATUS ? 'claimsIncomplete' : 'claimsOpen');
/** The state of a column the ledger derived (`deriveColumn`: `columnState` grounded); every other decision's column is
 *  null with `columnState` unchecked. */
export const DERIVED_COLUMN_STATE = 'grounded';
/** The judgment-first review (low, one counting): who decided a decision, as every reader reads it — its column only
 *  when the ledger derived it (DECISION_COLUMNS, `columnState` DERIVED_COLUMN_STATE), else null (the review could not
 *  tell whether you asked). The page's and the story's groups and the attention summary's kinds read this one rule.
 *  (Moved here from review.js, which re-exports it.) */
export const derivedColumn = (d) => (rowObject(d) && DECISION_COLUMNS.includes(d.column)
  && d.columnState === DERIVED_COLUMN_STATE ? d.column : null);

// ---- status reduction -----------------------------------------------------------------

/**
 * C-01 `PublicStatus`, in the contract's order. M33 (C-06 "M33 session verdict"): `NO_FINDINGS`
 * is a completed session review that found nothing over partial evidence — never complete evidence,
 * never CLEAN, never approval. A status outside this list is not a status. D71 (a): internal to the
 * report since 2026-10-08 — no surface a human reads shows one (`REVIEW_RUN_STATES` below).
 */
export const PUBLIC_STATUSES = Object.freeze(['DECIDE', 'FYI', 'CLEAN', 'NO_FINDINGS', 'UNCHECKED']);
const [DECIDE, FYI, CLEAN, NO_FINDINGS, UNCHECKED] = PUBLIC_STATUSES;
/** C-06: how a combined review's code and session statuses reduce to one — the first of these
 *  that either status is. `NO_FINDINGS` ranks below FYI and above only CLEAN. */
export const STATUS_PRECEDENCE = Object.freeze([DECIDE, UNCHECKED, FYI, NO_FINDINGS, CLEAN]);
/**
 * C-06 (M33): whether the session review itself completed, kept apart from what the recording
 * could hold. `complete` needs at least one reviewable non-boundary event, every window answered
 * and complete under `windowIncompleteReasons`, no capping reading rejection (`readingCaps`), and
 * a coverage short of complete only beside a declared recorder limit. Anything else is `incomplete`.
 */
export const SESSION_REVIEW_COMPLETION = Object.freeze(['complete', 'incomplete']);
const [REVIEW_COMPLETE, REVIEW_INCOMPLETE] = SESSION_REVIEW_COMPLETION;

/**
 * D71 (a), owner decision 2026-10-08: no verdict anywhere the human sees. The statuses above (`PUBLIC_STATUSES`, a
 * finding's DECIDE or FYI, a part's status) stay inside the report, read only by what still consumes them: the
 * disclosure facts a finding is shown with (`disclosureReason`, read beside its FYI), the part reasons, and any reader
 * outside this repository. No page, story, PR comment, CLI line, summary or GitHub check shows
 * one. What those surfaces may say of a review as a whole is only whether Sonah's own review ran, one of these:
 * `complete` — the session review completed (`sessionReview`, which already keeps the recording's declared limits
 * apart) and, on a combined review, the code review read every file it was given (the report's own `codeCoverage`);
 * `incomplete` — it ran and did not finish all of that; `failed` — it could not run, so there is no report.
 * D87: and, when a code pass was asked for (`report.codePass`), it read every file it showed (its own `coverage`).
 * The release review (owner, 2026-10-14): with the code step on by default, only a code pass the person asked for on
 * the command line (`codePass.required`, which the CLI sets for `--code-pass`) counts toward completeness; one that ran
 * by default or by the setting (`required: false`) is said by its own coverage, apart, and never makes the review
 * incomplete by itself. A report written before the field (none: it ran only with `--code-pass`) reads as required.
 * Never a judgment of the agent's work.
 */
export const REVIEW_RUN_STATES = Object.freeze(['complete', 'incomplete', 'failed']);
const [RUN_COMPLETE, RUN_INCOMPLETE, RUN_FAILED] = REVIEW_RUN_STATES;

/** D71 (a): whether Sonah's own review of this report ran to completion — a member of `REVIEW_RUN_STATES`. No report
 *  is `failed`; a report whose coverage cannot be recomputed is `incomplete`. Reads no finding and no status. D87: a
 *  report with a code pass the person required (`codePass.required` not false) is complete only when that pass is
 *  (`codePass.coverage`); a report without one, or with one that ran by default (`required: false`), reads by its
 *  session review alone. */
export function reviewRunState(report) {
  if (report === null || typeof report !== 'object' || Array.isArray(report)) return RUN_FAILED;
  let honest;
  try { honest = honestStatuses({ ...report, findings: Array.isArray(report.findings) ? report.findings : [] }); }
  catch { return RUN_INCOMPLETE; }
  if (honest.sessionReview !== REVIEW_COMPLETE) return RUN_INCOMPLETE;
  if (honest.reviewScope !== 'session-only' && report.codeCoverage !== 'complete') return RUN_INCOMPLETE;
  if (report.codePass !== undefined && report.codePass?.required !== false && report.codePass?.coverage !== 'complete')
    return RUN_INCOMPLETE;
  return RUN_COMPLETE;
}

/**
 * What the review actually observed, as facts no model supplied. Every status is reduced from
 * this and nothing else (audit A3). A field that is not known is `null`, and null never counts
 * as complete.
 *
 * M33 (C-06): the facts keep the two kinds apart. Whether the REVIEW completed is `windows`,
 * `windowsWithNarrative` (answered), `windowsFailed` (not complete under `windowIncompleteReasons`:
 * a failed call, an incomplete challenge or incomplete grounding) and `reviewableEvents`. What the
 * RECORDING could not hold — the recorder limits — is `adapterGaps`, `instructionsElided`,
 * `instructionsWithheld`, `delegationsUnlinked` and `pairGaps`: the action/result pairs the
 * segmentation had to show in separate windows (`splitPairGaps`), each declared as an `input_limit`; and, M33 X second
 * recheck, `carryCapped` (present only when nonzero): the earlier evidence code selected for a window's carry that its
 * request byte cap kept out of it (run-review.js `carryGaps`), declared as an `input_limit` with its own note.
 * M35 windowing (C-07): no window cuts an action from its result and nothing is carried by a byte cap, so a review
 * passes neither any more; both are still read from a report written before M35 (and count 0 when absent).
 */
export function sessionCoverageFacts({ session, windows, perWindow, declaredCoverage, pairGaps, carryCapped } = {}) {
  const events = session?.events ?? [];
  const actions = events.filter((e) => e.kind === 'invocation').length;
  const reviewableEvents = events.filter((e) => ['instruction', 'commentary', 'invocation',
    'observation'].includes(e?.kind)).length;
  const instructions = events.filter((e) => e.kind === 'instruction' && e.authority === 'human');
  const gaps = session?.adapterGaps ?? [];
  return {
    windows: windows?.length ?? 0,
    windowsWithNarrative: perWindow?.filter((w) => w.narrative).length ?? 0,
    windowsFailed: perWindow?.filter((w) => w.failure || !w.challenge?.complete || !w.groundingComplete).length ?? 0,
    actions,
    reviewableEvents,
    instructions: instructions.length,
    // W3e-5 / F212: an omitted instruction is missing for one of two causes, counted apart so the
    // header credits each to what did it — the recorder shortened it (`instructionsElided`), or
    // redaction left none of its words (`instructionsWithheld`: the adapter marks it `redacted`,
    // W3e-3 / F198). Both cap coverage (`coverageFrom`). M33 R: an ask Sonah capped before review and
    // nothing else (`capped`) is neither; its own declared gap names it (`instructions_capped`) and caps.
    // M33 R repair: likewise an ask whose pasted material Sonah stripped (`stripped`, `instructions_stripped`).
    instructionsElided: instructions.filter((e) => e.omitted === true && e.redacted !== true && e.capped !== true
      && e.stripped !== true).length,
    instructionsWithheld: instructions.filter((e) => e.omitted === true && e.redacted === true).length,
    delegationsUnlinked: unlinkedDelegations(session),
    // W3c-10 / F133: every adapter gap but `unrecorded_body`. Whether an unrecorded write caps the
    // session depends on what covered it, which these facts — computed before any code review is
    // joined — cannot know; counted here, it would cap for good and no later stage could honour
    // a covering diff. It still caps, by the declared-gap route below (`gapCaps`), which classifies.
    adapterGaps: gaps.filter((g) => g?.code !== 'unrecorded_body').length,
    // M33: the declared pair gaps, as a count or the declarations themselves; absent is none.
    pairGaps: Array.isArray(pairGaps) ? pairGaps.length : isCount(pairGaps) ? pairGaps : 0,
    ...(isCount(carryCapped) && carryCapped > 0 ? { carryCapped } : {}),
    // D104 (F5 part 4): the results the session review saw only in part — each recorded on one window (`seenInPart`,
    // seen-in-part.js `seenInPartOfWindows`), summed over the windows (present only when nonzero). A fact beside the
    // coverage: it never caps it (`coverageFrom` reads it not), and review.js names it whatever the coverage
    // (`uncappedCauses`).
    ...(seenInPartTotal(perWindow) > 0 ? { resultsSeenInPart: seenInPartTotal(perWindow) } : {}),
    declared: declaredCoverage ?? null,
  };
}

/** D104: the results the windows' requests showed only in part, each window's record, summed. */
const seenInPartTotal = (perWindow) => (Array.isArray(perWindow) ? perWindow : [])
  .reduce((n, w) => n + (Array.isArray(w?.seenInPart) ? w.seenInPart.length : 0), 0);

/**
 * How many hand-offs went unread, counted from every route a delegation gap can take (F100).
 *
 * Counting only what the ADAPTER declared was the false CLEAN W3c-3 found: `buildLedger` also
 * derives a gap from `session.children` — a ChildLink short of verified, or a delegate event with
 * no link at all — and those never reached these facts, so the report listed `missing_child` and
 * certified the session in one object. The union is de-duplicated by assignment event id, because
 * one hand-off declared by two routes is one loss, not two. C-03 ChildLink states are
 * verified | missing | ambiguous | conflicting, and only `verified` resolves a delegation — the
 * same rule `buildLedger` declares its gaps by, so the count and the gap list cannot disagree.
 */
function unlinkedDelegations(session) {
  const { named, unnamed } = unlinkedDelegationEvents(session);
  return named.size + unnamed;
}

/** `unlinkedDelegations`, by the assignment events it names (`named`, a Set of event ids) and the
 *  declarations that name none (`unnamed`). M33 (C-06 "M33 per-part verdicts") places each named one
 *  in its part by this same rule. */
function unlinkedDelegationEvents(session) {
  const children = Array.isArray(session?.children) ? session.children : [];
  const named = (id) => typeof id === 'string' && id.length > 0;
  const unlinked = new Set();
  let unnamed = 0;   // a declaration that names no event is still one lost hand-off
  for (const gap of Array.isArray(session?.adapterGaps) ? session.adapterGaps : []) {
    if (gap?.delegationUnresolved !== true && gap?.code !== 'missing_child' && gap?.code !== 'ambiguous_child') continue;
    const ids = (Array.isArray(gap.eventIds) ? gap.eventIds : []).filter(named);
    if (ids.length) for (const id of ids) unlinked.add(id);
    else unnamed++;
  }
  for (const link of children) {
    if (link?.state === 'verified') continue;
    if (named(link?.assignmentEvent)) unlinked.add(link.assignmentEvent);
    else unnamed++;
  }
  for (const event of Array.isArray(session?.events) ? session.events : []) {
    if (event?.kind !== 'invocation' || event.operation !== 'delegate' || !named(event.id)) continue;
    if (session.outcomeOf?.(event.id) === 'failed') continue;
    // `Session.childFor` semantics: the first recorded link for the assignment decides.
    if (children.find((c) => c?.assignmentEvent === event.id)?.state !== 'verified') unlinked.add(event.id);
  }
  return { named: unlinked, unnamed };
}

/** Reduce the facts to complete / partial / missing. Absence is never completeness. */
export function coverageFrom(facts) {
  // A judged instruction/commentary/observation-only session has a real reviewable scope.
  // Older callers supply only `actions`; keep their zero-action guard until they opt into the
  // explicit event count. Empty and boundary-only canonical sessions still have zero here.
  const reviewable = Object.hasOwn(facts, 'reviewableEvents') ? facts.reviewableEvents : facts.actions;
  if (facts.windows === 0 || !Number.isSafeInteger(reviewable) || reviewable <= 0) return 'missing';
  if (facts.windowsWithNarrative === 0) return 'missing';                     // every call failed
  if (facts.windowsFailed > 0 || facts.adapterGaps > 0 || facts.instructionsElided > 0
      || facts.instructionsWithheld > 0 || facts.delegationsUnlinked > 0 || facts.pairGaps > 0
      || facts.carryCapped > 0) return 'partial';
  if (facts.declared && facts.declared !== 'complete') return facts.declared;
  return 'complete';
}

/**
 * M33 (C-06). Did the facts see the review itself complete? At least one reviewable non-boundary
 * event, at least one window, every window answered, and none of them short under
 * `windowIncompleteReasons` (`windowsFailed` counts a failed call, an incomplete challenge and
 * incomplete grounding alike). Recorder limits are not read here. A fact that is absent or not a
 * count is not a completed review.
 */
function reviewedByFacts(facts) {
  const reviewable = Object.hasOwn(facts, 'reviewableEvents') ? facts.reviewableEvents : facts.actions;
  const positive = (n) => Number.isSafeInteger(n) && n > 0;
  return positive(reviewable) && positive(facts.windows) && facts.windowsWithNarrative === facts.windows
    && facts.windowsFailed === 0;
}

/**
 * M33 (C-06). Does the report declare at least one recorder limit — a loss the recording, not the
 * review, is short of: an elided or withheld instruction, an unlinked delegation, a declared pair
 * gap, carried evidence a window's request cap kept out (M33 X second recheck), or a declared gap
 * that caps the session (every adapter gap is one). Each of these is a cause the renderer names with
 * its count (review.js `coverageCauses`). A bare `adapterGaps` count with no declaration behind it
 * is not one: no cause could be named for it.
 */
function recorderLimited(report) {
  const facts = report?.coverageFacts ?? {};
  return [facts.instructionsElided, facts.instructionsWithheld, facts.delegationsUnlinked, facts.pairGaps, facts.carryCapped]
    .some((n) => isCount(n) && n > 0)
    || capByDeclaredGaps('complete', report, 'session') !== 'complete';
}

/**
 * M33 (C-06 "M33 session verdict"). Whether the session review completed, apart from the
 * recording's declared limits — one of `SESSION_REVIEW_COMPLETION`. `coverage` is the session coverage
 * the caller already reduced. Never upgrades: a report that declares its review anything but
 * `complete` stays `incomplete`, and so does one whose coverage is missing.
 *
 * Without coverage facts only a declaration can say the review completed: the report's own
 * `sessionReview`, or (as every producer before M33 wrote it) a coverage of `complete`.
 * A partial coverage must stand beside at least one declared recorder limit; one that none explains
 * is not shown to be the recording's, so the review is not shown to have completed.
 */
function sessionReviewOf(report, coverage) {
  const declared = Object.hasOwn(report ?? {}, 'sessionReview') ? report.sessionReview : undefined;
  if (declared !== undefined && declared !== REVIEW_COMPLETE) return REVIEW_INCOMPLETE;
  if (coverage !== 'complete' && coverage !== 'partial') return REVIEW_INCOMPLETE;
  if (readingCaps(report)) return REVIEW_INCOMPLETE;
  // A narrative proposal the code-review join could not evaluate (code-review.js): a check that
  // did not run on a session item, exactly as `readingCaps` treats its own rejections.
  if (report.rejectedNarrative !== undefined && report.rejectedNarrative !== 0) return REVIEW_INCOMPLETE;
  const facts = report.coverageFacts;
  if (facts != null ? !reviewedByFacts(facts) : declared !== REVIEW_COMPLETE && coverage !== 'complete')
    return REVIEW_INCOMPLETE;
  return coverage === 'complete' || recorderLimited(report) ? REVIEW_COMPLETE : REVIEW_INCOMPLETE;
}

/**
 * Recompute every status from the report's own coverage facts. Called last by every producer
 * and first by every renderer: a status can only ever be as clean as its coverage, whatever an
 * intermediate step wrote (audit A3 — the false-verdict class).
 */
export function honestStatuses(report) {
  const reviewScope = effectiveReviewScope(report);
  const derived = report.coverageFacts ? coverageFrom(report.coverageFacts) : (report.coverage ?? 'missing');
  // F117: never upgrade. `buildLedger` lowers a declaration it was handed for things the facts do
  // not count — a candidate no check could evaluate, an unknown relevance (D58: `readingCaps`) — so
  // recomputing from the facts alone turned its `partial` back into `complete`. The more
  // conservative of the two stands.
  // W3c-10: the declaration is read from before an earlier stage's unrecorded-write cap, which
  // that stage applied without the code review's placement; the cap is re-applied just below with
  // what is known now. See `coverageBeforeUnrecordedCap` for when that is the only lift allowed.
  const floor = moreConservative(derived, coverageBeforeUnrecordedCap(report));
  // F100, the last guard, scoped by channel (F116): a report that declares a gap cannot also
  // certify the review that gap is a loss of, whatever the facts it was handed failed to count.
  // A ceiling, never a floor — `missing` stays missing. Every CAPPING gap caps at least one of the
  // two, and `statusesFrom` reduces the overall verdict from the capped pair, so a report that
  // declares a capping gap never reads CLEAN overall. The one gap that can be declared without
  // capping is an `unrecorded_body` whose every write something else covered (F133).
  // D58: and the report's own rows, by the one rule `buildLedger` applies (`readingCaps`) — a
  // ceiling too, so an inconclusive row never lifts what anything else capped.
  const gapped = capByDeclaredGaps(floor, report, 'session', { unrecorded: false });
  const read = gapped === 'complete' && readingCaps(report) ? 'partial' : gapped;
  const sessionCov = capByDeclaredGaps(read, report, 'session');
  const codeCov = capByDeclaredGaps(report.codeCoverage ?? 'missing', report, 'code');
  // M33 (C-06): whether the session review completed is reduced beside the coverage, never from it
  // alone — a completed review of a recording with declared limits reads NO_FINDINGS, and a review
  // that did not complete reads UNCHECKED whatever the recording held.
  const sessionReview = sessionReviewOf(report, sessionCov);
  const reduced = statusesFrom(report.findings, sessionCov, codeCov, reviewScope, sessionReview);
  // M33 K (C-06 "decide_unsettled"): a DECIDE-bound claim whose check did not settle leaves the session
  // short of CLEAN — NO_FINDINGS, never a finding — reduced as a whole or by part.
  const whole = reduced.sessionStatus === CLEAN && unsettledDecideClaims(report).length
    ? statusesFrom(report.findings, sessionCov, codeCov, reviewScope, sessionReview, NO_FINDINGS) : reduced;
  // M33 (C-06 "M33 per-part verdicts"): a session whose root events record their human turns is
  // reduced by part, and its session status is the parts' — for a session-only review and, through
  // the aggregate, for a combined one; `codeStatus` keeps its own table. The whole-session reduction
  // above stays the floor it is checked against (`sessionParts`): the parts never read CLEAN where it
  // does not, and a session with no part at all keeps it unchanged.
  const byParts = sessionParts(report, { sessionCov, sessionReview, reviewScope, wholeStatus: whole.sessionStatus });
  const statuses = byParts
    ? statusesFrom(report.findings, sessionCov, codeCov, reviewScope, sessionReview, byParts.status) : whole;
  return { reviewScope, coverage: sessionCov, coverageBeforeUnrecorded: read, codeCoverage: codeCov, sessionReview,
    ...statuses,
    parts: byParts?.parts ?? [], sessionWideLimits: byParts?.sessionWide ?? null, partCounts: byParts?.counts ?? null };
}

/**
 * W3c-10 / F133. The session coverage a report declared, from before an earlier stage's
 * unrecorded-write cap.
 *
 * `runReview` reduces its report before any code review has run, so no unrecorded write can be
 * covered by a diff yet, and every one inside the repository caps. The code review is joined
 * afterwards (code-review.js), and it is the first place the placement is known — but a `partial`
 * is a single word, and the join cannot tell the cap from a real shortfall. So every producer
 * publishes `coverageBeforeUnrecorded` beside `coverage`, and this reads it back.
 *
 * It is an upgrade, so it is allowed in exactly one shape: `coverage` is `partial`, the value it
 * was capped from is `complete`, and this report's own unrecorded writes, classified with NO
 * placement at all, cap — i.e. the cap alone explains the partial. Anything else returns
 * `coverage` untouched: a report somebody lowered by hand, a value that is `missing`, or a partial
 * that no unrecorded write could have caused. The cap is then re-applied by the caller with the
 * placement it knows, so the lift can only ever end where that classification puts it.
 */
export function coverageBeforeUnrecordedCap(report) {
  const coverage = report?.coverage;
  if (coverage !== 'partial' || report?.coverageBeforeUnrecorded !== 'complete') return coverage;
  const explained = declaredGaps(report).some((gap) => gap.code === 'unrecorded_body'
    && gapCaps(gap, 'session', { pr: report.pr ?? null, placed: null }));
  return explained ? 'complete' : coverage;
}

// ---- unrecorded writes (W3c-10 / F133) ---------------------------------------------------------

/** What covered an unrecorded write, when something did. Closed; a write with neither caps. */
export const UNRECORDED_COVER = Object.freeze(['diff', 'outside']);

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * Classify every write one `unrecorded_body` gap declares by what covered it. The one function
 * `buildLedger`, `honestStatuses`, the code-review join and the renderer all use.
 *
 *   diff     — reserved for a future verified equivalence between this exact historical write
 *              and the immutable head. There is no such proof in today's unrecorded-body gap.
 *   outside  — the recorder marked the path outside the repository (the adapter's
 *              `outsideRepository`, from the slicer's `external`). It is not code under review.
 *   (none)   — every unrecorded repository write, including one to a placed complete PR file.
 *              A later write may have replaced its missing historical body. It caps.
 *
 * Fails closed. A write this code cannot read is capping; a declaration that counts more writes
 * than it lists caps the remainder; a declaration with no count caps at least one.
 */
export function unrecordedCover(gap, { pr = null, placed = null } = {}) {
  // Preserve the call shape used by report joins and renderers. Their PR placement is useful
  // for code coverage, but contains no proof of this write's body or its later survival.
  void pr; void placed;
  const listed = (Array.isArray(gap?.writes) ? gap.writes : []).filter((w) => w !== null && typeof w === 'object');
  const byCover = { diff: 0, outside: 0, none: 0 };
  const writes = listed.map((write) => {
    const cover = write.outsideRepository === true ? 'outside' : null;
    byCover[cover ?? 'none']++;
    return { eventId: write.eventId ?? null, path: write.path ?? null, cover };
  });
  // The declared count is the claim; the list is the evidence for each write in it.
  const counted = isCount(gap?.count);
  const unlisted = counted ? Math.max(0, gap.count - listed.length) : 0;
  byCover.none += unlisted;
  const capping = counted ? byCover.none : Math.max(1, byCover.none);
  return { writes, byCover, capping, counted, total: counted ? Math.max(gap.count, listed.length) : null };
}

// Weakest first. An unrecognised value ranks below all three: a coverage no rule produces cannot
// be trusted to be as good as one that a rule did.
const COVERAGE_RANK = Object.freeze({ missing: 0, partial: 1, complete: 2 });
const coverageRank = (coverage) => COVERAGE_RANK[coverage] ?? -1;

/** The more conservative of the recomputed coverage and the one already on the report. An absent
 *  declaration lowers nothing — only a coverage somebody actually stated can. */
function moreConservative(derived, declared) {
  if (declared == null) return derived;
  return coverageRank(declared) < coverageRank(derived) ? declared : derived;
}

/**
 * Every gap declared anywhere on a report: its own gap list and the session's adapter losses.
 * The adapter's list rides on `report.session`, and `buildLedger` publishes only the delegation
 * ones on `report.gaps`, so reading `gaps` alone would miss a clipped body or an elided ask.
 */
function declaredGaps(report) {
  const list = (value) => (Array.isArray(value) ? value.filter((g) => g !== null && typeof g === 'object') : []);
  return [...list(report?.gaps), ...list(report?.session?.adapterGaps)];
}

// C-03 channels that only a session recording has. `code` is not among them: it is also the
// channel of a PR's changed files, and which of the two a code-channel gap is a loss of is what
// its scope says (see `gapCaps`).
const SESSION_CHANNELS = Object.freeze(['instructions', 'commentary', 'actions', 'observations', 'children', 'identity']);

/**
 * Which review a declared gap is a loss of (F116: a gap caps the coverage of its own channel).
 *
 * C-03's channel names WHICH text was lost; its scope names WHOSE — a session recording or the
 * PR. The code review reads the PR's diff from git and never the recording, so only a PR-scoped
 * loss on the `code` channel (a changed file it could not read) is a loss of the code review. A
 * recorder's cut in a session write body is also on the `code` channel, but scoped to the
 * session: it is text the SESSION review could not read, and a complete code review stays
 * complete beside it (code-review.test.js R4). A gap this code cannot place — no channel, a
 * channel C-03 does not define, a code-channel gap with no scope — caps both, because an
 * unplaceable loss must still stop a CLEAN on whichever review it belongs to.
 *
 * W3c-10 / F133: an `unrecorded_body` (code/session) caps the session while one of its
 * writes is internal to the repository; PR path placement cannot prove a historical body.
 * `unrecordedCover` decides this consistently for the reducer and renderer.
 */
function gapCaps(gap, side, context = {}) {
  if (gap.code === 'unrecorded_body' && gap.channel === 'code' && gap.scope === 'session')
    return side === 'session' && unrecordedCover(gap, context).capping > 0;
  if (gap.channel === 'code' && gap.scope === 'pr') return side === 'code';
  if (SESSION_CHANNELS.includes(gap.channel) || (gap.channel === 'code' && gap.scope === 'session'))
    return side === 'session';
  return true;
}

/** What `unrecordedCover` needs from a report: its PR, and what the joined code review placed.
 *  A report no code review was joined to has no placement, so nothing in it is covered by a diff. */
const coverContext = (report) => ({ pr: report?.pr ?? null,
  placed: Array.isArray(report?.codeCoverageFacts?.placed) ? report.codeCoverageFacts.placed : null });

/** A declared gap caps a complete coverage of its own side at partial. Anything already short of
 *  complete stays. `unrecorded: false` leaves `unrecorded_body` out, for the value a later stage
 *  re-caps with better placement (`coverageBeforeUnrecorded`). */
function capByDeclaredGaps(coverage, report, side, { unrecorded = true } = {}) {
  const context = coverContext(report);
  return coverage === 'complete' && declaredGaps(report).some((gap) =>
    (unrecorded || gap.code !== 'unrecorded_body') && gapCaps(gap, side, context)) ? 'partial' : coverage;
}

/**
 * F164/M29c. The owning session is part of loss identity: two child recordings can declare the
 * same code/channel/scope and local event IDs without describing one loss. A source-local ordinal
 * distinguishes separate eventless losses from that same recording. A copied/reloaded declaration
 * preserves both fields; mutable note/count prose never enters the identity. Legacy gaps without
 * ordinals cannot erase a new, ordinal-bearing loss.
 */
export function gapKey(gap) {
  const ids = Array.isArray(gap?.eventIds) ? gap.eventIds.map(String).sort() : [];
  const ordinal = ids.length === 0 && Number.isSafeInteger(gap?.lossOrdinal)
    && gap.lossOrdinal >= 0 ? gap.lossOrdinal : null;
  // OWNER DECISION B (2026-10-01): a located instructions gap whose note is one of the adapter's CLOSED instruction
  // notes (never mutable prose) carries that cause in its identity. Since the capped, stripped and shortened asks are
  // named like the redaction-withheld ones, one ask can be named by two of them, and two causes are two losses.
  const cause = ids.length > 0 && gap?.channel === 'instructions' && CLOSED_INSTRUCTION_NOTES.includes(gap.note)
    ? gap.note : null;
  return JSON.stringify([gap?.code ?? null, gap?.channel ?? null, gap?.scope ?? null,
    gap?.sessionKey ?? null, ids, ordinal, ...(cause === null ? [] : [cause])]);
}
const CLOSED_INSTRUCTION_NOTES = Object.freeze(Object.values(INSTRUCTION_GAP_NOTES));

/**
 * The one reduction (F63): the PUBLISHED finding list, split by `origin` — a finding's capability
 * is its identity, not the list a caller happened to hand it in on — against each capability's
 * coverage. `honestStatuses` and `buildLedger` both call this and nothing else, so they cannot
 * disagree about a report's findings.
 */
function statusesFrom(findings = [], sessionCov, codeCov, reviewScope = 'combined', sessionReview = REVIEW_INCOMPLETE,
  byParts = null) {
  const session = (findings ?? []).filter((f) => f?.origin !== 'code-review');
  const code = (findings ?? []).filter((f) => f?.origin === 'code-review');
  // M33 (C-06): the session by the session verdict table, the code by the original table. A
  // session-only review's aggregate is its session status; a combined one is the first status in
  // STATUS_PRECEDENCE that either is — so it can never be cleaner than its weakest capability.
  // M33 (C-06 "M33 per-part verdicts"): `byParts`, when the session was reduced by part, is its
  // session status, and the aggregate is reduced from it by the same rule.
  const sessionStatus = PUBLIC_STATUSES.includes(byParts) ? byParts : reduceSessionStatus(session, sessionCov, sessionReview);
  const codeStatus = reduceStatus(code, codeCov);
  return {
    sessionStatus,
    codeStatus,
    reviewStatus: reviewScope === 'session-only' ? sessionStatus : aggregateStatus([codeStatus, sessionStatus]),
  };
}

/** The original C-06 table, verbatim — `codeStatus` keeps it (M33). Coverage is
 *  complete/partial/missing. It never reads NO_FINDINGS. */
export function reduceStatus(findings, coverage) {
  const complete = coverage === 'complete';
  if (findings.some((f) => f?.status === DECIDE)) return DECIDE;
  if (findings.some((f) => f?.status === FYI)) return complete ? FYI : UNCHECKED;
  return complete ? CLEAN : UNCHECKED;
}

/**
 * The M33 session verdict table (C-06, owner decision 2026-09-29), verbatim. `review` is one of
 * SESSION_REVIEW_COMPLETION and `coverage` one of complete/partial/missing; anything else fails closed.
 *
 *   a supported DECIDE                                      → DECIDE
 *   no DECIDE, and the review not complete or coverage missing → UNCHECKED (FYI items retained)
 *   some FYI, review complete                                → FYI
 *   none, review complete, coverage complete                 → CLEAN
 *   none, review complete, coverage partial                  → NO_FINDINGS
 */
export function reduceSessionStatus(findings, coverage, review) {
  const list = Array.isArray(findings) ? findings : [];
  if (list.some((f) => f?.status === DECIDE)) return DECIDE;
  if (review !== REVIEW_COMPLETE || (coverage !== 'complete' && coverage !== 'partial')) return UNCHECKED;
  if (list.some((f) => f?.status === FYI)) return FYI;
  return coverage === 'complete' ? CLEAN : NO_FINDINGS;
}

/** C-06: a combined review's one status — the first in STATUS_PRECEDENCE that any of `statuses` is.
 *  A value outside PUBLIC_STATUSES, or nothing at all, fails closed to UNCHECKED. */
export function aggregateStatus(statuses) {
  const list = Array.isArray(statuses) ? statuses : [];
  if (!list.length || list.some((s) => !PUBLIC_STATUSES.includes(s))) return UNCHECKED;
  return STATUS_PRECEDENCE.find((status) => list.includes(status));
}

// ---- per-part verdicts (M33, C-06 "M33 per-part verdicts") ------------------------------------

/**
 * C-06 "M33 per-part verdicts". The one entry that is no part: root events that recorded no turn,
 * events whose part cannot be named (a transferred child no verified spawn link places), findings
 * citing none of a part's events, and gaps that name no event. Listed once and blamed on no part.
 */
export const SESSION_WIDE = 'session-wide';

/**
 * Why a part (or the session-wide entry) is not CLEAN. Closed; never built from text, so a per-reason rate stays
 * computable.
 *   finding_decide, finding_fyi  a published session finding cites its events, DECIDE / FYI
 *   decide_unsettled             (M33 K) a claim citing the result that contradicts it — DECIDE-bound — cites
 *                                its events (its stated or contradictedBy event), and that claim's challenge
 *                                ended unsettled or unexecuted: withheld, never published, and never CLEAN.
 *                                M33 H: a helper's own statement is FYI-bound, never DECIDE-bound: not this (code's
 *                                record mark, `HELPER_STATEMENT_MARK`); the parent's relay of it is its own claim.
 *                                M33 N: and a session-only forbidden edit (its instruction's and its action's events),
 *                                unless code proved its change undone in the turn (`FORBIDDEN_EDIT_REVERTED_MARK`)
 *   window_incomplete            a review window holding any of its events is incomplete
 *   proposal_unreadable          such a window's answer holds a proposal code could not read — after the
 *                                window's one re-ask (session-only), or as the code-review join read it
 *   reading_capped               a rejection that is not a withheld one (a check that did not run) names
 *                                its events, or (combined) a decision on its events has an unknown relevance
 *   review_unattributed          a check that did not run names no part, so no part is shown to have
 *                                completed — or its reviewable events are in no recorded window
 *   no_reviewable_event          it has no instruction, commentary, action or result to review
 *   gap_declared                 a capping declared gap names its events, or a sequence range over them
 *   instruction_omitted          a human instruction of it was elided or withheld (a recorder limit)
 *   delegation_unlinked          a hand-off of it has no verified child evidence (a recorder limit)
 *   gap_unplaced                 (session-wide) a capping declared limit names no recorded event
 *   limit_unattributed           (session-wide) the whole-session reduction has a limit no entry explains
 */
export const PART_REASONS = Object.freeze(['finding_decide', 'finding_fyi', 'decide_unsettled', 'window_incomplete',
  'proposal_unreadable', 'reading_capped', 'review_unattributed', 'no_reviewable_event', 'gap_declared', 'instruction_omitted',
  'delegation_unlinked', 'gap_unplaced', 'limit_unattributed']);
const [FINDING_DECIDE, FINDING_FYI, DECIDE_UNSETTLED, WINDOW_SHORT, PROPOSAL_UNREADABLE, READING_CAPPED, REVIEW_UNATTRIBUTED,
  NO_REVIEWABLE_EVENT, GAP_DECLARED, INSTRUCTION_OMITTED, DELEGATION_UNLINKED, GAP_UNPLACED, LIMIT_UNATTRIBUTED] = PART_REASONS;
/** The part reasons that mean its REVIEW did not complete. */
export const PART_REVIEW_REASONS = Object.freeze([WINDOW_SHORT, PROPOSAL_UNREADABLE, READING_CAPPED, REVIEW_UNATTRIBUTED,
  NO_REVIEWABLE_EVENT]);
/** The part reasons that mean its COVERAGE is partial: a declared recorder limit names it. */
export const PART_COVERAGE_REASONS = Object.freeze([GAP_DECLARED, INSTRUCTION_OMITTED, DELEGATION_UNLINKED, GAP_UNPLACED,
  LIMIT_UNATTRIBUTED]);
/** The causes a NO_FINDINGS reduced by part is shown with (C-06): how many parts were fully checked
 *  (review complete, coverage complete), partial (review complete, coverage partial) and unchecked; and,
 *  apart from the parts (review-WP2), whether the session-wide entry — in no part — was unchecked (0 or 1).
 *  M33 K: `parts_decide_unsettled` — review complete, coverage complete, and a DECIDE-bound claim citing it
 *  ended unsettled or unexecuted (`decide_unsettled`): the parts that fix moved off CLEAN. A part is counted
 *  under exactly one of the four part causes. */
export const PART_CAUSES = Object.freeze(['parts_fully_checked', 'parts_partial', 'parts_decide_unsettled', 'parts_unchecked',
  'session_wide_unchecked']);
const PART_COUNT_KEYS = Object.freeze(['findings', 'decisions', 'windows', 'windowsIncomplete', 'gaps']);
const REVIEWABLE_KINDS = Object.freeze(['instruction', 'commentary', 'invocation', 'observation']);
// C-02 `turn` of a root event, as the adapter records it ('T<n>'). A transferred child's own turn is
// named under its child prefix and is never a part.
const ROOT_TURN = /^T(?:0|[1-9]\d{0,14})$/;
const byTurn = (a, b) => Number(a.slice(1)) - Number(b.slice(1));
const listOf = (value) => (Array.isArray(value) ? value : []);
// The bound a walk over a model-shaped record keeps (run-review.js RECORD_LIMITS: depth 32).
const NAMED_EVENTS_DEPTH = 32;

/**
 * C-06 "M33 per-part verdicts": the part of every event of `session`, by id — `'T<n>'` or SESSION_WIDE.
 * A root event (no `childId`) is in its own recorded turn. A transferred child's event is in the part
 * its child's verified spawn assignment is in — that assignment event's own part, so a grandchild's
 * follows its parent's hand-off. Only recorded turns and recorded links are read, never an id, an
 * order or a time: a root event with no turn, a child with no verified spawn link (a follow-up spawned
 * nothing), spawn links in two parts, and a cycle of hand-offs are all session-wide.
 */
export function partAttribution(session) {
  return attributionOf(session).partOf;
}

/**
 * Review-WP (C-06 "M33 per-part verdicts"): the part of each transferred child's session, by its
 * `sessionKey` — the part its verified spawn assignment is in, exactly as `partAttribution` places the
 * child's events, so a loss the child declared without naming one of its events is its spawning part's.
 * Only a verified spawn link (never a follow-up) names a child session; a key two such links place in
 * different parts, and the root session's own key, are in no part (SESSION_WIDE or absent).
 */
export function childSessionParts(session) {
  return attributionOf(session).sessionPartOf;
}

function attributionOf(session) {
  const byId = new Map();
  for (const event of listOf(session?.events))
    if (event !== null && typeof event === 'object' && typeof event.id === 'string' && !byId.has(event.id))
      byId.set(event.id, event);
  const links = listOf(session?.children).filter((link) => link !== null && typeof link === 'object');
  const partOf = new Map(), childPart = new Map(), resolving = new Set();
  const ofChild = (childId) => {
    if (childPart.has(childId)) return childPart.get(childId);
    if (resolving.has(childId)) return SESSION_WIDE;
    resolving.add(childId);
    const spawns = links.filter((link) => link.state === 'verified' && link.childId === childId
      && link.relation !== 'followup' && typeof link.assignmentEvent === 'string');
    const parts = new Set(spawns.map((link) => ofEvent(link.assignmentEvent)));
    const part = parts.size === 1 ? [...parts][0] : SESSION_WIDE;
    resolving.delete(childId);
    childPart.set(childId, part);
    return part;
  };
  const ofEvent = (id) => {
    if (partOf.has(id)) return partOf.get(id);
    const event = byId.get(id);
    if (!event) return SESSION_WIDE;
    const childId = event.childId ?? null;
    // C-03 M33 P: a helper's event of a segment another assignment delivered (a follow-up or a message, recorded as
    // `deliveredBy`) is in that delivering event's part — the request that sent it — wherever it is placed.
    const deliveredBy = childId !== null && typeof event.deliveredBy === 'string' && event.deliveredBy !== id
      && byId.has(event.deliveredBy) ? event.deliveredBy : null;
    if (deliveredBy !== null) partOf.set(id, SESSION_WIDE);   // a cycle of deliveries resolves session-wide
    const part = deliveredBy !== null ? ofEvent(deliveredBy)
      : childId === null ? (typeof event.turn === 'string' && ROOT_TURN.test(event.turn) ? event.turn : SESSION_WIDE)
      : typeof childId === 'string' && childId ? ofChild(childId) : SESSION_WIDE;
    partOf.set(id, part);
    return part;
  };
  for (const id of byId.keys()) ofEvent(id);
  const sessionPartOf = new Map();
  for (const link of links) {
    if (link.state !== 'verified' || link.relation === 'followup' || typeof link.sessionKey !== 'string'
        || !link.sessionKey || typeof link.childId !== 'string' || !link.childId) continue;
    const part = ofChild(link.childId);
    sessionPartOf.set(link.sessionKey, sessionPartOf.has(link.sessionKey) && sessionPartOf.get(link.sessionKey) !== part
      ? SESSION_WIDE : part);
  }
  if (typeof session?.sessionKey === 'string') sessionPartOf.delete(session.sessionKey);
  return { partOf, sessionPartOf };
}

/** Every event id a rejected proposal names: each receipt's `eventId` and each cited action, at any
 *  depth up to the record bound. A model-shaped value; nothing in it is trusted but the ids. */
function namedEvents(value, depth = 0, out = new Set()) {
  if (depth > NAMED_EVENTS_DEPTH || value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) { for (const item of value) namedEvents(item, depth + 1, out); return out; }
  if (typeof value.eventId === 'string') out.add(value.eventId);
  for (const action of listOf(value.actions)) if (typeof action === 'string') out.add(action);
  for (const item of Object.values(value)) namedEvents(item, depth + 1, out);
  return out;
}

/** The events a declared gap names: its `eventIds`, and every event whose sequence lies in its
 *  `fromSequence`..`untilSequence` range when it states one. An `unrecorded_body` names only the writes
 *  that cap (`unrecordedCover`), and one counting more writes than it lists is also unplaced. */
function gapEvents(gap, session, context) {
  let ids = listOf(gap.eventIds).filter((id) => typeof id === 'string');
  let unplaced = false;
  if (gap.code === 'unrecorded_body' && gap.channel === 'code' && gap.scope === 'session') {
    const cover = unrecordedCover(gap, context);
    const outside = new Set(cover.writes.filter((w) => w.cover !== null).map((w) => w.eventId));
    ids = ids.filter((id) => !outside.has(id));
    unplaced = isCount(gap.count) && gap.count > cover.writes.length;
  }
  const from = gap.fromSequence, until = gap.untilSequence;
  if (Number.isSafeInteger(from) || Number.isSafeInteger(until)) {
    const low = Number.isSafeInteger(from) ? from : -Infinity, high = Number.isSafeInteger(until) ? until : Infinity;
    for (const event of listOf(session?.events))
      if (Number.isSafeInteger(event?.sequence) && event.sequence >= low && event.sequence <= high && typeof event.id === 'string')
        ids.push(event.id);
  }
  return { ids, unplaced };
}

/** A window record is complete exactly as run-review.js counts it (`windowCompletion`, `windowState`). The session page
 *  reads it to say an incomplete window in steps (story /14, D77 C: a step is one of your requests, held by one or more
 *  windows). */
export const windowRecordComplete = (w) => w?.failure === null && w.groundingComplete === true && w.challenge?.complete === true;

const hasAny = (reasons, subset) => [...reasons].some((reason) => subset.includes(reason));
const FINDING_REASONS = Object.freeze([FINDING_DECIDE, FINDING_FYI]);
const ordered = (reasons) => PART_REASONS.filter((reason) => reasons.has(reason));

/**
 * One entry's status by the M33 session table (`reduceSessionStatus`, the one the whole session is
 * reduced by), restricted to it: its findings, a review that completed unless a review reason stands,
 * a coverage that is partial when a recorder limit names it. `reviewable === 0` is no completed review.
 */
function entryStatus(findings, reasons, reviewable = 1) {
  const review = hasAny(reasons, PART_REVIEW_REASONS) || reviewable === 0 ? REVIEW_INCOMPLETE : REVIEW_COMPLETE;
  // M33 K: an entry a DECIDE-bound check left unsettled reads as a partial one — NO_FINDINGS when nothing
  // else is found, never CLEAN and never DECIDE: no finding is made of it.
  return reduceSessionStatus(findings, hasAny(reasons, PART_COVERAGE_REASONS) || reasons.has(DECIDE_UNSETTLED)
    ? 'partial' : 'complete', review);
}
/** An entry's status as its closed reasons alone state it — for a declaration with no findings to read. */
const statusFromReasons = (reasons) => entryStatus(reasons.has(FINDING_DECIDE) ? [{ status: DECIDE }]
  : reasons.has(FINDING_FYI) ? [{ status: FYI }] : [], reasons);
/** Never upgrade: the first in STATUS_PRECEDENCE of the statuses given. */
const conservative = (...statuses) => aggregateStatus(statuses);
const reviewed = (part) => !part.reasons.some((reason) => PART_REVIEW_REASONS.includes(reason));
const limitedBy = (reasons) => [...reasons].some((reason) => reason !== FINDING_DECIDE && reason !== FINDING_FYI);

/**
 * C-06 "M33 per-part verdicts", verbatim: DECIDE if any part is DECIDE (and, since a finding is never
 * suppressed, if any session finding is, the session-wide entry's included); else FYI if any part —
 * or the session-wide entry, reduced by the same table — is FYI; else CLEAN if every part is CLEAN and
 * there is no session-wide limit; else NO_FINDINGS when at least one part's review completed; else
 * UNCHECKED. `parts` are `{ status, reasons }`; `sessionWide` is `{ status, limited }`.
 */
export function reducePartsStatus(parts, sessionWide, findings = []) {
  const list = listOf(parts);
  const statuses = list.map((part) => part?.status);
  if (listOf(findings).some((f) => f?.origin !== 'code-review' && f?.status === DECIDE)
      || statuses.includes(DECIDE) || sessionWide?.status === DECIDE) return DECIDE;
  if (statuses.includes(FYI) || sessionWide?.status === FYI) return FYI;
  if (list.length && statuses.every((status) => status === CLEAN) && sessionWide?.limited === false) return CLEAN;
  if (list.some((part) => Array.isArray(part?.reasons) && reviewed(part) && part.status !== UNCHECKED)) return NO_FINDINGS;
  return UNCHECKED;
}

/**
 * `PART_CAUSES` counts of the published parts. Review-WP: the session-wide entry has a review completeness
 * of its own — when a check on its events did not complete (a window holding any of them is incomplete, a
 * capping rejection names them, or they are in no window), it is unchecked, so a NO_FINDINGS is never
 * shown as every entry checked while the review did not complete. Review-WP2: it is counted apart from the
 * parts, as `session_wide_unchecked`, never folded into `parts_unchecked` — it is no part.
 */
function partCauseCounts(parts, sessionWide = null) {
  const done = parts.filter(reviewed);
  const limited = (part) => part.reasons.some((reason) => PART_COVERAGE_REASONS.includes(reason));
  const partial = done.filter(limited).length;
  const unsettled = done.filter((part) => !limited(part) && part.reasons.includes(DECIDE_UNSETTLED)).length;
  return { parts_fully_checked: done.length - partial - unsettled, parts_partial: partial,
    parts_decide_unsettled: unsettled, parts_unchecked: parts.length - done.length,
    session_wide_unchecked: Array.isArray(sessionWide?.reasons) && !reviewed(sessionWide) ? 1 : 0 };
}

/** M33 K: how many DECIDE-bound claims of the report ended unsettled or unexecuted (`decide_unsettled`). */
export const decideUnsettledCount = (report) => unsettledDecideClaims(report).length;

/** The challenge outcomes of a DECIDE-bound claim that is withheld without a completed check (C-06 D58
 *  words, challenge.js `rejected`): every pass voted and nothing settled, or some pass never voted. A
 *  resolved refutation is a completed check; a proposal no challenge was asked about is not here. */
export const UNSETTLED_CHALLENGE = Object.freeze(['unsettled', 'unreviewed_scope']);

/**
 * M33 K (C-06 "decide_unsettled"). Every DECIDE-bound claim of the review's windows — a claim citing the
 * result that contradicts it (run-review.js `decideBound`) — whose own challenge did not survive and ended
 * unsettled or unexecuted, by the events it cites: `[stated, contradictedBy]` event ids. Read from the
 * window records' challenge results, exactly as the challenge recorded them. M33 C recheck 2: and every joint
 * `claim_contradicted` session finding of the combined route (`report.codeChallenges`, item type
 * `session-finding`) that ended the same way, by the events its receipts cite — a joint contradiction whose check
 * did not settle is never read as clean either. M33 H: a helper's own statement is not DECIDE-bound and is not here —
 * read from code's mark on the record (`HELPER_STATEMENT_MARK`), never from the candidate, so a report saved without its
 * recording reads the same. M33 N: and every session-only forbidden edit (item type `forbidden-edit`) that ended the same
 * way, by its instruction's and its action's events, unless code's mark says its change was undone in the same turn.
 */
function unsettledDecideClaims(report) {
  const out = [];
  // M33 H (C-06 "M33 helper-internal claims"): a contradicted statement that is a helper's own is FYI-bound, never
  // DECIDE-bound — upheld it would publish FYI — so its unsettled check is withheld and counted as before and holds
  // nothing off CLEAN. M33 H repair: whose statement it is, is code's mark on the record (`HELPER_STATEMENT_MARK`,
  // set from the recording when the record was built), so a report saved without its recording reads exactly as the
  // live run did; a result without the mark is DECIDE-bound — a re-reading is never cleaner.
  const helperSaid = (result) => result[HELPER_STATEMENT_MARK] === true;
  const unsettledOf = (record, type) => {
    const reasonOf = new Map(listOf(record?.rejected).filter((r) => typeof r?.key === 'string')
      .map((r) => [r.key, r.reason]));
    return listOf(record?.results).filter((result) => result?.type === type && result.survived !== true
      && result.candidate !== null && typeof result.candidate === 'object'
      && UNSETTLED_CHALLENGE.includes(reasonOf.get(result.key)));
  };
  for (const window of listOf(report?.windowResults)) {
    for (const result of unsettledOf(window?.challenge, 'claim')) {
      const claim = result.candidate;
      if (!claim.contradictedBy || helperSaid(result)) continue;
      out.push([claim.stated?.eventId, claim.contradictedBy?.eventId].filter((id) => typeof id === 'string'));
    }
    // M33 N (C-06 "M33 forbidden edits"): a forbidden edit is DECIDE-bound — by its instruction's and its action's
    // events — unless code proved the change undone in the same turn (FORBIDDEN_EDIT_REVERTED_MARK, code's mark on the
    // record): upheld that one publishes FYI, so its unsettled check holds nothing off CLEAN.
    for (const result of unsettledOf(window?.challenge, FORBIDDEN_EDIT_ITEM_TYPE)) {
      if (result[FORBIDDEN_EDIT_REVERTED_MARK] === true) continue;
      const edit = result.candidate;
      out.push([edit.instruction?.eventId, edit.violation?.eventId].filter((id) => typeof id === 'string'));
    }
  }
  for (const record of listOf(report?.codeChallenges)) {
    for (const result of unsettledOf(record, 'session-finding')) {
      const finding = result.candidate;
      if (finding.kind !== 'claim_contradicted' || helperSaid(result)) continue;
      out.push(listOf(finding.receipts).map((r) => r?.eventId).filter((id) => typeof id === 'string'));
    }
  }
  return out;
}

const isPartCounts = (counts, keys) => counts !== null && typeof counts === 'object' && !Array.isArray(counts)
  && keys.every((key) => isCount(counts[key]));
const closedReasons = (reasons) => Array.isArray(reasons) && reasons.every((r) => PART_REASONS.includes(r))
  && new Set(reasons).size === reasons.length;
/** A declared part in the closed shape, or null. */
function declaredPart(part) {
  return part !== null && typeof part === 'object' && typeof part.part === 'string' && ROOT_TURN.test(part.part)
    && PUBLIC_STATUSES.includes(part.status) && closedReasons(part.reasons) && isPartCounts(part.counts, PART_COUNT_KEYS)
    ? part : null;
}
function declaredSessionWide(entry) {
  return entry !== null && typeof entry === 'object' && PUBLIC_STATUSES.includes(entry.status)
    && typeof entry.limited === 'boolean' && closedReasons(entry.reasons)
    && isPartCounts(entry.counts, ['events', ...PART_COUNT_KEYS]) ? entry : null;
}

/**
 * Settle the parts and the session-wide entry from their reasons, lowered by any declaration an
 * earlier reading made of the same part (never upgraded), and reduce the session status from them.
 * `wholeStatus` is the whole-session reduction of the same report: the parts never read CLEAN where
 * it does not — any limit none of them explains is a session-wide one.
 */
function settleParts({ parts, sessionWide, findings, declared, declaredWide, sessionCov, sessionReview, wholeStatus }) {
  // What an earlier reading declared of an entry: its limits always stand (never upgraded). Its finding
  // reasons stand only where this reading has no findings of its own to read — a report saved without
  // its recording; otherwise the published finding list decides, as it does for the whole session.
  // `prior` is undefined when nothing was declared of it, and null when the declaration is outside the
  // closed shape: no such declaration can be trusted to be clean, so it is a review not shown to have run.
  const lowerBy = (entry, prior, unshaped) => {
    if (prior === null) entry.reasons.add(unshaped);
    const kept = (prior?.reasons ?? []).filter((reason) => entry.findings === null || !FINDING_REASONS.includes(reason));
    for (const reason of kept) entry.reasons.add(reason);
    if (prior == null) return CLEAN;
    return entry.findings !== null && (prior.status === DECIDE || prior.status === FYI) ? statusFromReasons(new Set(kept))
      : prior.status;
  };
  const priorOf = new Map(parts.map((part) => [part, lowerBy(part, declared?.has(part.part) ? declared.get(part.part)
    : undefined, REVIEW_UNATTRIBUTED)]));
  const priorWide = lowerBy(sessionWide, declaredWide, LIMIT_UNATTRIBUTED);
  // A check that did not complete, by the whole-session rule, that no entry explains names no part:
  // no part is shown to have completed. A session coverage that is missing — nobody showed the session
  // was reviewed at all — shows no part completed either.
  const coverageMissing = sessionCov !== 'complete' && sessionCov !== 'partial';
  if (coverageMissing || (sessionReview !== REVIEW_COMPLETE
      && ![...parts, sessionWide].some((entry) => hasAny(entry.reasons, PART_REVIEW_REASONS))))
    for (const part of parts) if (!hasAny(part.reasons, PART_REVIEW_REASONS)) part.reasons.add(REVIEW_UNATTRIBUTED);
  // Own status: from its findings when they were read, otherwise from its closed reasons alone.
  const own = (entry) => (entry.findings ? entryStatus(entry.findings, entry.reasons, entry.statusReviewable ?? entry.reviewable)
    : statusFromReasons(entry.reasons));
  for (const part of parts) {
    let status = conservative(own(part), priorOf.get(part));
    // Whatever lowered it to UNCHECKED is a review that did not complete, and is counted as one.
    if (status === UNCHECKED && !hasAny(part.reasons, PART_REVIEW_REASONS)) {
      part.reasons.add(REVIEW_UNATTRIBUTED);
      status = conservative(status, own(part));
    }
    part.status = status;
  }
  const settleWide = () => {
    sessionWide.status = conservative(own(sessionWide), priorWide);
    sessionWide.limited = limitedBy(sessionWide.reasons) || declaredWide?.limited === true;
  };
  settleWide();
  const view = () => parts.map((part) => ({ status: part.status, reasons: ordered(part.reasons) }));
  let status = reducePartsStatus(view(), sessionWide, findings);
  if (status === CLEAN && wholeStatus !== CLEAN) {
    sessionWide.reasons.add(LIMIT_UNATTRIBUTED);
    settleWide();
    status = reducePartsStatus(view(), sessionWide, findings);
  }
  return status;
}

/** The published shape of settled parts: `{ part, status, reasons, counts }`, plus the session-wide
 *  entry `{ status, limited, reasons, counts }` and the NO_FINDINGS part causes. Counts only. */
function publishParts(parts, sessionWide, status) {
  const published = parts.map((part) => ({ part: part.part, status: part.status, reasons: ordered(part.reasons),
    counts: Object.fromEntries(PART_COUNT_KEYS.map((key) => [key, part.counts[key]])) }));
  const wide = { status: sessionWide.status, limited: sessionWide.limited, reasons: ordered(sessionWide.reasons),
    counts: { events: sessionWide.counts.events, ...Object.fromEntries(PART_COUNT_KEYS.map((key) => [key, sessionWide.counts[key]])) } };
  return { status, parts: published, sessionWide: wide, counts: partCauseCounts(published, wide) };
}

/**
 * C-06 "M33 per-part verdicts": the session reduced by part, or null when it cannot be — no recorded
 * turn names a part, or no window was recorded (a reading that is not a review, `buildLedger`); the
 * whole-session reduction then stands unchanged. A missing session coverage shows no part completed.
 *
 * With the recording on the report, every part is recomputed from the report's own facts; a part an
 * earlier reading declared (`report.parts`) can only lower it. A report saved without its recording
 * reduces from its declared parts, each lowered to what its closed reasons state — a declaration
 * outside the closed shape is no declaration, and the whole-session reduction stands.
 */
function sessionParts(report, { sessionCov, sessionReview, reviewScope, wholeStatus }) {
  if (report?.session == null) return partsDeclared(report, { sessionCov, sessionReview, wholeStatus });
  if (!listOf(report.session.events).length || !Array.isArray(report.windowResults)) return null;
  return partsFromSession(report, { sessionCov, sessionReview, reviewScope, wholeStatus });
}

function partsDeclared(report, { sessionCov, sessionReview, wholeStatus }) {
  const list = listOf(report?.parts);
  const valid = list.map(declaredPart);
  const wide = declaredSessionWide(report?.sessionWideLimits);
  if (!list.length || valid.includes(null) || !wide || new Set(list.map((p) => p.part)).size !== list.length) return null;
  const parts = [...valid].sort((a, b) => byTurn(a.part, b.part)).map((part) => ({ part: part.part, reasons: new Set(part.reasons),
    counts: part.counts, findings: null, reviewable: 1 }));
  const sessionWide = { reasons: new Set(wide.reasons), counts: wide.counts, findings: null, reviewable: 1 };
  const status = settleParts({ parts, sessionWide, findings: report.findings,
    declared: new Map(valid.map((part) => [part.part, part])), declaredWide: wide, sessionCov, sessionReview, wholeStatus });
  return publishParts(parts, sessionWide, status);
}

function partsFromSession(report, { sessionCov, sessionReview, reviewScope, wholeStatus }) {
  const session = report.session;
  const { partOf: attribution, sessionPartOf } = attributionOf(session);
  const names = [...new Set(attribution.values())].filter((part) => part !== SESSION_WIDE).sort(byTurn);
  if (!names.length) return null;
  const blank = (part) => ({ part, events: 0, reviewable: 0, findings: [], decisions: 0, windows: new Set(),
    windowsIncomplete: new Set(), gaps: new Set(), reasons: new Set() });
  const entries = new Map([...names.map((name) => [name, blank(name)]), [SESSION_WIDE, blank(SESSION_WIDE)]]);
  const wide = entries.get(SESSION_WIDE);
  const entriesOf = (ids) => new Set([...ids].filter((id) => typeof id === 'string' && attribution.has(id))
    .map((id) => entries.get(attribution.get(id))));
  const orWide = (touched) => (touched.size ? touched : new Set([wide]));
  let unattributed = false;   // a check that did not run and names no part

  for (const event of listOf(session.events)) {
    if (typeof event?.id !== 'string' || !attribution.has(event.id)) continue;
    const entry = entries.get(attribution.get(event.id));
    entry.events++;
    if (REVIEWABLE_KINDS.includes(event.kind)) entry.reviewable++;
    // C-06 recorder limits the coverage facts count by event (`instructionsElided`, `instructionsWithheld`).
    if (event.kind === 'instruction' && event.authority === 'human' && event.omitted === true) entry.reasons.add(INSTRUCTION_OMITTED);
  }
  // C-06 recorder limit: a hand-off with no verified child evidence, by the rule its fact counts it by.
  const unlinked = unlinkedDelegationEvents(session);
  for (const id of unlinked.named) for (const entry of orWide(entriesOf([id]))) entry.reasons.add(DELEGATION_UNLINKED);
  if (unlinked.unnamed > 0) wide.reasons.add(GAP_UNPLACED);

  // The windows: a part's review is complete only if every window holding any of its events is.
  const rejectedIn = new Set(listOf(report.rejectedNarrativeWindows).filter(isCount));
  const placedWindows = new Set();
  let incompleteWindows = 0;
  report.windowResults.forEach((window, index) => {
    const at = isCount(window?.windowIndex) ? window.windowIndex : index;
    const unreadable = window?.proposalUnreadable === true || rejectedIn.has(at);
    const complete = windowRecordComplete(window) && !unreadable;
    if (!windowRecordComplete(window)) incompleteWindows++;
    const touched = Array.isArray(window?.eventIds) ? entriesOf(window.eventIds) : new Set();
    if (!touched.size) { if (!complete) unattributed = true; return; }
    placedWindows.add(at);
    for (const entry of touched) {
      entry.windows.add(at);
      if (complete) continue;
      entry.windowsIncomplete.add(at);
      entry.reasons.add(unreadable ? PROPOSAL_UNREADABLE : WINDOW_SHORT);
    }
  });
  const facts = report.coverageFacts;
  if (facts != null && (facts.windows !== report.windowResults.length || facts.windowsFailed !== incompleteWindows))
    unattributed = true;
  // A narrative proposal the code-review join could not read limits the window it came from; one it
  // cannot place limits every part.
  const rejectedNarrative = report.rejectedNarrative;
  if (rejectedNarrative !== undefined && rejectedNarrative !== 0
      && (!rejectedIn.size || [...rejectedIn].some((at) => !placedWindows.has(at))
        || (report.rejectedNarrativeUnplaced !== undefined && report.rejectedNarrativeUnplaced !== 0)))
    unattributed = true;
  // `readingCaps`, by the events each capping row names.
  for (const rejection of [...listOf(report.rejectedDecisions), ...listOf(report.rejectedFindings)]) {
    if (withheldRejection(rejection)) continue;
    const touched = entriesOf(namedEvents(rejection?.candidate));
    if (!touched.size) unattributed = true;
    for (const entry of touched) entry.reasons.add(READING_CAPPED);
  }
  if (reviewScope !== 'session-only')
    for (const decision of listOf(report.decisions)) {
      if (decision?.relevance !== 'unchecked') continue;
      const touched = entriesOf(listOf(decision.actions));
      if (!touched.size) unattributed = true;
      for (const entry of touched) entry.reasons.add(READING_CAPPED);
    }
  // Every capping declared gap, once (`gapKey`), on the parts whose events it names. Review-WP: a gap that
  // names none of its events but carries a transferred child's `sessionKey` is that child's history's loss,
  // so it is the part whose verified assignment spawned the child (`childSessionParts`) — the same
  // attribution as the child's events. Only a gap no event, no sequence and no such key places is
  // session-wide.
  const context = coverContext(report);
  const seen = new Set();
  const homeOf = (gap) => {
    const part = typeof gap.sessionKey === 'string' ? sessionPartOf.get(gap.sessionKey) : undefined;
    return part !== undefined && part !== SESSION_WIDE && entries.has(part) ? entries.get(part) : null;
  };
  const declare = (entry, key) => { entry.gaps.add(key); entry.reasons.add(GAP_DECLARED); };
  for (const gap of declaredGaps(report)) {
    const key = gapKey(gap);
    if (seen.has(key) || !gapCaps(gap, 'session', context)) continue;
    seen.add(key);
    const { ids, unplaced } = gapEvents(gap, session, context);
    const touched = entriesOf(ids);
    for (const entry of touched) declare(entry, key);
    if (!touched.size || unplaced) {
      const home = homeOf(gap);
      if (home) declare(home, key);
      else { wide.gaps.add(key); wide.reasons.add(GAP_UNPLACED); }
    }
  }
  // Findings, by the events their receipts cite; one citing none of them is session-wide, never dropped.
  for (const finding of listOf(report.findings)) {
    if (finding?.origin === 'code-review') continue;
    for (const entry of orWide(entriesOf(listOf(finding?.receipts).map((r) => r?.eventId)))) {
      entry.findings.push(finding);
      if (finding?.status === DECIDE) entry.reasons.add(FINDING_DECIDE);
      if (finding?.status === FYI) entry.reasons.add(FINDING_FYI);
    }
  }
  for (const decision of listOf(report.decisions))
    for (const entry of orWide(entriesOf(listOf(decision?.actions)))) entry.decisions++;
  // M33 K: a DECIDE-bound claim whose check did not settle limits the entries of the events it cites.
  for (const ids of unsettledDecideClaims(report))
    for (const entry of orWide(entriesOf(ids))) entry.reasons.add(DECIDE_UNSETTLED);

  const parts = names.map((name) => entries.get(name));
  for (const part of parts) {
    if (unattributed) part.reasons.add(REVIEW_UNATTRIBUTED);
    if (part.reviewable === 0) part.reasons.add(NO_REVIEWABLE_EVENT);
    else if (!part.windows.size) part.reasons.add(REVIEW_UNATTRIBUTED);
  }
  if (wide.reviewable > 0 && !wide.windows.size) wide.reasons.add(REVIEW_UNATTRIBUTED);
  // With no event of its own to review, the session-wide entry — a finding citing no part's event — is
  // reviewed exactly as far as the whole session was.
  wide.statusReviewable = wide.reviewable > 0 ? wide.reviewable : sessionReview === REVIEW_COMPLETE ? 1 : 0;
  // A partial coverage that no entry explains is a session-wide limit, never a CLEAN beside it.
  if (sessionCov !== 'complete' && ![...parts, wide].some((entry) => limitedBy(entry.reasons))) wide.reasons.add(LIMIT_UNATTRIBUTED);
  for (const entry of [...parts, wide])
    entry.counts = { events: entry.events, findings: entry.findings.length, decisions: entry.decisions,
      windows: entry.windows.size, windowsIncomplete: entry.windowsIncomplete.size, gaps: entry.gaps.size };
  // What an earlier reading of this report declared, which this one can only lower.
  const declared = new Map(listOf(report.parts).filter((part) => typeof part?.part === 'string')
    .map((part) => [part.part, declaredPart(part)]));
  const declaredWide = report.sessionWideLimits == null ? undefined : declaredSessionWide(report.sessionWideLimits);
  const status = settleParts({ parts, sessionWide: wide, findings: report.findings, declared, declaredWide,
    sessionCov, sessionReview, wholeStatus });
  return publishParts(parts, wide, status);
}

/**
 * Build the full report. `codeFindings` come from ordinary code review and are preserved
 * untouched: the ledger never hides them to look better (WP-10 completion rule).
 */
export function buildLedger({ repo, session, pr, candidates = [], findingCandidates = [], codeFindings = [],
  instructionHistoryComplete = true, sessionCoverage = null, codeCoverage = null, coverageFacts = null,
  upTo = null, reviewScope = 'combined', codeSourcesOf = null, groundIn = null, notActing = false,
  housekeeping = false, projectFilesShown = false }) {
  // D83 (3): `housekeeping` (a session-only review) — a grounded decision whose cited actions are all the agent's
  // housekeeping (`housekeepingKinds`) is not listed; it is counted (`counts.notListed`).
  // D84 (owner decision): `projectFilesShown` (a session-only review, whose windows show the project's
  // instruction files) — "made without asking you" also checks the files a decision's window showed the main agent
  // before it (`checkedInstructionAbsence`).
  // D59: the end of the window each decision candidate was proposed in — one sequence for a single
  // window's candidates, or a function of the candidate when a report merges several windows. Null
  // grounds against the whole session, as every caller without a window always has.
  const boundOf = typeof upTo === 'function' ? upTo : () => upTo;
  // M36 phase 2 review (critique c4; C-05 "M36 grounding per shown span"): the session each decision and finding
  // candidate's quotes ground in — the session as the window that proposed it showed it (session.js `shownSession`), a
  // function of the candidate when a report merges several windows, as `upTo` is. Absent (or null for a candidate), the
  // session itself, as every caller without a window always has. Everything else here reads `session`.
  const groundedIn = (candidate) => (typeof groundIn === 'function' ? groundIn(candidate) ?? session : session);
  // No session, or a session with nothing in it, is MISSING evidence — not evidence that
  // turned out clean. Defaulting this to 'complete' would let a PR with no recordings at all
  // render "session review: CLEAN", which is the exact false-coverage claim the product bans.
  const hasEvidence = Boolean(session?.events?.length);

  // Delegated work that was never captured is unreviewed work. D54: a gap beside captured
  // actions is judged on what WAS captured and marked partial with the gap named — it never
  // reads clean. Silently reporting CLEAN here would certify a child session nobody read.
  const delegationGaps = [];
  // A delegation the adapter already declared is the same loss, not a second one.
  const declaredFor = new Set((session?.adapterGaps ?? [])
    .filter((g) => g.delegationUnresolved === true || g.code === 'missing_child' || g.code === 'ambiguous_child')
    .flatMap((g) => g.eventIds ?? []));
  for (const assignment of session?.delegations?.() ?? []) {
    const link = session.childFor(assignment.id);
    if (link?.state === 'verified' || declaredFor.has(assignment.id)
      || session.outcomeOf(assignment.id) === 'failed') continue;
    const ambiguous = link?.state === 'ambiguous';
    // F62: the same note the adapter writes for the same loss, naming the delegation by the tool
    // that made it, so a gap reads the same whichever route declared it.
    const tool = typeof assignment.tool === 'string' && assignment.tool.trim() ? assignment.tool : 'a';
    delegationGaps.push({
      code: ambiguous ? 'ambiguous_child' : 'missing_child',
      channel: 'children',
      scope: 'session',
      sessionKey: session.sessionKey,
      eventIds: [assignment.id],
      count: 1,
      note: ambiguous
        ? `${tool} delegation matched more than one candidate child session`
        : `${tool} delegation with no verified child session`,
    });
  }
  // The same fact can arrive by two routes: a canonical child link that failed to resolve, or an
  // adapter that declared the delegation unlinked before any child link existed (B1/G6). Read
  // both — reading only `children` let a whole delegated session disappear into a clean verdict.
  for (const gap of session?.adapterGaps ?? [])
    if (gap.delegationUnresolved === true || gap.code === 'missing_child' || gap.code === 'ambiguous_child') delegationGaps.push(gap);

  // Never upgrade. A nullish declaration means nobody said this session was reviewed, and an
  // undeclared review is a review that did not happen — exactly as codeCoverage already treats
  // its own absence. Defaulting this to 'complete' is how a zero-window run printed CLEAN (A3).
  const declaredCoverage = !hasEvidence ? 'missing' : (sessionCoverage ?? 'missing');

  // How many published receipts carried a quote that had to be snapped to the exact source
  // substring (W3-3). It is a yield figure, not a quality one: every one of them passed the
  // same string search as an untouched quote.
  let receiptsRepaired = 0;

  const decisions = [];
  const rejectedDecisions = [];
  // D83 (3): the HOUSEKEEPING_KINDS of each grounded decision not listed (NOT_LISTED_REASONS `housekeeping`).
  const housekept = [];
  for (const candidate of hasEvidence ? candidates : []) {
    // A malformed candidate is a rejected candidate, never a thrown report.
    let result;
    try {
      result = groundDecision({ repo, session: groundedIn(candidate), pr, candidate, instructionHistoryComplete,
        upTo: boundOf(candidate) ?? null, notActing, projectFilesShown });
    } catch {
      result = { ok: false, reason: 'kind_rejected', detail: 'candidate could not be evaluated' };
    }
    // A choice not to act is never left out: its substance is the agent's stated words, not the actions it cites (D71
    // d: such a choice is highlighted wherever it is shown).
    const shown = result.ok && housekeeping === true && result.decision.notActing !== true ? groundedIn(candidate)
      : null;
    const kinds = shown ? housekeepingKinds(shown, (result.decision.actions ?? []).map((id) => shown.event(id))) : null;
    if (kinds) housekept.push(kinds);
    else if (result.ok) { decisions.push(result.decision); receiptsRepaired += result.receiptsRepaired ?? 0; }
    else rejectedDecisions.push({ candidate, ...result });
  }

  const sessionFindings = [];
  const rejectedFindings = [];
  // M33 (C-06): the outcome of every supplied resolution on a grounded contradiction — the
  // disclosure it earned, or the closed reason it did not.
  const resolutions = [];
  for (const candidate of hasEvidence ? findingCandidates : []) {
    let result;
    try {
      // D59 (S6, S5 review M1): a finding is grounded at the end of the window that proposed it, like a decision.
      result = groundFinding({ repo, session: groundedIn(candidate), pr, candidate, upTo: boundOf(candidate) ?? null });
    } catch {
      result = { ok: false, reason: 'kind_rejected', detail: 'candidate could not be evaluated' };
    }
    if (result.ok) {
      sessionFindings.push(result.finding);
      receiptsRepaired += result.receiptsRepaired ?? 0;
      if (result.resolution) resolutions.push(result.resolution);
    }
    else rejectedFindings.push({ candidate, ...result });
  }

  // W3-6: after grounding, and only after it — a merge is a claim about two GROUNDED findings,
  // and a candidate that was going to be rejected must not be able to absorb one that was not.
  // L5: a shared code receipt is read against the recorded code its event holds — this session's, unless the caller
  // supplies where code findings' sources live (`codeSourcesOf`).
  const { findings, merged: findingsMerged } = mergeDuplicateFindings([...codeFindings, ...sessionFindings],
    { sourcesOf: codeSourcesOf ?? ((eventId) => codeSourceTexts(session, eventId)) });

  // D58 (W3d-3): what in this reading caps session coverage is `readingCaps`, the rule
  // `honestStatuses` applies too. A proposal whose quote did not match is withheld and counted, so
  // (M33 G4) is a decision whose cited actions resolve to more than one actor or to none, and a
  // decision whose column or value could not be determined shows its own UNCHECKED cell: those
  // checks ran, and were inconclusive. A decision whose place in the PR is unknown (absent
  // evidence) and a proposal no check could evaluate still cap.
  // F100: every declared loss of the session caps it, not only a delegation — the same per-channel
  // cap `honestStatuses` applies (F116), by the same function. W3c-10: an unrecorded write caps
  // last and separately. No code review is joined here, so none is covered by a diff and every
  // one inside the repository caps; the value before that cap is published beside it so the
  // code-review join can re-apply it with the placement it knows (`coverageBeforeUnrecordedCap`).
  const declaredCodeCoverage = codeCoverage ?? (codeFindings.length ? 'complete' : 'missing');
  const asReport = { gaps: delegationGaps, session, pr, findings,
    codeCoverage: declaredCodeCoverage, reviewScope };
  const statusScope = effectiveReviewScope(asReport);
  const readCoverage = declaredCoverage !== 'complete' ? declaredCoverage
    : readingCaps({ ...asReport, decisions, rejectedDecisions, rejectedFindings }) ? 'partial'
      : capByDeclaredGaps('complete', asReport, 'session', { unrecorded: false });
  const effectiveCoverage = capByDeclaredGaps(readCoverage, asReport, 'session');
  // M33 (C-06): whether this reading completed, by the one rule `honestStatuses` applies. With
  // coverage facts, the facts decide; without them, a caller that declared the session `complete`
  // declared the review complete — the trust a declared coverage has always had here — and the
  // gaps above then cap only the coverage.
  const sessionReview = sessionReviewOf({ ...asReport, decisions, rejectedDecisions, rejectedFindings, coverageFacts,
    ...(coverageFacts == null && declaredCoverage === 'complete' ? { sessionReview: REVIEW_COMPLETE } : {}) },
  effectiveCoverage);

  // Code coverage must be DECLARED by whoever ran the code review. Assuming 'complete' made an
  // empty finding list from a capability that never ran render as CLEAN -- a clean pass on a
  // review nobody performed. Default to 'missing': no code review, no code verdict.
  // F63: reduced once, from the POST-merge list, by the same function honestStatuses uses. The
  // pre-merge input lists agreed with it only while the merge kept the stronger status and every
  // finding arrived on the list matching its origin. The aggregate still cannot be cleaner than
  // its weakest capability — `statusesFrom` reduces it from the two capabilities' statuses.
  const { codeStatus, sessionStatus, reviewStatus } = statusesFrom(findings, effectiveCoverage,
    declaredCodeCoverage, statusScope, sessionReview);

  // M33 brittleness H4 (C-06 decision order): by structure only, after every status above is computed.
  orderDecisions(decisions, session);

  return {
    repo, pr, session, reviewScope: statusScope, hasSessionEvidence: hasEvidence, gaps: delegationGaps,
    coverageFacts,
    codeCoverage: declaredCodeCoverage,
    decisions, findings,
    rejectedDecisions, rejectedFindings,
    // D58: what this reading withheld as inconclusive, by count. A producer that grounds more than
    // this ledger does (`runReview`, `runCodeReview`) replaces it with its own whole count.
    // W3d-4: and which of them failed a check more specific than a quote (`causes`).
    withheld: { proposals: [...rejectedDecisions, ...rejectedFindings].filter(withheldRejection).length, unsettled: 0,
      ...declaredCauses(withheldCauseCounts([...rejectedDecisions, ...rejectedFindings])) },
    coverage: effectiveCoverage,
    coverageBeforeUnrecorded: readCoverage,
    sessionReview,
    codeStatus, sessionStatus, reviewStatus,
    counts: {
      decisions: decisions.length,
      byColumn: Object.fromEntries(DECISION_COLUMNS.map((c) => [c, decisions.filter((d) => d.column === c).length])),
      uncheckedColumn: decisions.filter((d) => d.column == null).length,
      rejectedDecisions: rejectedDecisions.length,
      rejectedFindings: rejectedFindings.length,
      receiptsRepaired,
      findingsMerged,
      ...resolutionCounts(resolutions),
      // D83 (3): present only when a decision was not listed, so every other report keeps its bytes.
      ...(housekept.length ? { notListed: { [NOT_LISTED_REASONS[0]]: housekept.length,
        kinds: Object.fromEntries(HOUSEKEEPING_KINDS.map((kind) => [kind,
          housekept.filter((kinds) => kinds.includes(kind)).length])) } } : {}),
    },
  };
}

/**
 * M33 brittleness H4 (C-06 decision order). Who decided, in `DECISION_ORDER` — made without asking first, then
 * asked with the agent choosing how, then asked and settled, then a column the review could not check (a column
 * counts only when it was derived, `columnState: 'grounded'`) — then the recorded order of the decision's earliest
 * cited action (its index in `session.events`, the order windows and the story read; an action the session does
 * not hold sorts after every placed one), then the row's id. Materiality is a displayed fact, never a rank, and the
 * model's words (`dimension`) never order rows. Sorts in place and returns the list; statuses never read the order.
 */
export const DECISION_ORDER = Object.freeze(['unasked', 'asked-chose', 'asked-settled']);
export function orderDecisions(decisions, session) {
  const placed = new Map((Array.isArray(session?.events) ? session.events : []).map((event, index) => [event?.id, index]));
  const who = (d) => (d.columnState === 'grounded' && DECISION_ORDER.includes(d.column)
    ? DECISION_ORDER.indexOf(d.column) : DECISION_ORDER.length);
  const earliest = (d) => (Array.isArray(d.actions) ? d.actions : [])
    .reduce((first, id) => Math.min(first, placed.get(id) ?? Infinity), Infinity);
  const id = (d) => (typeof d.id === 'string' ? d.id : '');
  const keyed = decisions.map((d) => ({ d, who: who(d), at: earliest(d), id: id(d) }));
  keyed.sort((a, b) => (a.who - b.who) || (a.at === b.at ? 0 : a.at < b.at ? -1 : 1)
    || (a.id === b.id ? 0 : a.id < b.id ? -1 : 1));
  keyed.forEach(({ d }, i) => { decisions[i] = d; });
  return decisions;
}

/**
 * M33 (C-06): `{ resolutions: { verified, rejected } }` — how many supplied resolutions code verified
 * as self-corrections, and how many it rejected for each closed reason (every reason present) — or
 * nothing when no resolution was supplied, so a review without one publishes the counts it always did.
 */
function resolutionCounts(outcomes) {
  if (!outcomes.length) return {};
  return { resolutions: { verified: outcomes.filter((o) => o === SELF_CORRECTED).length,
    rejected: Object.fromEntries(RESOLUTION_REJECTIONS.map((reason) => [reason, outcomes.filter((o) => o === reason).length])) } };
}
