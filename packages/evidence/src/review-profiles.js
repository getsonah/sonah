// M33 J (C-07 "Experimental speed profile"). The named, frozen speed profiles a session review may run
// under. `standard` is the review as it always ran: its values are today's constants, and naming it —
// or naming nothing — changes no request byte, label, run-profile digest or checkpoint key. `m33-fast`
// is an OPT-IN experiment an owner authorizes by name: wider windows, a wider request bound, more lanes
// and calls in flight, and a tiered challenge. M33 K: `m33-lean` began as a second opt-in experiment: the
// standard profile's windows and request bound — so every narrative request it sends is byte-identical to
// the standard one, and a standard run's stored answers answer it with no call (D60) — with m33-fast's
// tiered challenge, twelve lanes and twelve calls in flight, and a cited-evidence dossier for its
// single-pass run (`singlePassEvidence`). Plain, deeply frozen literals: no numeric flag, no environment
// variable, no per-repo tuning selects or adjusts a value — only the name does. Owner decision 2026-10-13
// (D85): `sonah review` names `m33-lean` when it is given no --profile (session-review-command.js
// DEFAULT_REVIEW_PROFILE); naming nothing here still means `standard`, as the combined review and the
// pinned standard baselines need.
import { CHALLENGE_DOSSIER_VERSION, CHALLENGE_PROFILE } from './challenge.js';
import { WINDOW_REQUEST_MAX_BYTES } from './windows.js';

const deepFreeze = (value) => {
  if (value !== null && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

/** How a profile challenges a window's items: every item alike (three passes, two grounded
 *  not-refuted votes), or `tiered` (CHALLENGE_TIER_BOUNDS). */
export const CHALLENGE_TIERS = Object.freeze(['uniform', 'tiered']);
const [UNIFORM, TIERED] = CHALLENGE_TIERS;

/** M33 K: what a tiered profile's single-pass run is shown — the whole window evidence, as every other
 *  run is, or a `dossier` of what its batch cites and the window's skeleton (prompt.js
 *  `buildChallengeDossier`). A profile that names none shows the whole window. */
export const SINGLE_PASS_EVIDENCE = Object.freeze(['window', 'dossier']);
const [, DOSSIER] = SINGLE_PASS_EVIDENCE;

export const REVIEW_SPEED_PROFILE_NAMES = Object.freeze(['standard', 'm33-fast', 'm33-lean']);
const [STANDARD, M33_FAST, M33_LEAN] = REVIEW_SPEED_PROFILE_NAMES;

/** Owner context-fit addendum (2026-10-10): Codex's complete session request, including the brief,
 * inventory and framing. About 258,000 context tokens minus 25,000 output tokens and a 16,000-token
 * margin initially gave a 650,000-byte estimate at 3 UTF-8 bytes/token. One real-usage calibration
 * lowers it to 600,000 bytes: at that estimate, 33,000 tokens remain for native CLI framing and
 * margin after the output reserve. Work/carry estimates remain 100k + 100k at 3.6 bytes/token.
 * This frozen operational bound is not a provider context attestation or per-repository tuning. */
export const CODEX_REQUEST_MAX_BYTES = 600_000;

/** The complete request bound: Codex session-only reviews use the smaller context; every other
 * session backend keeps its speed profile's bound, and combined reviews keep the existing bound. */
export const requestBoundOf = (profile, reviewScope, backend = undefined) => (reviewScope === 'session-only'
  ? (backend === 'codex-cli' ? CODEX_REQUEST_MAX_BYTES : profile.maxInputBytes) : CHALLENGE_PROFILE.maxInputBytes);

/**
 * M35 (windowing, owner-confirmed spec 2026-10-06; C-07 "M35 windowing"): every profile windows a session by the spec
 * (windows.js `windowSettingsOf`: 200k work + 200k carried by default; 100k + 100k for codex-cli session reviews),
 * so a speed profile no longer names a window source budget or a re-cut floor (`windowSourceBytes`,
 * `windowSourceFloorBytes`, M33 J's re-cut, are gone with the byte-budget splitter). Its request bound is the spec's
 * worst-case call (`WINDOW_REQUEST_MAX_BYTES`, about 450k tokens) for every profile, except Codex's
 * complete-request bound (`requestBoundOf`): a request over it is
 * `unreviewed_scope`, never re-cut or clipped. What still sets a profile apart: its lanes, its calls in flight and how it
 * challenges.
 */
export const REVIEW_SPEED_PROFILES = deepFreeze({
  [STANDARD]: { name: STANDARD, maxInputBytes: WINDOW_REQUEST_MAX_BYTES,
    windowConcurrency: 3, maxCallsInFlight: 6, challenge: UNIFORM },
  // Twelve lanes and twelve calls in flight and the tiered challenge (its 4x windows were M33 J's; every profile's
  // windows are the spec's now).
  [M33_FAST]: { name: M33_FAST, maxInputBytes: WINDOW_REQUEST_MAX_BYTES, windowConcurrency: 12, maxCallsInFlight: 12,
    challenge: TIERED },
  // M33 K: the standard windows and request bound (no narrative byte moves), twelve lanes and twelve calls in flight,
  // the tiered challenge, and a dossier for its single-pass run.
  [M33_LEAN]: { name: M33_LEAN, maxInputBytes: WINDOW_REQUEST_MAX_BYTES, windowConcurrency: 12, maxCallsInFlight: 12,
    challenge: TIERED, singlePassEvidence: DOSSIER },
});

/**
 * The tiered challenge's two bounds. `decide`: M33 C — EVERY claim, with or without contradictedBy or
 * supportedBy (it can become a published finding or a promise; run-review.js `threePass`), every resolution
 * item and (M33 C repair) every support item — is asked exactly as the standard profile asks every item.
 * `single`: every other item (a decision, a pivot, a requirement, a written statement) is asked once and
 * survives only on that one vote, valid (grounded) and not-refuted. The values are unchanged; only which items take
 * `decide` moved, with the challenge version (`sonah.challenge/8`).
 */
export const CHALLENGE_TIER_BOUNDS = deepFreeze({
  decide: { passes: CHALLENGE_PROFILE.passes, requiredSurvivals: CHALLENGE_PROFILE.requiredSurvivals },
  single: { passes: 1, requiredSurvivals: 1 },
});

/** The frozen profile a name selects; nothing, or `standard`, is the standard profile. Any other value
 *  is refused with a RangeError before anything is planned or called. */
export function reviewSpeedProfile(name = STANDARD) {
  if (typeof name !== 'string' || !Object.hasOwn(REVIEW_SPEED_PROFILES, name)) throw new RangeError('Unknown review speed profile');
  return REVIEW_SPEED_PROFILES[name];
}

/** Is this profile the standard one? Only the standard profile keeps every one of today's shapes. */
export const isStandardProfile = (profile) => profile === REVIEW_SPEED_PROFILES[STANDARD];

/** Does this profile challenge in tiers? */
export const tieredChallenge = (profile) => profile.challenge === TIERED;

/** M33 K: is this profile's single-pass run shown a cited-evidence dossier rather than the whole window? */
export const dossierChallenge = (profile) => tieredChallenge(profile) && profile.singlePassEvidence === DOSSIER;

/**
 * The challenge profile a review under `profile` states. A combined review (always the standard profile) states
 * CHALLENGE_PROFILE, as always. M35: a session-only review's challenge requests carry its windows' evidence, so their
 * bound is backend-aware (`requestBoundOf`) — and, when tiered, the tier bounds; when its single-pass run is
 * shown a dossier (M33 K), that and the dossier's version.
 */
export const challengeProfileOf = (profile, reviewScope = 'session-only', backend = undefined) => (reviewScope !== 'session-only'
  ? CHALLENGE_PROFILE : (backend === 'codex-cli' ? CODEX_SESSION_CHALLENGE : SESSION_CHALLENGE).get(profile.name));
const sessionChallenges = (backend) => new Map(REVIEW_SPEED_PROFILE_NAMES.map((name) => {
  const profile = REVIEW_SPEED_PROFILES[name];
  return [name, deepFreeze({ ...CHALLENGE_PROFILE, maxInputBytes: requestBoundOf(profile, 'session-only', backend),
    ...(tieredChallenge(profile) ? { tiers: structuredClone(CHALLENGE_TIER_BOUNDS) } : {}),
    ...(dossierChallenge(profile) ? { singlePassEvidence: DOSSIER, dossier: CHALLENGE_DOSSIER_VERSION } : {}) })];
}));
const SESSION_CHALLENGE = sessionChallenges();
const CODEX_SESSION_CHALLENGE = sessionChallenges('codex-cli');
