// D87 (owner decisions 2026-10-13/14), reworked as the code step: the
// code pass as pure code — its closed vocabularies and versions, the frozen snapshot and its diff, the grounding of a
// code quote, step 1's separate code check (cannot-tell, the re-ask, the change), step 2's lenses, findings, scope and
// open questions, the verdict-first unanimous challenge, the output, and what joining the pass to a report may and may
// not change.
//
// Synthetic sessions and files, a deterministic fake reviewer: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CODE_CHECK_OUTCOMES, CODE_CHECK_REASONS, CODE_FILE_STATES, GAP_CODES, CODE_DIFF_STATES, CODE_PASS_LENSES,
  CODE_FINDING_KINDS, CODE_VOTE_VERDICTS, CODE_REFUTATION_REASONS, CODE_FINDING_WITHHELD, CODE_DOSSIER_KINDS,
  CODE_DOSSIER_MOVES, CODE_FOOTER_KINDS, CODE_STEP_PARTS, CODE_DIFF_BASES, CODE_START_COMMIT_SOURCES, CODE_CHANGE_TYPES,
  reviewRunState, honestStatuses } from '../src/ledger.js';
import { CODE_SNAPSHOT_VERSION, CODE_CHECK_VERSION, CODE_PASS_VERSION, CODE_PASS_PROFILE, CODE_CHECK_SYSTEM,
  CODE_PASS_SYSTEM, CODE_LENS_TEXT, codeSnapshotPlan, freezeCodeSnapshot, groundCodeReceipt, sourceSession, codeView,
  codeCheckRows, runCodePass, withCodePass, codeContradictedRows, withoutGutter, buildCodeCheckRequest, requestWords,
  sourceId, identifySources, quoteOverlaps, challengeFindingOf, challengeRowOf, namedFile } from '../src/code-pass.js';
import { actorOf } from '../src/code-context.js';
import { CHALLENGE_PROFILE, CODE_STEP_CHALLENGE_CORE, CODE_STEP_CHECK_NOTE, CODE_STEP_FINDING_NOTE, codeStepVoteShape }
  from '../src/challenge.js';
import { PROMPT_VERSION } from '../src/prompt.js';
import { SESSION_REVIEW_AGENT_VERSION } from '../src/review-agent.js';
import { WINDOWING_VERSION } from '../src/windows.js';
import { CODE_REVIEW_VERSION } from '../src/code-review-prompt.js';
import { attentionLines, ATTENTION_WORDS } from '../src/review.js';
import { runProfile } from '../src/run-review.js';
import { REVIEW_TRANSPORT_VERSION } from '../../cli/src/review-judge.js';
import { ANSWER_CACHE_VERSION } from '../../cli/src/answer-cache.js';
import { PAGE_VERSION } from '../../render/session-page.js';
import { STORY_VERSION } from '../../render/session-story.js';
import { CODE_PASS_READER_VERSIONS, W4_REVERT_READER_VERSIONS, JUDGMENT_FIRST_READER_VERSIONS,
  CODE_STEP_READER_VERSIONS, CODE_STEP_VERSIONS, CODE_STEP_REVIEW_VERSIONS, CODE_STEP_REVIEW_READER_VERSIONS,
  CODE_STEP_REREVIEW_VERSIONS, CODE_PASS_PROFILE_CODE_STEP_REVIEW, profileBeforeCodeStepRereview,
  CODE_STEP_THIRD_REVIEW_VERSIONS, CODE_PASS_PROFILE_CODE_STEP_REREVIEW, profileBeforeCodeStepThirdReview,
  CODE_STEP_FOURTH_REVIEW_VERSIONS, CODE_PASS_PROFILE_CODE_STEP_THIRD_REVIEW, profileBeforeCodeStepFourthReview,
  JUDGMENT_FIRST_REVIEW_READER_VERSIONS, RELEASE_REVIEW_READER_VERSIONS, RELEASE_REVIEW_VERSIONS,
  SECOND_RELEASE_REVIEW_VERSIONS, CODE_PASS_PROFILE_RELEASE_REVIEW, profileBeforeSecondReleaseReview,
  CODE_PASS_PROFILE_CODE_STEP_FOURTH_REVIEW, profileBeforeReleaseReview } from './m33-integration-fixture.js';
import { CODE_FILES, CODE_TEXT, codeSession, buildCodeSession, shownFiles, checkRows, upheld, candidatesOf,
  dossierItems, parseFinding, PARSE_QUOTE as QUOTE } from '../../cli/test/code-pass-fixture.js';

const enc = (text) => new TextEncoder().encode(text);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const BOUND = 1_620_000;
const RECORDED = { kind: 'recorded_edits' };
const GIT = { kind: 'git', commit: 'a'.repeat(40), how: 'reflog' };

/** parse.js at the session's start commit: it split on semicolons. */
const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
/** git's own patch of parse.js from its base to the file now. */
const PARSE_PATCH = ['diff --git a/src/parse.js b/src/parse.js', 'index 1111111..2222222 100644', '--- a/src/parse.js',
  '+++ b/src/parse.js', '@@ -1,4 +1,4 @@ export function parse(input) {', ' export function parse(input) {',
  '-  const parts = input.split(";");', '+  const parts = input.split(",");', '   return parts.map((part) => part.trim());',
  ' }', ''].join('\n');

/** The fixture's files as the CLI reads them (by plan entry), with a path-level state where one is given. */
function readsOf(plan, files = CODE_FILES, states = {}) {
  return plan.map((entry) => (Object.hasOwn(states, entry.path) ? { path: entry.path, state: states[entry.path] }
    : Object.hasOwn(files, entry.path) ? { path: entry.path, bytes: enc(files[entry.path]) }
      : { path: entry.path, state: 'deleted' }));
}
/** A snapshot with no git base: the diff is the recorded edits. */
const snapshotOf = (session = codeSession(), files = CODE_FILES, states = { '.env': 'credential_path' }) => {
  const plan = codeSnapshotPlan(session);
  return freezeCodeSnapshot(plan, readsOf(plan, files, states), { base: RECORDED });
};
/** A snapshot with a git base: parse.js modified from BASE_PARSE (git's patch), and `extra` git-only paths. */
function gitSnapshotOf({ session = codeSession(), files = CODE_FILES, states = { '.env': 'credential_path' },
  parse = { base: BASE_PARSE, patch: PARSE_PATCH }, extra = [] } = {}) {
  const plan = [...codeSnapshotPlan(session)];
  for (const e of extra) plan.splice(1, 0, { path: e.path, recordedPath: e.path, changed: true, recorded: false,
    outside: false, last: null, edits: [] });
  const reads = readsOf(plan, { ...files, ...Object.fromEntries(extra.filter((e) => e.head !== undefined)
    .map((e) => [e.path, e.head])) }, states).map((read) => {
    if (read.path === 'src/parse.js') return { ...read, type: 'modified', base: { bytes: enc(parse.base) }, patch: parse.patch };
    const e = extra.find((x) => x.path === read.path);
    return e ? { ...read, type: e.type, ...(e.base !== undefined ? { base: { bytes: enc(e.base) } } : {}),
      patch: e.patch ?? null } : read;
  });
  return freezeCodeSnapshot(plan, reads, { base: GIT });
}

const R = (eventId, role, quote) => ({ eventId, role, quote });
/** A session review's report over `codeSession`: an open claim, an ask partly done, a decision made without asking,
 *  a decision you settled. Statuses as a session review publishes them. */
function sessionReport() {
  return {
    repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', pr: null, codeCoverage: 'missing',
    coverage: 'complete', sessionReview: 'complete', findings: [],
    promises: [{ id: `sha256:${'1'.repeat(64)}`, stated: R('C1', 'commentary', 'parse now returns an empty list for empty input.'),
      text: 'The agent said parse returns an empty list for empty input.', status: 'open', receipts: [] }],
    requirements: [{ text: 'Return [] for empty input.', instruction: R('I1', 'instruction',
      'SYNTHETIC_CODE_ASK: add a parse function that returns [] for empty input, and do not touch the README.'),
    status: 'partly-done', deliverable: R('W1', 'code', 'export function parse(input) {'),
    shortfall: R('C1', 'commentary', 'parse now returns an empty list for empty input.') }],
    decisions: [
      { id: `sha256:${'2'.repeat(64)}`, dimension: 'How to split the input', chosen: 'Split on commas',
        actions: ['W1'], column: 'unasked', stated: null },
      { id: `sha256:${'3'.repeat(64)}`, dimension: 'Which file to write', chosen: 'src/parse.js', actions: ['W1'],
        column: 'asked-settled', stated: null },
    ],
    failures: [], writtenClaims: [],
  };
}

/**
 * A fake reviewer for the pass: step 1 by `check(rows, request)`, a lens by `pass(prompt, lens)` and `questions(prompt,
 * lens)`, a repair by `repair(request)`, a code-step challenge by `vote(candidate, request)` (default: upheld, citing every
 * quote the candidate carries). `seen` receives every request.
 */
function passJudge({ check = () => [], pass = () => [], questions = () => [], repair = null, vote = (c) => upheld(c),
  seen = [] } = {}) {
  return async (request) => {
    seen.push(request);
    if (/^code-check(:reask)?$/.test(request.label)) return { checks: check(checkRows(request.prompt), request) };
    const lens = /^code-pass:([a-z]+)(?::g\d+)?$/.exec(request.label);
    if (lens) return { findings: pass(request.prompt, lens[1]), questions: questions(request.prompt, lens[1]) };
    if (/receipt-repair$/.test(request.label)) return repair ? repair(request) : {};
    return { votes: candidatesOf(request.prompt, request.challenge.items).map((c) => vote(c, request)) };
  };
}
const contradicting = (rows) => rows.map((row) => (row.kind === 'claim'
  ? { key: row.key, answer: 'contradicts', explanation: 'An empty input gives one empty part.',
    receipts: [{ path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2, quote: QUOTE }] }
  : { key: row.key, answer: 'cannot-tell', explanation: 'Not settled by the code.', receipts: [] }));
/** The behaviour lens finds `finding`; the others nothing. */
const onBehaviour = (finding) => (prompt, lens) => (lens === 'behaviour' ? [finding] : []);
const run = (judge, { report = sessionReport(), session = codeSession(), snapshot = gitSnapshotOf({ session }),
  bound = BOUND, base = GIT } = {}) => runCodePass({ report, session, snapshot, bound, judge, base });
const checkOf = (result, kind) => [...result.checks.values()].find(({ row }) => row.kind === kind).check;

test('code step: the closed vocabularies and versions are exactly the method\'s; every unchanged session version is pinned', () => {
  assert.deepEqual(CODE_CHECK_OUTCOMES, ['shown-in-code', 'contradicted-by-code', 'not-checked-in-code']);
  assert.deepEqual(CODE_CHECK_REASONS, ['file_not_shown', 'quote_ungrounded', 'anchor_off_quote',
    'file_changed_since_session', 'request_bound', 'no_answer', 'challenge_refuted', 'challenge_unsettled',
    'challenge_unexecuted', 'cannot_tell']);
  assert.deepEqual(CODE_FILE_STATES, ['shown', 'not_shown', 'binary', 'credential_path', 'harness_home', 'oversize',
    'changed_since_session', 'deleted', 'outside_root', 'unreadable']);
  assert.deepEqual(CODE_PASS_LENSES, ['behaviour', 'tests', 'contracts', 'ask']);
  assert.deepEqual(CODE_FINDING_KINDS, ['bug', 'missed_case', 'weak_test', 'contract_break', 'ask_not_met']);
  assert.deepEqual(CODE_VOTE_VERDICTS, ['upheld', 'refuted']);
  // The review of the code step: `duplicate` is gone — a finding is checked alone, so it could never apply.
  assert.deepEqual(CODE_REFUTATION_REASONS, ['incorrect', 'step_unsupported', 'mitigation_shown', 'input_unreachable',
    'rests_on_unshown_code', 'out_of_scope', 'unverifiable']);
  assert.ok(!CODE_STEP_CHALLENGE_CORE.includes('duplicate'));
  assert.deepEqual(CODE_DIFF_STATES, ['recorded', 'unrecorded_change', 'base_unknown', 'withheld', 'unreadable']);
  assert.deepEqual(CODE_DIFF_BASES, ['git', 'recorded_edits']);
  assert.deepEqual(CODE_START_COMMIT_SOURCES, ['recorded', 'reflog', 'commit_date']);
  assert.deepEqual(CODE_CHANGE_TYPES, ['added', 'modified', 'deleted']);
  assert.deepEqual(CODE_FOOTER_KINDS, ['listed_by_name', 'clipped', 'withheld', 'failed']);
  assert.deepEqual(CODE_STEP_PARTS, ['check', 'lens', 'check_challenge', 'finding_challenge']);
  for (const list of [CODE_CHECK_REASONS, CODE_PASS_LENSES, CODE_FINDING_KINDS, CODE_REFUTATION_REASONS,
    CODE_FINDING_WITHHELD, CODE_DOSSIER_KINDS, CODE_DOSSIER_MOVES, CODE_DIFF_STATES]) assert.ok(Object.isFrozen(list));
  // The review of the code step moved each once more (/3); its second review once more again (/4); its third once
  // more again (/5); its fourth the snapshot alone (/6: the harness files kept in the home folder itself, and a link
  // into a harness home at the start commit); the release review the snapshot alone (/7: with the home folder as the
  // repository, only the paths the session recorded are read); the second release review the snapshot alone (/8: a
  // recording names a harness home only in its recorder's own layout).
  assert.equal(CODE_SNAPSHOT_VERSION, 'sonah.code-snapshot/8');
  // The second release review moved the code-check and code-pass once more (/6: a project instruction file's path is
  // compared under the working directory, so the actors of a quote of it follow).
  assert.equal(CODE_CHECK_VERSION, 'sonah.code-check/6');
  assert.equal(CODE_PASS_VERSION, 'sonah.code-pass/6');
  assert.deepEqual([SECOND_RELEASE_REVIEW_VERSIONS.check, SECOND_RELEASE_REVIEW_VERSIONS.pass], [
    { before: 'sonah.code-check/5', after: 'sonah.code-check/6' }, { before: 'sonah.code-pass/5', after: 'sonah.code-pass/6' }]);
  // The challenge moved once (its code-step run), as did the page and the story; the chain links them back. The review
  // of the code step moved each once more; its second and third reviews moved the challenge once more each, and no
  // reader. The page and the story: D87 moved them (page /28, story /23), the W4 revert (page /29, story /24) and D88
  // (page /30, story /25: the judgment first, the rows Sonah could not check folded); the code step's links come after
  // D88's, renumbered at their merge: page /31 and /32, story /26 and /27.
  assert.equal(CHALLENGE_PROFILE.version, 'sonah.challenge/42');
  assert.deepEqual(CODE_STEP_VERSIONS.challenge, { before: 'sonah.challenge/38', after: 'sonah.challenge/39' });
  assert.deepEqual(CODE_STEP_REVIEW_VERSIONS.challenge, { before: 'sonah.challenge/39', after: 'sonah.challenge/40' });
  assert.deepEqual(CODE_STEP_REREVIEW_VERSIONS.challenge, { before: 'sonah.challenge/40', after: 'sonah.challenge/41' });
  assert.deepEqual(CODE_STEP_THIRD_REVIEW_VERSIONS.challenge, { before: 'sonah.challenge/41', after: 'sonah.challenge/42' });
  assert.deepEqual([PAGE_VERSION, STORY_VERSION], [RELEASE_REVIEW_READER_VERSIONS.page.after,
    RELEASE_REVIEW_READER_VERSIONS.story.after]);
  assert.deepEqual([RELEASE_REVIEW_READER_VERSIONS.page.before, RELEASE_REVIEW_READER_VERSIONS.story.before],
    [JUDGMENT_FIRST_REVIEW_READER_VERSIONS.page.after, JUDGMENT_FIRST_REVIEW_READER_VERSIONS.story.after]);
  assert.deepEqual([CODE_STEP_REVIEW_READER_VERSIONS.page.before, CODE_STEP_REVIEW_READER_VERSIONS.story.before],
    [CODE_STEP_READER_VERSIONS.page.after, CODE_STEP_READER_VERSIONS.story.after]);
  assert.deepEqual([CODE_STEP_READER_VERSIONS.page.before, CODE_STEP_READER_VERSIONS.story.before],
    [JUDGMENT_FIRST_READER_VERSIONS.page.after, JUDGMENT_FIRST_READER_VERSIONS.story.after]);
  assert.deepEqual([JUDGMENT_FIRST_READER_VERSIONS.page.before, JUDGMENT_FIRST_READER_VERSIONS.story.before],
    [W4_REVERT_READER_VERSIONS.page.after, W4_REVERT_READER_VERSIONS.story.after]);
  assert.deepEqual([W4_REVERT_READER_VERSIONS.page.before, W4_REVERT_READER_VERSIONS.story.before],
    [CODE_PASS_READER_VERSIONS.page.after, CODE_PASS_READER_VERSIONS.story.after]);
  assert.deepEqual([CODE_PASS_READER_VERSIONS.page.after, CODE_PASS_READER_VERSIONS.story.after],
    ['sonah.session-page/28', 'sonah.session-story/23']);
  // The judgment-first review's low findings moved the readers once more (page /33, story /28); the chain links them.
  assert.deepEqual([JUDGMENT_FIRST_REVIEW_READER_VERSIONS.page.before, JUDGMENT_FIRST_REVIEW_READER_VERSIONS.story.before],
    [CODE_STEP_REVIEW_READER_VERSIONS.page.after, CODE_STEP_REVIEW_READER_VERSIONS.story.after]);
  // The release review moved them once more (page /34, story /29: the home folder as the repository, in the footer).
  assert.deepEqual([PAGE_VERSION, STORY_VERSION], ['sonah.session-page/34', 'sonah.session-story/29']);
  // The release review moved the session prompt once (sonah.narrative/35: a project instruction file the session wrote
  // is left out of the window's project files), and the second release review once more (sonah.narrative/36: that
  // file's path is compared under the working directory). Pinned unchanged: no window, transport or answer-store
  // version moved.
  assert.equal(PROMPT_VERSION, 'sonah.narrative/36');
  assert.deepEqual(RELEASE_REVIEW_VERSIONS.prompt, { before: 'sonah.narrative/34', after: 'sonah.narrative/35' });
  assert.deepEqual(SECOND_RELEASE_REVIEW_VERSIONS.prompt, { before: 'sonah.narrative/35', after: 'sonah.narrative/36' });
  assert.equal(SESSION_REVIEW_AGENT_VERSION, 'sonah.session-review-agent/11');
  assert.equal(WINDOWING_VERSION, 'sonah.windows/8');
  assert.equal(REVIEW_TRANSPORT_VERSION, 'sonah.review-transport/3');
  assert.equal(ANSWER_CACHE_VERSION, 'sonah.answer-cache/2');
  assert.equal(CODE_REVIEW_VERSION, 'sonah.code-review/24');
  // The session run profile holds the code pass's member, whether or not a review asks for the pass.
  assert.deepEqual(runProfile('session-only').codePass, JSON.parse(JSON.stringify(CODE_PASS_PROFILE)));
  assert.equal(runProfile('combined').codePass, undefined);
  assert.deepEqual(CODE_PASS_PROFILE.challenge, { passes: 3, requiredSurvivals: 3, unanimous: true, verdictFirst: true,
    version: 'sonah.challenge/42', checkBatch: 16, findingBatch: 1, order: 'keep-reverse-alternate' });
  assert.deepEqual([CODE_PASS_PROFILE.actors, CODE_PASS_PROFILE.evidenceActors, CODE_PASS_PROFILE.merge],
    [['person', 'recorded', 'agent'], ['person', 'recorded'], 'overlapping-anchor']);
  // The second review of the code step: the operations whose result is a recorded result, bound in the profile.
  assert.deepEqual(CODE_PASS_PROFILE.recordedResults, ['command', 'write', 'edit', 'delete']);
  // Rendered back through the chain, the profile is the release review's, the fourth review's, the third review's, the
  // second review's, then the review of the code step's.
  assert.deepEqual(SECOND_RELEASE_REVIEW_VERSIONS.snapshot, { before: 'sonah.code-snapshot/7',
    after: 'sonah.code-snapshot/8' });
  assert.deepEqual(profileBeforeSecondReleaseReview({ codePass: JSON.parse(JSON.stringify(CODE_PASS_PROFILE)),
    challenge: { version: CHALLENGE_PROFILE.version } }), { codePass: CODE_PASS_PROFILE_RELEASE_REVIEW,
    challenge: { version: 'sonah.challenge/42' } });
  assert.deepEqual(CODE_PASS_PROFILE_RELEASE_REVIEW, { ...JSON.parse(JSON.stringify(CODE_PASS_PROFILE)),
    snapshot: 'sonah.code-snapshot/7', check: 'sonah.code-check/5', pass: 'sonah.code-pass/5' });
  assert.deepEqual(RELEASE_REVIEW_VERSIONS.snapshot, { before: 'sonah.code-snapshot/6', after: 'sonah.code-snapshot/7' });
  assert.deepEqual(profileBeforeReleaseReview({ codePass: JSON.parse(JSON.stringify(CODE_PASS_PROFILE)),
    challenge: { version: CHALLENGE_PROFILE.version } }), { codePass: CODE_PASS_PROFILE_CODE_STEP_FOURTH_REVIEW,
    challenge: { version: 'sonah.challenge/42' } });
  assert.deepEqual(CODE_PASS_PROFILE_CODE_STEP_FOURTH_REVIEW, { ...JSON.parse(JSON.stringify(CODE_PASS_PROFILE)),
    snapshot: 'sonah.code-snapshot/6', check: 'sonah.code-check/5', pass: 'sonah.code-pass/5' });
  assert.deepEqual(CODE_STEP_FOURTH_REVIEW_VERSIONS.snapshot, { before: 'sonah.code-snapshot/5',
    after: 'sonah.code-snapshot/6' });
  assert.deepEqual(profileBeforeCodeStepFourthReview({ codePass: JSON.parse(JSON.stringify(CODE_PASS_PROFILE)),
    challenge: { version: CHALLENGE_PROFILE.version } }), { codePass: CODE_PASS_PROFILE_CODE_STEP_THIRD_REVIEW,
    challenge: { version: 'sonah.challenge/42' } });
  assert.deepEqual(CODE_PASS_PROFILE_CODE_STEP_THIRD_REVIEW, { ...JSON.parse(JSON.stringify(CODE_PASS_PROFILE)),
    snapshot: 'sonah.code-snapshot/5', check: 'sonah.code-check/5', pass: 'sonah.code-pass/5' });
  assert.deepEqual(profileBeforeCodeStepThirdReview({ codePass: JSON.parse(JSON.stringify(CODE_PASS_PROFILE)),
    challenge: { version: CHALLENGE_PROFILE.version } }), { codePass: CODE_PASS_PROFILE_CODE_STEP_REREVIEW,
    challenge: { version: 'sonah.challenge/41' } });
  assert.deepEqual(CODE_PASS_PROFILE_CODE_STEP_REREVIEW, { ...JSON.parse(JSON.stringify(CODE_PASS_PROFILE)),
    snapshot: 'sonah.code-snapshot/4', check: 'sonah.code-check/4', pass: 'sonah.code-pass/4',
    challenge: { ...CODE_PASS_PROFILE.challenge, version: 'sonah.challenge/41' } });
  assert.deepEqual(profileBeforeCodeStepRereview({ codePass: JSON.parse(JSON.stringify(CODE_PASS_PROFILE)),
    challenge: { version: CHALLENGE_PROFILE.version } }), { codePass: CODE_PASS_PROFILE_CODE_STEP_REVIEW,
    challenge: { version: 'sonah.challenge/40' } });
});

test('code step: the old ban on behaviour is gone; the briefs reason from the code and name the change', () => {
  const ban = 'Reading code never shows what a run did or how code behaves when it runs';
  for (const text of [CODE_CHECK_SYSTEM, CODE_PASS_SYSTEM, CODE_STEP_CHALLENGE_CORE])
    assert.ok(!text.includes(ban), text.slice(0, 60));
  for (const text of [CODE_CHECK_SYSTEM, CODE_PASS_SYSTEM])
    assert.match(text, /Reason from the code about what it does when it runs: trace concrete inputs through the changed\s+lines/);
  assert.match(CODE_LENS_TEXT.tests, /a test that would still pass with the bug present is theatre, not coverage/);
  assert.doesNotMatch(CODE_PASS_SYSTEM, /Look first where Sonah points you/);
  assert.doesNotMatch(CODE_PASS_SYSTEM, /When you find nothing, return/);
});

test('code step snapshot: changed files first, then read files, named under the root; the same tree gives the same bytes', () => {
  const session = codeSession();
  const plan = codeSnapshotPlan(session);
  assert.deepEqual(plan.map((e) => [e.path, e.changed]), [['src/parse.js', true], ['src/util.js', false], ['.env', false]]);
  assert.deepEqual(plan[0].last, { deleted: false, spans: [CODE_FILES['src/parse.js']] });
  assert.deepEqual(plan[0].edits, [{ before: [], after: [CODE_FILES['src/parse.js']], whole: true, placed: null }]);
  const first = snapshotOf(session), second = snapshotOf(codeSession());
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.map((f) => [f.path, f.state, f.diff]), [['src/parse.js', 'readable', 'base_unknown'],
    ['src/util.js', 'readable', undefined], ['.env', 'credential_path', undefined]]);
  assert.equal(first[0].sha256, sha(enc(CODE_FILES['src/parse.js'])));
  assert.match(first[0].id, /^file:[0-9a-f]{16}$/);
  // The session named one file absolutely and relatively: under the root, it is one file.
  const T1 = { turn: 'T1' };
  const twice = buildCodeSession('s-twice', { a: '/work/repo/src/a.js', b: 'src/a.js' }, [
    { id: 'R1', kind: 'invocation', read: '/work/repo/src/a.js', blob: 'a', ...T1 },
    { id: 'R2', kind: 'invocation', read: 'src/a.js', blob: 'b', ...T1 }]);
  assert.deepEqual(codeSnapshotPlan(twice, { root: '/work/repo' }).map((e) => [e.path, e.recordedPath]),
    [['src/a.js', '/work/repo/src/a.js']]);
  assert.equal(codeSnapshotPlan(twice).length, 2, 'with no root, as recorded');
});

test('code step snapshot: git\'s hunks are checked row by row against the base and the file, then widened', () => {
  const snapshot = gitSnapshotOf();
  const parse = snapshot.find((f) => f.path === 'src/parse.js');
  assert.deepEqual([parse.type, parse.diff, parse.base.text, parse.hunks.length], ['modified', 'recorded', BASE_PARSE, 1]);
  assert.match(parse.base.id, /^base:[0-9a-f]{16}$/);
  assert.equal(parse.base.sha256, sha(enc(BASE_PARSE)));
  // A patch that is not of these two texts (the file moved after it was read) is unreadable: no line is shown.
  const moved = gitSnapshotOf({ parse: { base: BASE_PARSE, patch: PARSE_PATCH.replace('split(",")', 'split("|")') } });
  assert.deepEqual(['diff', 'hunks', 'base'].map((k) => moved[0][k]), ['unreadable', [], null]);
  const torn = gitSnapshotOf({ parse: { base: BASE_PARSE, patch: '@@ -1,2 +1,2 @@\n a\n' } });
  assert.equal(torn[0].diff, 'unreadable');
  // Widened as PR-Agent widens them: git's three lines of context, then five more before and one after.
  const long = Array.from({ length: 20 }, (_, i) => `const line${i + 1} = ${i + 1};`);
  const longHead = [...long];
  longHead[9] = 'const line10 = 100;';
  const longPatch = `@@ -7,7 +7,7 @@\n${long.slice(6, 9).map((l) => ` ${l}`).join('\n')}\n-${long[9]}\n+${longHead[9]}\n`
    + `${long.slice(10, 13).map((l) => ` ${l}`).join('\n')}\n`;
  const widened = gitSnapshotOf({ extra: [{ path: 'long.js', type: 'modified', head: `${longHead.join('\n')}\n`,
    base: `${long.join('\n')}\n`, patch: longPatch }] }).find((f) => f.path === 'long.js');
  assert.deepEqual([widened.hunks[0].oldStart, widened.hunks[0].oldCount, widened.hunks[0].newStart], [2, 13, 2]);
  // A path git shows differing that no recorded edit names: an unrecorded change, its hunks shown.
  const unrecorded = gitSnapshotOf({ extra: [{ path: 'gen.js', type: 'modified', head: 'export const generated = 2;\n',
    base: 'export const generated = 1;\n', patch: '@@ -1 +1 @@\n-export const generated = 1;\n+export const generated = 2;\n' }] });
  assert.deepEqual(['diff', 'recorded'].map((k) => unrecorded.find((f) => f.path === 'gen.js')[k]), ['unrecorded_change', false]);
  // An untracked file: git's own patch of it from nothing, one hunk, every line added; with no patch, nothing is shown.
  const added = gitSnapshotOf({ extra: [{ path: 'new.js', type: 'added', head: 'a\nb\n', patch: '@@ -0,0 +1,2 @@\n+a\n+b\n' }] });
  assert.deepEqual(added.find((f) => f.path === 'new.js').hunks[0].rows.map((r) => [r.type, r.new]), [['+', 1], ['+', 2]]);
  const unpatched = gitSnapshotOf({ extra: [{ path: 'new.js', type: 'added', head: 'a\nb\n' }] });
  assert.deepEqual(['diff', 'hunks'].map((k) => unpatched.find((f) => f.path === 'new.js')[k]), ['unreadable', []]);
  // A withheld file shows no line before or after, whatever git said.
  const withheld = gitSnapshotOf({ extra: [{ path: '.env.local', type: 'modified', base: 'KEY=1\n',
    patch: '@@ -1 +1 @@\n-KEY=1\n+KEY=2\n' }], states: { '.env': 'credential_path', '.env.local': 'credential_path' } });
  assert.deepEqual(['state', 'diff', 'hunks', 'base'].map((k) => withheld.find((f) => f.path === '.env.local')[k]),
    ['credential_path', 'withheld', [], null]);
  // A deleted file: its base, its removed lines.
  const deleted = gitSnapshotOf({ extra: [{ path: 'old.js', type: 'deleted', base: 'gone\n', patch: '@@ -1 +0,0 @@\n-gone\n' }] });
  const old = deleted.find((f) => f.path === 'old.js');
  assert.deepEqual([old.state, old.diff, old.base.text, old.hunks[0].rows], ['deleted', 'unrecorded_change', 'gone\n',
    [{ type: '-', text: 'gone', old: 1, new: null }]]);
});

test('code step snapshot: drift reads changed_since_session; binary, deleted, a re-created deletion and a directory are declared', () => {
  const session = codeSession();
  const plan = codeSnapshotPlan(session);
  const freeze = (reads) => freezeCodeSnapshot(plan, reads, { base: RECORDED });
  const drifted = freeze(readsOf(plan, { ...CODE_FILES, 'src/parse.js': CODE_FILES['src/parse.js'].replace('trim()', 'trimEnd()') }));
  assert.equal(drifted[0].state, 'changed_since_session');
  assert.equal(drifted[0].text, undefined);
  assert.deepEqual([drifted[0].diff, drifted[0].hunks], ['withheld', []], 'a drifted file shows no hunk either');
  assert.equal(freeze(readsOf(plan, { ...CODE_FILES, 'src/util.js': 'a\u0000b' }))[1].state, 'binary');
  assert.equal(freeze(plan.map((e) => (e.path === 'src/util.js' ? { path: e.path, bytes: new Uint8Array([0xff, 0xfe, 0x41]) }
    : readsOf([e])[0])))[1].state, 'binary');
  assert.equal(freeze(readsOf(plan, { 'src/util.js': CODE_FILES['src/util.js'] }))[0].state, 'deleted');
  assert.deepEqual(freeze(plan.map((e) => (e.path === 'src/util.js' ? { path: e.path, directory: true } : readsOf([e])[0])))
    .map((f) => f.path), ['src/parse.js', '.env'], 'a read directory is no file: left out');
  const deleting = { ...plan[0], last: { deleted: true, spans: [] } };
  assert.equal(freezeCodeSnapshot([deleting], readsOf([deleting]))[0].state, 'changed_since_session');
  assert.equal(freezeCodeSnapshot([plan[1]], [{ path: plan[1].path, state: 'harness_home' }])[0].state, 'harness_home');
  assert.equal(freezeCodeSnapshot([plan[1]], [{ path: plan[1].path, state: 'shown' }])[0].state, 'unreadable');
  assert.equal(freezeCodeSnapshot([plan[1]], [{ path: 'other', bytes: enc('x') }])[0].state, 'unreadable');
});

test('code step snapshot: colliding content ids fail closed; a lone id is the lifted sourceId of the file', () => {
  const plan = codeSnapshotPlan(codeSession());
  const collided = freezeCodeSnapshot(plan, readsOf(plan, CODE_FILES, { '.env': 'credential_path' }),
    { idOf: () => 'file:0000000000000000', base: RECORDED });
  assert.deepEqual(collided.map((f) => f.state), ['unreadable', 'unreadable', 'credential_path']);
  const ok = snapshotOf();
  assert.equal(ok[0].id, sourceId({ path: 'src/parse.js', side: 'FILE', startLine: 1, endLine: ok[0].lines,
    text: CODE_FILES['src/parse.js'] }, 'file'));
  const a = { path: 'a', side: 'RIGHT', startLine: 1, endLine: 1, text: 'x' };
  assert.equal(identifySources([a, { ...a }]).sources.length, 1);
  assert.deepEqual(identifySources([a, { ...a, path: 'b' }], () => 'same'), { sources: [], collided: new Set(['a', 'b']) });
  assert.equal(quoteOverlaps({ text: 'one\ntwo\nthree', startLine: 10 }, 'two', { startLine: 11, endLine: 11 }), true);
  assert.equal(quoteOverlaps({ text: 'one\ntwo\nthree', startLine: 10 }, 'two', { startLine: 12, endLine: 12 }), false);
});

test('code step grounding: a quote grounds only in what its request showed — the file now, or a hunk\'s old side', () => {
  const session = codeSession();
  const files = gitSnapshotOf({ session });
  const facade = sourceSession(session, { sources: [...files.filter((f) => f.state === 'readable')
    .map((f) => ({ eventId: f.id, text: f.text })), ...files.filter((f) => f.base?.id).map((f) => ({ eventId: f.base.id,
    text: f.base.text }))] });
  const whole = codeView({ files, hunkPaths: new Set(['src/parse.js']), wholePaths: ['src/parse.js', 'src/util.js'] });
  const context = { view: whole, facade, files };
  const ground = (r, ctx = context) => groundCodeReceipt({ path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2,
    quote: QUOTE, ...r }, ctx);
  const ok = ground({});
  assert.equal(ok.ok, true);
  assert.deepEqual({ ...ok.receipt, eventId: undefined }, { eventId: undefined, role: 'code', side: 'new', quote: QUOTE,
    path: 'src/parse.js', startLine: 2, endLine: 2, sha256: files[0].sha256, span: '  const parts = input.split(",");' });
  // The file before the session, on its old side: grounded in the base, by its own id and sha256.
  const before = ground({ side: 'old', quote: 'const parts = input.split(";");' });
  assert.equal(before.ok, true);
  assert.deepEqual([before.receipt.eventId, before.receipt.sha256], [files[0].base.id, files[0].base.sha256]);
  assert.equal(ground({ side: 'old', quote: 'export const SEPARATOR' }).reason, 'quote_ungrounded', 'not in the base');
  assert.equal(ground({ quote: 'const parts = input.splitAll(";");' }).reason, 'quote_ungrounded');
  assert.equal(ground({ quote: 'x'.repeat(121) }).reason, 'quote_ungrounded');
  assert.equal(ground({ quote: 'ab' }).reason, 'quote_ungrounded');
  assert.equal(ground({ startLine: 3, endLine: 4 }).reason, 'anchor_off_quote');
  assert.equal(ground({ endLine: 999 }).reason, 'anchor_off_quote');
  assert.equal(ground({ path: '.env', quote: 'API_KEY=not-a-real-key' }).reason, 'file_not_shown');
  assert.equal(ground({ path: 'nowhere.js' }).reason, 'file_not_shown');
  // Gutters the request shows are ours to read through: a file line's number and tab, a hunk row's columns.
  assert.equal(withoutGutter(`     2\t${QUOTE}`), QUOTE);
  assert.equal(withoutGutter(`|    2 |    2 | + |   ${QUOTE}`), `  ${QUOTE}`);
  assert.equal(ground({ quote: `|      |    2 | + |   ${QUOTE}` }).ok, true);
  const snapped = ground({ quote: 'const parts =  input.split(",");' });
  assert.deepEqual([snapped.ok, snapped.receipt.quote, snapped.receipt.repaired], [true, QUOTE, true]);
  // A file shown only through its hunks: a quote outside them was never shown.
  const hunksOnly = codeView({ files, hunkPaths: new Set(['src/parse.js']), wholePaths: [] });
  assert.equal(ground({}, { view: hunksOnly, facade, files }).ok, true, 'line 2 is in its hunk');
  assert.equal(ground({ path: 'src/util.js', startLine: 1, endLine: 1, quote: 'export const SEPARATOR = ",";' },
    { view: hunksOnly, facade, files }).reason, 'file_not_shown');
  // A file that changed since the session says so.
  const drifted = files.map((f) => (f.path === 'src/parse.js' ? { path: f.path, state: 'changed_since_session' } : f));
  const driftedView = codeView({ files: drifted, hunkPaths: new Set(), wholePaths: [] });
  assert.equal(ground({}, { view: driftedView, facade, files: drifted }).reason, 'file_changed_since_session');
});

test('code step 1: the change is given to step 1 too, and an upheld contradiction is a separate codeCheck', async () => {
  const session = codeSession();
  const report = sessionReport();
  const seen = [];
  const result = await run(passJudge({ check: contradicting, seen }), { report, session });
  const check = seen.find((r) => r.label === 'code-check');
  assert.match(check.prompt, /^## Files \(1\)$/m);
  assert.match(check.prompt, /^- src\/parse\.js → lines \d+-\d+ · modified$/m);
  assert.match(check.prompt, /^\| {4}2 \| {6}\| - \| {3}const parts = input\.split\(";"\);$/m);
  const joined = withCodePass(report, result);
  const claim = joined.promises[0];
  assert.deepEqual([claim.codeCheck.outcome, claim.codeCheck.reason, claim.codeCheck.receipts[0].quote],
    ['contradicted-by-code', null, QUOTE]);
  assert.equal(claim.status, 'open');
  assert.deepEqual(joined.requirements.map((r) => r.status), ['partly-done']);
  assert.deepEqual(joined.decisions.map((d) => d.column), ['unasked', 'asked-settled']);
  const strip = ({ codePass: _c, ...rest }) => Object.fromEntries(Object.entries(rest).map(([k, v]) => [k,
    Array.isArray(v) ? v.map((row) => (row && typeof row === 'object' ? (({ codeCheck: _x, ...r }) => r)(row) : row)) : v]));
  assert.deepEqual(strip(joined), report);
  assert.deepEqual(honestStatuses({ ...joined }), honestStatuses({ ...report }));
  const before = attentionLines(report), after = attentionLines(joined);
  for (const line of before) assert.ok(after.includes(line), line);
  assert.ok(after.includes(ATTENTION_WORDS.codeContradicted(1)));
  assert.equal(codeContradictedRows(joined).length, 1);
});

test('code step 1: "cannot tell" is its own closed reason, never "no answer", and is counted by whether a shown file is named', async () => {
  const result = await run(passJudge({ check: contradicting }));
  assert.deepEqual(checkOf(result, 'ask'), { outcome: 'not-checked-in-code', receipts: [], reason: 'cannot_tell' });
  assert.equal(result.codePass.checks.byReason.cannot_tell, 3);
  assert.equal(result.codePass.checks.byReason.no_answer, undefined);
  // The ask and the decisions name src/parse.js (their deliverable and actions wrote it), which was shown.
  assert.deepEqual(result.codePass.checks.cannotTell, { namesShownFile: 3, namesNoShownFile: 0 });
});

test('code step 1: one re-ask for every row left out or malformed, and none after a failed call', async () => {
  const seen = [];
  // The first reply leaves the decisions out and gives the ask an extra field; the re-ask answers them.
  const check = (rows, request) => (request.label === 'code-check'
    ? contradicting(rows).filter((c) => rows.find((r) => r.key === c.key).kind !== 'decision')
      .map((c) => (rows.find((r) => r.key === c.key).kind === 'ask' ? { ...c, path: 'extra' } : c))
    : contradicting(rows));
  const result = await run(passJudge({ check, seen }));
  const reask = seen.filter((r) => r.label === 'code-check:reask');
  assert.equal(reask.length, 1);
  assert.deepEqual(JSON.parse(reask[0].prompt.split('No further re-ask is available.\n')[1]), ['R2', 'R3', 'R4']);
  assert.equal(checkOf(result, 'ask').reason, 'cannot_tell', 'mended by the re-ask');
  assert.equal(result.codePass.calls.checkReask, 1);
  // Left out again: no answer, and no third ask.
  const stubborn = await run(passJudge({ check: (rows) => contradicting(rows).filter((c) => c.answer !== 'cannot-tell') }));
  assert.equal(checkOf(stubborn, 'ask').reason, 'no_answer');
  // A call that failed is the transport's to retry, never a re-ask for missing keys.
  const failedSeen = [];
  const quiet = passJudge({});
  await run(async (request) => { failedSeen.push(request);
    if (request.label === 'code-check') throw new Error('model_timeout');
    return quiet(request); });
  assert.equal(failedSeen.filter((r) => r.label === 'code-check:reask').length, 0);
  // A key answered twice, in the reply and in its re-ask, is no answer.
  const twice = (rows) => { const all = contradicting(rows); return [...all, ...all]; };
  assert.equal(checkOf(await run(passJudge({ check: twice })), 'claim').reason, 'no_answer');
});

test('code step 2: one call per lens, byte for byte the same but for the closing lens paragraph', async () => {
  const seen = [];
  await run(passJudge({ check: contradicting, seen }));
  const lenses = seen.filter((r) => r.label.startsWith('code-pass:'));
  assert.deepEqual(lenses.map((r) => r.label), CODE_PASS_LENSES.map((l) => `code-pass:${l}`));
  const prefix = (r, lens) => { assert.ok(r.prompt.endsWith(CODE_LENS_TEXT[lens])); return r.prompt.slice(0, -CODE_LENS_TEXT[lens].length); };
  const shared = prefix(lenses[0], 'behaviour');
  lenses.forEach((r, i) => { assert.equal(r.system, CODE_PASS_SYSTEM); assert.equal(prefix(r, CODE_PASS_LENSES[i]), shared); });
  // The order: the person's words, the change, the whole files, the dossier, the lens.
  const at = (text) => shared.indexOf(text);
  assert.ok(at(CODE_TEXT.ask) < at('## Files (1)') && at('## Files (1)') < at('FILE {') && at('FILE {') < at('{"key":"S1"'));
  assert.ok(!shared.includes(CODE_TEXT.final), 'the agent\'s final message is not the person\'s words');
  // Each dossier key annotates the table-of-contents row of the paths its events touch.
  assert.match(shared, /^- src\/parse\.js → lines \d+-\d+ · modified · S1 S3 S4$/m);
  assert.deepEqual(shownFiles(shared).map((f) => f.path), ['src/parse.js', 'src/util.js']);
  assert.match(shared, /^- \.env · withheld: a credential-shaped path$/m);
  assert.doesNotMatch(shared, /not-a-real-key/);
  // The same report and files: the same bytes.
  const again = [];
  await run(passJudge({ check: contradicting, seen: again }));
  assert.deepEqual(again.map((r) => r.prompt), seen.map((r) => r.prompt));
});

test('code step 2: an empty diff makes no lens call', async () => {
  const seen = [];
  const snapshot = freezeCodeSnapshot([{ path: 'src/util.js', changed: false, recorded: false, outside: false, last: null,
    edits: [] }], [{ path: 'src/util.js', bytes: enc(CODE_FILES['src/util.js']) }], { base: GIT });
  const result = await run(passJudge({ check: contradicting, seen }), { snapshot });
  assert.equal(seen.filter((r) => r.label.startsWith('code-pass:')).length, 0);
  assert.equal(result.codePass.groups, 0);
});

test('code step 2: findings are of closed kinds with a quoted trace; malformed ones are withheld as such', async () => {
  const kinds = async (finding) => (await run(passJudge({ check: contradicting, pass: onBehaviour(finding) }))).codePass;
  const ok = await kinds(parseFinding({ leadsFrom: ['S1'] }));
  assert.equal(ok.findings.length, 1);
  const [f] = ok.findings;
  assert.deepEqual(Object.keys(f).sort(), ['anchor', 'explanation', 'foundByLenses', 'id', 'input', 'kind', 'leadsFrom', 'lens',
    'origin', 'receipts', 'scope', 'status', 'title', 'trace', 'votes'].sort());
  assert.deepEqual([f.lens, f.kind, f.input, f.foundByLenses], ['behaviour', 'bug', 'parse("")', ['behaviour']]);
  assert.deepEqual(f.anchor, { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2 });
  assert.deepEqual(f.leadsFrom, [{ key: 'S1', kind: 'ask', source: 'requirements', index: 0, id: null }]);
  assert.deepEqual(f.votes.map((v) => [v.verdict, v.reason]), [['upheld', null], ['upheld', null], ['upheld', null]]);
  assert.deepEqual([f.trace[0].step, f.trace[0].source, f.trace[0].quote], ['An empty string splits into one empty part.',
    'file', QUOTE]);
  for (const bad of [parseFinding({ kind: 'style' }), parseFinding({ severity: 'high' }), parseFinding({ leadsFrom: ['S99'] }),
    parseFinding({ trace: [{ ...parseFinding().trace[0], step: 'x'.repeat(301) }] }), parseFinding({ trace: [] }),
    parseFinding({ input: '' }), parseFinding({ title: 'x'.repeat(161) })])
    assert.deepEqual((await kinds(bad)).rejected, [{ reason: 'malformed', lens: 'behaviour' }], JSON.stringify(bad).slice(0, 80));
  // A step of 300 characters is the most it may say.
  assert.equal((await kinds(parseFinding({ trace: [{ ...parseFinding().trace[0], step: 'x'.repeat(300) }] }))).findings.length, 1);
});

test('code step 2: scope is checked by code — the anchor must touch a changed line; a contract break may quote one instead', async () => {
  const kinds = async (finding) => (await run(passJudge({ check: contradicting, pass: onBehaviour(finding) }))).codePass;
  // Line 3 is unchanged: out of scope, even with a grounded quote on it.
  const unchanged = parseFinding({ anchor: { path: 'src/parse.js', side: 'new', startLine: 3, endLine: 3 },
    trace: [{ ...parseFinding().trace[0], startLine: 3, endLine: 3, quote: 'return parts.map((part) => part.trim());' }] });
  assert.deepEqual((await kinds(unchanged)).rejected, [{ reason: 'out_of_scope', lens: 'behaviour' }]);
  // A contract break in an unchanged caller is kept when a step quotes the changed line.
  const caller = parseFinding({ kind: 'contract_break', anchor: { path: 'src/util.js', side: 'new', startLine: 3, endLine: 3 },
    trace: [parseFinding().trace[0], { step: 'trimAll expects the old parts.', source: 'file', path: 'src/util.js', side: 'new',
      startLine: 3, endLine: 3, quote: 'export function trimAll(list)' }] });
  assert.equal((await kinds(caller)).findings.length, 1);
  assert.deepEqual((await kinds({ ...caller, kind: 'bug' })).rejected, [{ reason: 'out_of_scope', lens: 'behaviour' }]);
  // The removed line, on its old side, is in scope.
  const removed = parseFinding({ anchor: { path: 'src/parse.js', side: 'old', startLine: 2, endLine: 2 },
    trace: [{ step: 'It split on semicolons.', source: 'base', path: 'src/parse.js', side: 'old', startLine: 2, endLine: 2,
      quote: 'const parts = input.split(";");' }] });
  assert.equal((await kinds(removed)).findings.length, 1);
});

test('code step 2: open questions for the human are a separate list, each quoting the ask or decision it concerns', async () => {
  const ask = (prompt) => dossierItems(prompt).find((i) => i.kind === 'ask');
  const decision = (prompt) => dossierItems(prompt).find((i) => i.kind === 'decision');
  const questions = (prompt, lens) => (lens !== 'ask' ? [] : [
    { question: 'Should an empty input be an error instead?', key: ask(prompt).key, quote: 'returns [] for empty input' },
    { question: 'Was splitting on commas yours to choose?', key: decision(prompt).key, quote: 'not in its words' },
    { question: 'A claim is no ask.', key: dossierItems(prompt).find((i) => i.kind === 'claim').key, quote: 'parse now returns' },
    { question: 'Same again?', key: ask(prompt).key, quote: 'returns [] for empty input', extra: true }]);
  const result = await run(passJudge({ check: contradicting, questions }));
  assert.deepEqual(result.codePass.findings, []);
  assert.deepEqual(result.codePass.questions.map((q) => [q.question, q.lens, q.concerns.kind, q.concerns.source, q.quote.eventId,
    q.quote.role, q.quote.quote]), [['Should an empty input be an error instead?', 'ask', 'ask', 'requirements', 'I1',
    'instruction', 'returns [] for empty input']]);
  assert.deepEqual(result.codePass.rejected, [{ reason: 'evidence_grounding_failed', lens: 'ask', question: true,
    cause: 'quote_ungrounded' }, { reason: 'malformed', lens: 'ask', question: true }, { reason: 'malformed', lens: 'ask',
    question: true }]);
});

test('code step 2: a step may quote the person\'s words; behaviour stands on its trace, each step grounded', async () => {
  const fromAsk = parseFinding({ kind: 'ask_not_met', trace: [{ step: 'You asked for [] on empty input.', source: 'session',
    path: null, side: null, startLine: null, endLine: null, quote: 'returns [] for empty input' }, parseFinding().trace[0]] });
  const seen = [];
  const result = await run(passJudge({ check: contradicting, pass: (p, lens) => (lens === 'ask' ? [fromAsk] : []), seen }));
  assert.equal(result.codePass.findings.length, 1);
  assert.deepEqual(result.codePass.findings[0].trace[0], { step: 'You asked for [] on empty input.', source: 'session',
    eventId: 'I1', role: 'instruction', quote: 'returns [] for empty input' });
  // A session quote in no shown session text grounds nothing.
  const invented = { ...fromAsk, trace: [{ ...fromAsk.trace[0], quote: 'SYNTHETIC words nobody said' }, fromAsk.trace[1]] };
  const refused = await run(passJudge({ check: contradicting, pass: (p, lens) => (lens === 'ask' ? [invented] : []) }));
  assert.deepEqual(refused.codePass.rejected, [{ reason: 'evidence_grounding_failed', lens: 'ask', cause: 'quote_ungrounded' }]);
  // The challenger of an ask not met is shown the person's words.
  const challenge = seen.find((r) => r.label.startsWith('challenge:code-finding'));
  assert.ok(challenge.prompt.includes(CODE_TEXT.ask));
});

test('code step checks: grounding first, one repair, then evidence_grounding_failed', async () => {
  const offAnchor = parseFinding({ trace: [{ ...parseFinding().trace[0], startLine: 4, endLine: 4 }] });
  const seen = [];
  const fixed = await run(passJudge({ check: contradicting, pass: onBehaviour(offAnchor), seen,
    repair: (request) => (request.label.startsWith('code-pass') ? { findings: [parseFinding()], questions: [] } : {}) }));
  assert.deepEqual(seen.filter((r) => /receipt-repair$/.test(r.label)).map((r) => r.label), ['code-pass:behaviour:receipt-repair']);
  assert.equal(fixed.codePass.findings.length, 1);
  const failed = await run(passJudge({ check: contradicting, pass: onBehaviour(offAnchor) }));
  assert.deepEqual(failed.codePass.rejected, [{ reason: 'evidence_grounding_failed', lens: 'behaviour', cause: 'anchor_off_quote' }]);
});

test('code step checks: a challenger sees the finding, the change and the files it touches — never the dossier, the lens or another finding', async () => {
  // A second finding at another place (the removed line, on its old side): findings at one anchor merge.
  const other = parseFinding({ kind: 'missed_case', title: 'SYNTHETIC second finding', input: 'parse(" ")',
    anchor: { path: 'src/parse.js', side: 'old', startLine: 2, endLine: 2 }, trace: [{ step: 'It split on semicolons.',
      source: 'base', path: 'src/parse.js', side: 'old', startLine: 2, endLine: 2, quote: 'const parts = input.split(";");' }] });
  const caller = parseFinding({ kind: 'contract_break', title: 'trimAll', anchor: { path: 'src/util.js', side: 'new',
    startLine: 3, endLine: 3 }, trace: [parseFinding().trace[0], { step: 'trimAll is called.', source: 'file',
    path: 'src/util.js', side: 'new', startLine: 3, endLine: 3, quote: 'export function trimAll(list)' }] });
  const seen = [];
  await run(passJudge({ check: contradicting, pass: (p, lens) => (lens === 'behaviour' ? [parseFinding({ leadsFrom: ['S2'] }), other]
    : lens === 'contracts' ? [caller] : []), seen }));
  const challenges = seen.filter((r) => r.label.startsWith('challenge:code-finding'));
  assert.equal(challenges.length, 9, 'three findings, three passes each, one finding per request');
  for (const request of challenges) {
    assert.equal(candidatesOf(request.prompt, request.challenge.items).length, 1);
    assert.equal(request.challenge.items.length, 1);
    assert.ok(!request.prompt.includes('{"key":"S'), 'no dossier item');
    assert.ok(!request.prompt.includes('parse now returns an empty list'), 'no claim of the agent\'s');
    assert.ok(!/Lens:|"lens"|behaviour|contracts/.test(request.prompt), 'no lens');
    assert.ok(!request.prompt.includes(CODE_TEXT.ask), 'the person\'s words only for an ask not met');
    assert.match(request.prompt, /^## Files \(1\)$/m);
    assert.match(request.system, /Give the verdict first/);
    assert.ok(request.system.includes(CODE_STEP_FINDING_NOTE));
  }
  const titles = challenges.map((r) => candidatesOf(r.prompt, r.challenge.items)[0].title);
  for (const [i, request] of challenges.entries())
    for (const title of new Set(titles)) if (title !== titles[i]) assert.ok(!request.prompt.includes(title), 'never another finding');
  // A finding touching two files: its three passes order them three fixed ways.
  const two = challenges.filter((r) => candidatesOf(r.prompt, r.challenge.items)[0].title === 'trimAll');
  const order = (r) => shownFiles(r.prompt).map((f) => f.path).join(',');
  assert.deepEqual(two.map(order), ['src/parse.js,src/util.js', 'src/util.js,src/parse.js', 'src/parse.js,src/util.js']);
  assert.notEqual(two[0].prompt, two[1].prompt);
});

test('code step checks: verdict first, closed reasons; an upheld vote must cite the anchor and the last step, or it is dissent', async () => {
  assert.equal(codeStepVoteShape({ key: 'F1', verdict: 'upheld', reason: null, receipts: [], explanation: 'x' }), true);
  assert.equal(codeStepVoteShape({ key: 'F1', verdict: 'refuted', reason: 'incorrect', receipts: [], explanation: 'x' }), true);
  assert.equal(codeStepVoteShape({ key: 'F1', verdict: 'refuted', reason: 'wrong', receipts: [], explanation: 'x' }), false);
  assert.equal(codeStepVoteShape({ key: 'F1', verdict: 'upheld', reason: 'incorrect', receipts: [], explanation: 'x' }), false);
  assert.equal(codeStepVoteShape({ key: 'F1', verdict: 'not-refuted', reason: null, receipts: [], explanation: 'x' }), false);
  const finding = parseFinding();
  // Upheld but citing only an unrelated line: dissent, so nothing is published.
  const elsewhere = (c) => ({ ...upheld(c), receipts: [{ path: 'src/parse.js', side: 'new', startLine: 1, endLine: 1,
    quote: 'export function parse(input) {' }] });
  const weak = await run(passJudge({ check: contradicting, pass: onBehaviour(finding), vote: elsewhere }));
  assert.deepEqual(weak.codePass.findings, []);
  assert.deepEqual(weak.codePass.rejected, [{ reason: 'challenge_unsettled', lens: 'behaviour' }]);
  // Upheld citing a quote that is in no shown file: dissent.
  const forged = (c) => ({ ...upheld(c), receipts: [{ path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2,
    quote: 'SYNTHETIC: in no file' }] });
  const unground = await run(passJudge({ check: contradicting, pass: onBehaviour(finding), vote: forged }));
  assert.deepEqual(unground.codePass.findings, []);
  assert.equal(checkOf(unground, 'claim').reason, 'challenge_unsettled');
  // Step 1 binds an upheld vote to the answer's own file: a grounded quote of another file is no support.
  const otherFile = (c) => ({ ...upheld(c), receipts: [{ path: 'src/util.js', side: 'new', startLine: 1, endLine: 1,
    quote: 'export const SEPARATOR = ",";' }] });
  assert.equal(checkOf(await run(passJudge({ check: contradicting, vote: otherFile })), 'claim').reason, 'challenge_unsettled');
  // Two upholds and one refutation: dissent (the run is unanimous); two refutations: refuted, with its closed reasons.
  const split = (c, request) => (request.challenge.pass === 3 ? upheld(c, 'refuted') : upheld(c));
  const unsettled = await run(passJudge({ check: contradicting, pass: onBehaviour(finding), vote: split }));
  assert.deepEqual(unsettled.codePass.rejected, [{ reason: 'challenge_unsettled', lens: 'behaviour' }]);
  const mostly = (c, request) => (request.challenge.pass === 1 ? upheld(c) : { ...upheld(c, 'refuted'), reason: 'mitigation_shown' });
  const refuted = await run(passJudge({ check: contradicting, pass: onBehaviour(finding), vote: mostly }));
  assert.deepEqual(refuted.codePass.rejected, [{ reason: 'challenge_refuted', lens: 'behaviour',
    refutations: { mitigation_shown: 2 } }]);
  assert.equal(checkOf(refuted, 'claim').reason, 'challenge_refuted');
  assert.deepEqual(refuted.codePass.challenges.finding.refutations, { mitigation_shown: 2 });
});

test('code step checks: a vote outside the closed shape is asked again once, like a missing one', async () => {
  const seen = [];
  // Pass 2's first reply carries an extra field on its vote (h2's structural loss); its re-ask answers well.
  const shaped = (c, request) => (request.challenge.pass === 2 && !request.challenge.reask ? { ...upheld(c), path: 'x' } : upheld(c));
  const result = await run(passJudge({ check: contradicting, pass: onBehaviour(parseFinding()), vote: shaped, seen }));
  assert.equal(result.codePass.findings.length, 1);
  assert.deepEqual(seen.filter((r) => /:reask:/.test(r.label)).map((r) => r.label),
    ['challenge:code-check:reask:p2', 'challenge:code-finding:reask:p2']);
  assert.match(seen.find((r) => r.label === 'challenge:code-finding:reask:p2').prompt, /## Re-ask — one attempt only/);
  // Malformed again: that pass never voted, so nothing is published and the footer names the checks.
  const always = (c, request) => (request.challenge.pass === 2 ? { ...upheld(c), path: 'x' } : upheld(c));
  const missing = await run(passJudge({ check: contradicting, pass: onBehaviour(parseFinding()), vote: always }));
  assert.deepEqual(missing.codePass.rejected, [{ reason: 'challenge_unexecuted', lens: 'behaviour' }]);
  assert.equal(checkOf(missing, 'claim').reason, 'challenge_unexecuted');
  assert.deepEqual(missing.codePass.footer.failed, [{ step: 'finding_challenge' }, { step: 'check_challenge' }]);
  assert.equal(missing.codePass.coverage, 'partial');
});

test('code step output: lenses reaching the same anchor make one finding; foundByLenses is computed, never rated', async () => {
  const both = (p, lens) => (['behaviour', 'tests'].includes(lens) ? [parseFinding({ leadsFrom: lens === 'tests' ? ['S1'] : [] })] : []);
  const result = await run(passJudge({ check: contradicting, pass: both }));
  assert.equal(result.codePass.findings.length, 1);
  assert.deepEqual(result.codePass.findings[0].foundByLenses, ['behaviour', 'tests']);
  assert.deepEqual(result.codePass.findings[0].leadsFrom.map((l) => l.key), ['S1']);
  for (const word of ['severity', 'confidence', 'rank', 'approved', 'score'])
    assert.ok(!JSON.stringify(result.codePass.findings).includes(`"${word}"`), word);
});

test('code step output: the coverage footer names what was listed by name, clipped, withheld and failed', async () => {
  const pad = `// ${'x'.repeat(600_000)}\n`;
  const session = codeSession({ reads: ['src/big.js'] });
  const files = { ...CODE_FILES, 'src/util.js': `${CODE_FILES['src/util.js']}${pad}`, 'src/big.js': pad };
  const failing = passJudge({ check: contradicting });
  const result = await run(async (request) => { if (request.label === 'code-pass:tests') throw new Error('model_timeout');
    return failing(request); }, { session, snapshot: gitSnapshotOf({ session, files }), bound: 1_000_000 });
  assert.deepEqual(result.codePass.footer, { listed_by_name: ['src/big.js'], clipped: [],
    withheld: [{ path: '.env', state: 'credential_path' }], failed: [{ step: 'lens', lens: 'tests', group: 1 }] });
  assert.equal(result.codePass.coverage, 'partial');
  assert.deepEqual(result.codePass.files.map((f) => [f.path, f.state]), [['src/parse.js', 'shown'], ['src/util.js', 'shown'],
    ['.env', 'credential_path'], ['src/big.js', 'not_shown']]);
  // A file over what one request can carry alone is clipped, and named.
  const huge = { ...files, 'src/big.js': `// ${'x'.repeat(1_100_000)}\n` };
  const clipped = await run(passJudge({ check: contradicting }), { session, snapshot: gitSnapshotOf({ session, files: huge }),
    bound: 1_000_000 });
  assert.deepEqual(clipped.codePass.footer.clipped, ['src/big.js']);
});

test('code step: a change over the bound splits into file groups; each group gets every lens; hunks are never dropped', async () => {
  const n = 2000;
  const text = (sign) => `${Array.from({ length: n }, (_, i) => `export const v${i} = ${sign}${i};`).join('\n')}\n`;
  const rewrite = `@@ -1,${n} +1,${n} @@\n${text('-').trimEnd().split('\n').map((l) => `-${l}`).join('\n')}\n`
    + `${text('').trimEnd().split('\n').map((l) => `+${l}`).join('\n')}\n`;
  const extra = ['gen1.js', 'gen2.js'].map((path) => ({ path, type: 'modified', head: text(''), base: text('-'), patch: rewrite }));
  const snapshot = gitSnapshotOf({ extra });
  // Room for every hunk at once: one group.
  assert.equal((await run(passJudge({ check: contradicting }), { snapshot, bound: 1_620_000 })).codePass.groups, 1);
  const seen = [];
  const bound = 300_000;
  const result = await run(passJudge({ check: contradicting, seen }), { snapshot, bound });
  assert.equal(result.codePass.groups, 2);
  assert.deepEqual(seen.filter((r) => r.label.startsWith('code-pass:')).map((r) => r.label),
    ['code-pass:behaviour:g1', 'code-pass:tests:g1', 'code-pass:contracts:g1', 'code-pass:ask:g1',
      'code-pass:behaviour:g2', 'code-pass:tests:g2', 'code-pass:contracts:g2', 'code-pass:ask:g2']);
  const lensRequests = seen.filter((x) => x.label.startsWith('code-pass:'));
  for (const r of lensRequests) {
    assert.match(r.prompt, /^## Files \(3\)$/m, 'the full table of contents in every group');
    assert.match(r.prompt, /^\{"key":"S1"/m, 'and the dossier');
    assert.ok(Buffer.byteLength(r.system) + Buffer.byteLength(r.prompt) <= bound);
  }
  // Every file's hunks are in some group.
  for (const path of ['gen1.js', 'gen2.js', 'src/parse.js'])
    assert.ok(lensRequests.some((r) => r.prompt.includes(`diff --git a/${path} b/${path}`)), path);
});

test('code step: with no root, or no file to show, nothing is asked: rows read not checked, the pass is missing', async () => {
  const session = codeSession();
  const seen = [];
  const none = await runCodePass({ report: sessionReport(), session, snapshot: [], bound: BOUND, ran: false,
    judge: passJudge({ seen }) });
  assert.equal(seen.length, 0);
  assert.equal(none.codePass.coverage, 'missing');
  assert.ok([...none.checks.values()].every(({ check }) => check.reason === 'file_not_shown'));
  const joined = withCodePass({ ...sessionReport(), coverageFacts: undefined }, none);
  assert.equal(reviewRunState(joined), 'incomplete');
  const withheld = await runCodePass({ report: sessionReport(), session, bound: BOUND, judge: passJudge({ seen }),
    snapshot: snapshotOf(session, CODE_FILES, { 'src/parse.js': 'outside_root', 'src/util.js': 'harness_home',
      '.env': 'credential_path' }) });
  assert.equal(seen.length, 0);
  assert.equal(withheld.codePass.coverage, 'missing');
  assert.deepEqual(withheld.codePass.gaps, [{ code: 'code_unreviewable', channel: 'code', scope: 'repository', count: 3,
    byState: { credential_path: 1, harness_home: 1, outside_root: 1 } }]);
});

test('code step: a step the request bound leaves unsent is request_bound, never "no answer"', async () => {
  const seen = [];
  const result = await run(passJudge({ check: contradicting, seen }), { bound: 20_000 });
  assert.deepEqual(seen, [], 'neither step has room for any code under the bound: nothing is sent');
  assert.ok([...result.checks.values()].every(({ check }) => check.reason === 'request_bound'));
  assert.deepEqual(result.codePass.rejected.map((r) => r.reason), ['request_bound', 'request_bound', 'request_bound',
    'request_bound']);
  assert.equal(result.codePass.coverage, 'missing');
});

test('code step guards: drift, receipt-less answers, a failed write baseline, the rows step 1 reads', async () => {
  const drifted = { ...CODE_FILES, 'src/parse.js': CODE_FILES['src/parse.js'].replace('trim()', 'trimEnd()') };
  const result = await run(passJudge({ check: () => [] }), { snapshot: snapshotOf(codeSession(), drifted) });
  assert.equal(checkOf(result, 'ask').reason, 'file_changed_since_session', 'the ask\'s deliverable wrote src/parse.js');
  assert.equal(checkOf(result, 'claim').reason, 'no_answer', 'the claim names no file');
  const bare = (rows) => rows.map((row) => ({ key: row.key, answer: row.kind === 'claim' ? 'shows' : 'cannot-tell',
    explanation: 'Synthetic: no receipt.', receipts: [] }));
  const seen = [];
  const noReceipt = await run(passJudge({ check: bare, seen }));
  assert.deepEqual(checkOf(noReceipt, 'claim'), { outcome: 'not-checked-in-code', receipts: [], reason: 'quote_ungrounded' });
  assert.ok(!seen.some((r) => r.label.startsWith('challenge:code-check')));
  const T1 = { turn: 'T1' };
  const blobs = { ask: 'SYNTHETIC_ASK: set a to 1.', one: 'export const a = 1;\n', two: 'export const a = 2;\n',
    ok: 'File written', no: 'Error: SYNTHETIC write refused' };
  const session = buildCodeSession('s-failed-write', blobs, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'a.js', blob: 'one', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'ok', ...T1 },
    { id: 'W2', kind: 'invocation', write: 'a.js', blob: 'two', ...T1 },
    { id: 'W2-r', kind: 'observation', invocation: 'W2', blob: 'no', result: 'failed', exitCode: 1, ...T1 },
  ]);
  const plan = codeSnapshotPlan(session);
  assert.deepEqual(plan[0].last, { deleted: false, spans: [blobs.one] });
  assert.deepEqual(plan[0].edits.map((e) => e.after), [[blobs.one]], 'the failed write is no recorded edit of the file');
  assert.equal(freezeCodeSnapshot(plan, [{ path: 'a.js', bytes: enc(blobs.one) }])[0].state, 'readable');
  const said = 'done, parse handles empty input and the tests pass.';
  const report = { ...sessionReport(),
    writtenClaims: [{ id: 'w1', label: 'unverified', stated: R('W1', 'code', 'export function parse(input) {') }],
    findings: [{ id: 'f1', kind: 'claim_contradicted', receipts: [R('C2', 'commentary', said), R('W1', 'code', QUOTE)] },
      { id: 'f2', kind: 'claim_contradicted', origin: 'code-review', receipts: [R('C2', 'commentary', said)] }] };
  const rows = codeCheckRows(report, codeSession());
  assert.deepEqual(rows.map((r) => [r.key, r.kind, r.source]), [['R1', 'claim', 'promises'], ['R2', 'claim', 'writtenClaims'],
    ['R3', 'claim', 'findings'], ['R4', 'ask', 'requirements'], ['R5', 'decision', 'decisions'], ['R6', 'decision', 'decisions']]);
  assert.equal(buildCodeCheckRequest(rows, { change: 'C', filesText: 'F' }).prompt,
    buildCodeCheckRequest(codeCheckRows(structuredClone(report), codeSession()), { change: 'C', filesText: 'F' }).prompt);
});

test('code step: every withheld reason, cause and gap is a member of its closed list; the record holds no file text', async () => {
  const quiet = passJudge({ check: contradicting, pass: onBehaviour(parseFinding()) });
  const runs = [
    await run(passJudge({ check: contradicting, pass: onBehaviour(parseFinding({ severity: 'high' })) })),
    await run(passJudge({ check: contradicting, pass: onBehaviour(parseFinding({ trace: [{ ...parseFinding().trace[0],
      quote: 'SYNTHETIC nowhere' }] })) })),
    await run(passJudge({ check: contradicting, pass: onBehaviour(parseFinding()), vote: (c) => upheld(c, 'refuted') })),
    await run(async (request) => { if (request.challenge) throw new Error('model_timeout'); return quiet(request); }),
  ];
  const rejected = runs.flatMap((r) => r.codePass.rejected);
  assert.deepEqual([...new Set(rejected.map((r) => r.reason))].sort(), ['challenge_refuted', 'challenge_unexecuted',
    'evidence_grounding_failed', 'malformed']);
  for (const { reason, cause, lens } of rejected) {
    assert.ok(CODE_FINDING_WITHHELD.includes(reason), reason);
    assert.ok(CODE_PASS_LENSES.includes(lens), lens);
    if (cause !== undefined) assert.ok(CODE_CHECK_REASONS.includes(cause), cause);
  }
  for (const r of runs) {
    assert.ok(r.codePass.files.every((f) => !Object.hasOwn(f, 'text')));
    assert.ok(r.codePass.gaps.every((g) => GAP_CODES.includes(g.code)));
    assert.ok(r.codePass.footer.failed.every((x) => CODE_STEP_PARTS.includes(x.step)));
  }
});

test('code step: requestWords gives the person\'s words, each with the event it grounds in', () => {
  const words = requestWords(codeSession());
  assert.deepEqual(words.asked, [CODE_TEXT.ask]);
  assert.deepEqual(words.sources, [{ eventId: 'I1', role: 'instruction', text: CODE_TEXT.ask, actor: 'person' }]);
});

// ---- the review of the code step (FAIL, 2026-10-14): every finding, by structure, each with a test that breaks ---------

/** The fixture's session with a failing command run after the write, its output long enough to be cut (head and tail). */
const LONG_OUTPUT = Array.from({ length: 300 }, (_, i) => `SYNTHETIC failing run line ${String(i).padStart(3, '0')}`)
  .join('\n');
const RESPONSE = 'SYNTHETIC_AGENT_RESPONSE: that failure is flaky and unrelated to my change';
function failingSession() {
  const T1 = { turn: 'T1' };
  const blobs = { ...CODE_TEXT, test: 'npm test', out: LONG_OUTPUT, response: RESPONSE };
  return buildCodeSession('sess-code-pass-failing', blobs, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
    { id: 'R1', kind: 'invocation', read: 'src/util.js', blob: 'readUtil', ...T1 },
    { id: 'R1-r', kind: 'observation', invocation: 'R1', blob: 'readOut', ...T1 },
    { id: 'R2', kind: 'invocation', read: '.env', blob: 'readEnv', ...T1 },
    { id: 'X1', kind: 'invocation', operation: 'command', tool: 'Bash', paths: [], changes: [], input: [],
      command: [{ sourceKey: 'test', fromByte: 0, untilByte: 8 }], callKey: 'X1', ...T1 },
    { id: 'X1-r', kind: 'observation', invocation: 'X1', blob: 'out', result: 'failed', exitCode: 1, ...T1 },
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 },
    { id: 'C3', kind: 'commentary', blob: 'response', ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 },
  ]);
}
const failingReport = () => ({ ...sessionReport(), failures: [{ eventId: 'X1-r', handling: 'passed-over',
  outcome: 'ran-failed', response: R('C3', 'commentary', RESPONSE) }] });
const sessionStep = (quote, step = 'The session shows it.') => ({ step, source: 'session', path: null, side: null,
  startLine: null, endLine: null, quote });
const CLAIM_QUOTE = 'parse now returns an empty list for empty input.';
const challengesOf = (seen) => seen.filter((r) => r.label.startsWith('challenge:code-finding'));

test('review of the code step (high): a path git diffs without text is binary — never shown, never grounded, never "complete"', async () => {
  const SQL = 'DELETE FROM users WHERE id = $1;\n';
  // The reviewer's probe: staged db/migrate.sql under `*.sql -diff` — git's patch holds "Binary files … differ", no hunk.
  const added = ['diff --git a/db/migrate.sql b/db/migrate.sql', 'new file mode 100644', 'index 0000000..8f23bde',
    'Binary files /dev/null and b/db/migrate.sql differ', ''].join('\n');
  const session = codeSession();
  const snapshot = gitSnapshotOf({ session, extra: [{ path: 'db/migrate.sql', type: 'added', head: SQL, patch: added }] });
  const sql = snapshot.find((f) => f.path === 'db/migrate.sql');
  assert.deepEqual(['state', 'diff', 'hunks', 'base', 'text', 'id'].map((k) => sql[k]),
    ['binary', 'withheld', [], null, undefined, undefined]);
  // Modified under -diff, and an added file whose patch has no hunk though it has text: binary too.
  const modified = gitSnapshotOf({ extra: [{ path: 'db/old.sql', type: 'modified', head: 'SELECT 2;\n', base: 'SELECT 1;\n',
    patch: 'diff --git a/db/old.sql b/db/old.sql\nindex e0ac49d..e7f8100 100644\nBinary files a/db/old.sql and b/db/old.sql differ\n' }] })
    .find((f) => f.path === 'db/old.sql');
  assert.deepEqual([modified.state, modified.diff, modified.base], ['binary', 'withheld', null]);
  const silent = gitSnapshotOf({ extra: [{ path: 'x.min.js', type: 'added', head: 'a\n', patch: 'diff --git a/x.min.js b/x.min.js\n' }] })
    .find((f) => f.path === 'x.min.js');
  assert.equal(silent.state, 'binary');
  // A mode change only (no hunk, the same text) is still shown: nothing of it changed.
  const mode = gitSnapshotOf({ extra: [{ path: 'run.sh', type: 'modified', head: 'echo\n', base: 'echo\n',
    patch: 'diff --git a/run.sh b/run.sh\nold mode 100644\nnew mode 100755\n' }] }).find((f) => f.path === 'run.sh');
  assert.deepEqual([mode.state, mode.diff, mode.hunks], ['readable', 'unrecorded_change', []]);
  // A behaviour finding whose trace quotes the binary file: never grounded, never sent to a checker, never published.
  const finding = parseFinding({ anchor: { path: 'db/migrate.sql', side: 'new', startLine: 1, endLine: 1 },
    trace: [{ step: 'It deletes a user.', source: 'file', path: 'db/migrate.sql', side: 'new', startLine: 1, endLine: 1,
      quote: 'DELETE FROM users WHERE id = $1;' }] });
  const seen = [];
  const result = await run(passJudge({ check: contradicting, pass: onBehaviour(finding), seen }), { session, snapshot });
  assert.deepEqual(result.codePass.findings, []);
  assert.deepEqual(result.codePass.rejected, [{ reason: 'evidence_grounding_failed', lens: 'behaviour', cause: 'file_not_shown' }]);
  assert.equal(challengesOf(seen).length, 0);
  // No request held a line of it, nor said it changed no line; its row says it is withheld, its file that it is binary.
  // (A receipt repair sends the reviewer's own failed findings back after the request: only the request is read here.)
  for (const request of seen) {
    const shown = request.prompt.split('\n\n## Receipt repair — one attempt only\n')[0];
    assert.ok(!shown.includes('DELETE FROM users'), request.label);
    assert.ok(!shown.includes('(no line changed'), request.label);
  }
  const lens = seen.find((r) => r.label === 'code-pass:behaviour');
  assert.match(lens.prompt, /^- db\/migrate\.sql · added · withheld: no hunk shown$/m);
  assert.match(lens.prompt, /^- db\/migrate\.sql · not shown: binary$/m);
  // The record: binary, counted as withheld, and the coverage partial (it was complete without it).
  assert.equal(result.codePass.files.find((f) => f.path === 'db/migrate.sql').state, 'binary');
  assert.deepEqual(result.codePass.footer.withheld, [{ path: 'db/migrate.sql', state: 'binary' },
    { path: '.env', state: 'credential_path' }]);
  assert.equal(result.codePass.coverage, 'partial');
  assert.equal((await run(passJudge({ check: contradicting }))).codePass.coverage, 'complete');
  // Even with no finding and no other change, a withheld change keeps coverage from "complete".
  const only = await run(passJudge({ check: contradicting }), { session, snapshot });
  assert.equal(only.codePass.coverage, 'partial');
});

test('review of the code step (high): hunks must turn the base into the file now; an added file shows only what its hunks hold', () => {
  // Every row matches its file, but the patch leaves out the change on line 3: unreadable, nothing shown.
  const partial = gitSnapshotOf({ extra: [{ path: 'abc.js', type: 'modified', head: 'A\nb\nC\n', base: 'a\nb\nc\n',
    patch: '@@ -1 +1 @@\n-a\n+A\n' }] }).find((f) => f.path === 'abc.js');
  assert.deepEqual([partial.diff, partial.hunks], ['unreadable', []]);
  const whole = gitSnapshotOf({ extra: [{ path: 'abc.js', type: 'modified', head: 'A\nb\nC\n', base: 'a\nb\nc\n',
    patch: '@@ -1,3 +1,3 @@\n-a\n+A\n b\n-c\n+C\n' }] }).find((f) => f.path === 'abc.js');
  assert.equal(whole.diff, 'unrecorded_change');
  // An added file shown by its hunks grounds only on the lines its rows hold.
  const files = gitSnapshotOf({ extra: [{ path: 'new.js', type: 'added', head: 'one line\ntwo line\n',
    patch: '@@ -0,0 +1,2 @@\n+one line\n+two line\n' }] });
  const session = codeSession();
  const facade = sourceSession(session, { sources: files.filter((f) => f.state === 'readable').map((f) => ({ eventId: f.id,
    text: f.text })) });
  const view = codeView({ files, hunkPaths: new Set(['new.js']), wholePaths: [] });
  const ground = (quote, line) => groundCodeReceipt({ path: 'new.js', side: 'new', startLine: line, endLine: line, quote },
    { view, facade, files });
  assert.equal(ground('two line', 2).ok, true);
  assert.deepEqual(view.ranges('new.js', 'new'), [[1, 2]]);
});

test('review of the code step (M5, low): a file shown only by its hunks grounds a quote only on its rows, each side\'s run one text', () => {
  const long = Array.from({ length: 20 }, (_, i) => `const line${i + 1} = ${i + 1};`);
  const head = [...long];
  head[9] = 'const line10 = 100;';
  const patch = `@@ -7,7 +7,7 @@\n${long.slice(6, 9).map((l) => ` ${l}`).join('\n')}\n-${long[9]}\n+${head[9]}\n`
    + `${long.slice(10, 13).map((l) => ` ${l}`).join('\n')}\n`;
  const files = gitSnapshotOf({ extra: [{ path: 'long.js', type: 'modified', head: `${head.join('\n')}\n`,
    base: `${long.join('\n')}\n`, patch }, { path: 'join.js', type: 'modified', head: 'x = 1;\nz = 3;\n',
    base: 'x = 1;\ny = 2;\nz = 3;\n', patch: '@@ -1,3 +1,2 @@\n x = 1;\n-y = 2;\n z = 3;\n' }] });
  const session = codeSession();
  const facade = sourceSession(session, { sources: [...files.filter((f) => f.state === 'readable').map((f) => ({
    eventId: f.id, text: f.text })), ...files.filter((f) => f.base?.id).map((f) => ({ eventId: f.base.id, text: f.base.text }))] });
  const view = codeView({ files, hunkPaths: new Set(['long.js', 'join.js']), wholePaths: [] });
  const ground = (path, side, startLine, endLine, quote) => groundCodeReceipt({ path, side, startLine, endLine, quote },
    { view, facade, files });
  // Widened, the hunk shows new lines 2 to 14; line 18 is literally in the file, but no request showed it.
  assert.equal(ground('long.js', 'new', 12, 12, 'const line12 = 12;').ok, true);
  assert.equal(ground('long.js', 'new', 18, 18, 'const line18 = 18;').reason, 'file_not_shown');
  // A quote joining two new lines a removed row sits between was never shown as one text; on the old side it was.
  assert.deepEqual(view.ranges('join.js', 'new'), [[1, 1], [2, 2]]);
  assert.equal(ground('join.js', 'new', 1, 2, 'x = 1;\nz = 3;').reason, 'file_not_shown');
  assert.equal(ground('join.js', 'new', 2, 2, 'z = 3;').ok, true);
  assert.equal(ground('join.js', 'old', 1, 2, 'x = 1;\ny = 2;').ok, true);
});

test('review of the code step (M6b): a session quote grounds only in the recording — never across the cut of a long output', async () => {
  const session = failingSession();
  const report = failingReport();
  const at = LONG_OUTPUT.length - 2000;
  // The dossier shows the head and tail of the output with the middle named; a quote across that mark is in what the
  // request showed but not in the recording.
  const across = `${LONG_OUTPUT.slice(1980, 2000)}\n[… ${at - 2000} characters not shown …]`;
  const inHead = LONG_OUTPUT.slice(40, 100);
  const seen = [];
  const prompted = await run(passJudge({ check: contradicting, seen }), { report, session, snapshot: gitSnapshotOf({ session }) });
  assert.ok(seen.find((r) => r.label === 'code-pass:behaviour').prompt.includes(JSON.stringify(across).slice(1, -1)),
    'the request showed the cut');
  assert.equal(prompted.codePass.findings.length, 0);
  const finding = (quote) => parseFinding({ trace: [sessionStep(quote, 'The run failed there.'), parseFinding().trace[0]] });
  const cut = await run(passJudge({ check: contradicting, pass: onBehaviour(finding(across)) }),
    { report, session, snapshot: gitSnapshotOf({ session }) });
  assert.deepEqual(cut.codePass.rejected, [{ reason: 'evidence_grounding_failed', lens: 'behaviour', cause: 'quote_ungrounded' }]);
  const kept = await run(passJudge({ check: contradicting, pass: onBehaviour(finding(inHead)) }),
    { report, session, snapshot: gitSnapshotOf({ session }) });
  assert.equal(kept.codePass.findings.length, 1);
  assert.deepEqual([kept.codePass.findings[0].trace[0].eventId, kept.codePass.findings[0].trace[0].role], ['X1-r', 'observation']);
});

test('review of the code step (M7, M8, M15): an upheld vote must cite the anchor AND the last step; the anchor must lie on a code step', async () => {
  const LINE3 = 'return parts.map((part) => part.trim());';
  const finding = parseFinding({ trace: [parseFinding().trace[0], { step: 'Each part is trimmed and returned.',
    source: 'file', path: 'src/parse.js', side: 'new', startLine: 3, endLine: 3, quote: LINE3 }] });
  const cite = (lines) => (c) => (c.trace ? { ...upheld(c), receipts: lines.map((line) => ({ path: 'src/parse.js',
    side: 'new', startLine: line, endLine: line, quote: line === 2 ? QUOTE : LINE3 })) } : upheld(c));
  const runWith = async (vote) => (await run(passJudge({ check: contradicting, pass: onBehaviour(finding), vote }))).codePass;
  assert.equal((await runWith(cite([2, 3]))).findings.length, 1, 'the anchor and the last step: support');
  assert.deepEqual((await runWith(cite([2]))).rejected, [{ reason: 'challenge_unsettled', lens: 'behaviour' }],
    'the anchor alone: the last step is not cited');
  assert.deepEqual((await runWith(cite([3]))).rejected, [{ reason: 'challenge_unsettled', lens: 'behaviour' }],
    'the last step alone: the anchor is not cited');
  // An anchor on a changed line that no code step of the trace quotes is off its quote, whatever its scope.
  const offTrace = parseFinding({ trace: [{ step: 'Each part is trimmed.', source: 'file', path: 'src/parse.js',
    side: 'new', startLine: 3, endLine: 3, quote: LINE3 }] });
  const off = (await run(passJudge({ check: contradicting, pass: onBehaviour(offTrace) }))).codePass;
  assert.deepEqual(off.rejected, [{ reason: 'evidence_grounding_failed', lens: 'behaviour', cause: 'anchor_off_quote' }]);
});

test('review of the code step (medium): a trace step may quote the person or a recorded result, never the agent', async () => {
  const session = failingSession();
  const report = failingReport();
  const snapshot = gitSnapshotOf({ session });
  // The fixture's claim is both a promise and the ask's shortfall (an ask item, actor person): quoting it grounds nothing.
  for (const quote of [CLAIM_QUOTE, RESPONSE.slice(0, 60)]) {
    const seen = [];
    const result = await run(passJudge({ check: contradicting, seen, pass: onBehaviour(parseFinding({
      trace: [sessionStep(quote), parseFinding().trace[0]] })) }), { report, session, snapshot });
    assert.deepEqual(result.codePass.rejected, [{ reason: 'evidence_grounding_failed', lens: 'behaviour',
      cause: 'quote_ungrounded' }], quote);
    for (const request of challengesOf(seen)) assert.ok(!request.prompt.includes(quote));
  }
  // A recorded result it cites reaches the checker; the agent's response to that failure, and its claim, never do.
  const seen = [];
  const cited = await run(passJudge({ check: contradicting, seen, pass: onBehaviour(parseFinding({
    trace: [sessionStep(LONG_OUTPUT.slice(0, 60)), parseFinding().trace[0]] })) }), { report, session, snapshot });
  assert.equal(cited.codePass.findings.length, 1);
  const challenges = challengesOf(seen);
  assert.equal(challenges.length, 3);
  for (const request of challenges) {
    assert.match(request.prompt, /^# Recorded text the finding cites — untrusted evidence$/m);
    assert.ok(request.prompt.includes(LONG_OUTPUT.slice(0, 60)));
    for (const agent of [RESPONSE, CLAIM_QUOTE, 'npm test']) assert.ok(!request.prompt.includes(agent), agent);
  }
  // The dossier labels each quote by whose words it is: the ask's shortfall and the failure's command and response are
  // the agent's, shown as such; the failure's output is a recorded result.
  const lens = seen.find((r) => r.label === 'code-pass:behaviour').prompt;
  const items = dossierItems(lens);
  const ask = items.find((i) => i.kind === 'ask');
  assert.deepEqual([ask.actor, ask.missing, ask.delivered], ['person', { actor: 'agent', quote: CLAIM_QUOTE },
    { actor: 'agent', quote: 'export function parse(input) {' }]);
  const failure = items.find((i) => i.kind === 'failure');
  assert.deepEqual([failure.actor, failure.ran, failure.response], ['recorded', { actor: 'agent', quote: 'npm test' },
    { actor: 'agent', quote: RESPONSE }]);
  assert.equal(typeof failure.output, 'string');
  assert.match(CODE_PASS_SYSTEM, /never the agent's words/);
});

test('review of the code step (M3): what a checker is shown of a finding filters the session by actor, by structure', () => {
  const m = { entry: parseFinding(), anchor: parseFinding().anchor, trace: [
    { step: 'The agent said so.', source: 'session', eventId: 'C1', role: 'commentary', quote: 'parse now returns' },
    { step: 'The run failed.', source: 'session', eventId: 'X1-r', role: 'observation', quote: 'line 001' },
    { step: 'You asked.', source: 'session', eventId: 'I1', role: 'instruction', quote: 'returns [] for empty input' },
    { step: 'It splits.', source: 'file', path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2, quote: QUOTE }] };
  const sources = [{ eventId: 'C1', role: 'commentary', text: CLAIM_QUOTE, actor: 'agent' },
    { eventId: 'X1-r', role: 'observation', text: 'SYNTHETIC failing run line 001', actor: 'recorded' },
    { eventId: 'I1', role: 'instruction', text: CODE_TEXT.ask, actor: 'person' }];
  const { finding, cited } = challengeFindingOf(m, sources);
  assert.deepEqual(finding.trace[0], { step: 'The agent said so.', source: 'session' }, 'the agent\'s words: no quote');
  assert.equal(finding.trace[1].quote, 'line 001');
  assert.deepEqual(cited.map((s) => s.eventId), ['X1-r', 'I1']);
  assert.ok(!JSON.stringify({ finding, cited }).includes('parse now returns'));
  // The same text under an agent's label is never cited, whatever item carried it.
  assert.deepEqual(challengeFindingOf(m, sources.map((s) => ({ ...s, actor: 'agent' }))).cited, []);
  // Whose words: by the recorder's structure — a human instruction, a project instruction file, the result of a typed
  // command, read, write, edit or delete; a helper's report returned as a tool's output, a peer's message and an unknown
  // event are the agent's.
  const T1 = { turn: 'T1' };
  const blobs = { a: 'SYNTHETIC ask', b: 'SYNTHETIC brief', c: 'SYNTHETIC report', d: 'SYNTHETIC output', e: 'SYNTHETIC rules' };
  const call = (id, operation, tool) => ({ id, kind: 'invocation', operation, tool, paths: [], changes: [], input: [],
    command: [], callKey: id, ...T1 });
  const session = buildCodeSession('s-actors', blobs, [
    { id: 'H', kind: 'instruction', blob: 'a', ...T1 },
    { id: 'P', kind: 'instruction', authority: 'peer', blob: 'b', ...T1 },
    call('D', 'delegate', 'Task'),
    { id: 'D-r', kind: 'observation', invocation: 'D', blob: 'c', ...T1 },
    call('X', 'command', 'Bash'),
    { id: 'X-r', kind: 'observation', invocation: 'X', blob: 'd', ...T1 },
    { id: 'F', kind: 'project-instructions', path: 'CLAUDE.md', text: [{ sourceKey: 'e', fromByte: 0, untilByte: 15 }],
      ...T1 },
    // The third review of the code step: a project instruction file is the person's only when given to the main agent
    // and no typed write, edit or delete of the session changed its path (one proven failed changed nothing).
    { id: 'FW', kind: 'project-instructions', path: 'sub/CLAUDE.md', text: [{ sourceKey: 'e', fromByte: 0,
      untilByte: 15 }], ...T1 },
    { id: 'PW', kind: 'invocation', write: './sub/CLAUDE.md', blob: 'e', ...T1 },
    { id: 'PW-r', kind: 'observation', invocation: 'PW', blob: 'd', ...T1 },
    { id: 'FF', kind: 'project-instructions', path: 'docs/CLAUDE.md', text: [{ sourceKey: 'e', fromByte: 0,
      untilByte: 15 }], ...T1 },
    { id: 'PX', kind: 'invocation', write: 'docs/CLAUDE.md', blob: 'e', ...T1 },
    { id: 'PX-r', kind: 'observation', invocation: 'PX', result: 'failed', blob: 'd', ...T1 },
    { id: 'FH', kind: 'project-instructions', path: 'AGENTS.md', childId: 'helper-1', text: [{ sourceKey: 'e',
      fromByte: 0, untilByte: 15 }], ...T1 },
    { id: 'FN', kind: 'project-instructions', text: [{ sourceKey: 'e', fromByte: 0, untilByte: 15 }], ...T1 },
    { id: 'FE', kind: 'project-instructions', path: 'lib/CLAUDE.md', text: [{ sourceKey: 'e', fromByte: 0,
      untilByte: 15 }], ...T1 },
    { ...call('PE', 'edit', 'Edit'), changes: [{ path: 'lib/CLAUDE.md', before: [], after: [], diff: [] }] },
    { id: 'PE-r', kind: 'observation', invocation: 'PE', blob: 'd', ...T1 },
    { id: 'FD', kind: 'project-instructions', path: 'old/AGENTS.md', text: [{ sourceKey: 'e', fromByte: 0,
      untilByte: 15 }], ...T1 },
    { ...call('PD', 'delete', 'delete'), changes: [{ path: 'old/AGENTS.md', before: [], after: [], diff: [] }] },
    { id: 'PD-r', kind: 'observation', invocation: 'PD', blob: 'd', ...T1 },
    // The second review of the code step: what a call the slicer types as no command, read, write, edit or delete
    // returns may be another agent's words — a background task polled (TaskOutput), a Workflow, a message tool, a tool
    // the slicer does not type — and a result marked a helper's report is one whatever its call; all the agent's.
    call('T', 'other', 'TaskOutput'), { id: 'T-r', kind: 'observation', invocation: 'T', blob: 'c', ...T1 },
    call('WF', 'other', 'Workflow'), { id: 'WF-r', kind: 'observation', invocation: 'WF', blob: 'c', ...T1 },
    call('SM', 'other', 'SendMessage'), { id: 'SM-r', kind: 'observation', invocation: 'SM', blob: 'c', ...T1 },
    call('M', 'other', 'mcp__peer__ask'), { id: 'M-r', kind: 'observation', invocation: 'M', blob: 'c', ...T1 },
    { id: 'HR-r', kind: 'observation', invocation: 'X', helperReported: true, blob: 'c', ...T1 },
    { id: 'O-r', kind: 'observation', invocation: 'gone', blob: 'd', ...T1 },
    // Typed reads (either spelling), writes, edits and deletes: recorded results.
    call('R', 'other', 'read'), { id: 'R-r', kind: 'observation', invocation: 'R', blob: 'd', ...T1 },
    call('R2', 'read', 'Read'), { id: 'R2-r', kind: 'observation', invocation: 'R2', blob: 'd', ...T1 },
    call('W', 'write', 'Write'), { id: 'W-r', kind: 'observation', invocation: 'W', blob: 'd', ...T1 },
    call('E', 'edit', 'Edit'), { id: 'E-r', kind: 'observation', invocation: 'E', blob: 'd', ...T1 },
    call('RM', 'delete', 'delete'), { id: 'RM-r', kind: 'observation', invocation: 'RM', blob: 'd', ...T1 }]);
  assert.deepEqual(['H', 'P', 'D-r', 'X-r', 'F', 'X', 'nowhere'].map((id) => actorOf(session, id)),
    ['person', 'agent', 'agent', 'recorded', 'person', 'agent', 'agent']);
  // Written in the session (as `./sub/CLAUDE.md`: one file whatever its spelling), given to a helper, or with no path:
  // the agent's. A write proven failed left the person's file as it was.
  assert.deepEqual(['FW', 'FE', 'FD', 'FH', 'FN', 'FF'].map((id) => actorOf(session, id)),
    ['agent', 'agent', 'agent', 'agent', 'agent', 'person']);
  assert.deepEqual(['T-r', 'WF-r', 'SM-r', 'M-r', 'HR-r', 'O-r'].map((id) => actorOf(session, id)),
    ['agent', 'agent', 'agent', 'agent', 'agent', 'agent']);
  assert.deepEqual(['R-r', 'R2-r', 'W-r', 'E-r', 'RM-r'].map((id) => actorOf(session, id)),
    ['recorded', 'recorded', 'recorded', 'recorded', 'recorded']);
});

test('third review of the code step (medium): a code check\'s checker sees what its row states, and no other word of the agent\'s', async () => {
  const session = failingSession();
  const DECIDED = 'parse handles empty input and the tests pass.';
  const SHORT = 'SYNTHETIC_CODE_FINAL: done';
  const base = failingReport();
  const report = { ...base, requirements: [{ ...base.requirements[0], shortfall: R('C2', 'commentary', SHORT) }],
    decisions: [{ ...sessionReport().decisions[0], stated: R('C2', 'commentary', DECIDED) }, sessionReport().decisions[1]] };
  const rows = codeCheckRows(report, session);
  const ask = rows.find((r) => r.kind === 'ask'), failure = rows.find((r) => r.kind === 'failure');
  // An ask's checker: the person's ask and the row's facts; the shortfall in the agent's words is left out.
  assert.deepEqual(ask.shown.missing, { actor: 'agent', quote: SHORT });
  assert.deepEqual(challengeRowOf(ask), { kind: 'ask', status: 'partly-done', asked: CODE_TEXT.ask });
  // A failure's: the result that failed; the command the agent ran and its response to it are left out.
  assert.deepEqual(Object.keys(challengeRowOf(failure)), ['kind', 'outcome', 'output']);
  // The reviewer's probe: a claim's checker shown {"kind":"claim"} alone could not refute a false "shows". It sees the
  // claim, the thing it judges the answer against.
  const claim = rows.find((r) => r.kind === 'claim');
  assert.equal(claim.shown.said, CLAIM_QUOTE);
  assert.deepEqual(challengeRowOf(claim), { kind: 'claim', said: CLAIM_QUOTE });
  // A decision's: its question and choice (the session review's words) and facts, never the agent's statement of it.
  const decision = rows.find((r) => r.kind === 'decision' && r.shown.said !== undefined);
  assert.equal(decision.shown.said, DECIDED);
  assert.deepEqual(challengeRowOf(decision), { kind: 'decision', who: 'made without asking the person',
    question: 'How to split the input', chosen: 'Split on commas' });
  // Beyond what a row states, only the person's words or a recorded result: a claim's contradicting quote of the
  // agent's own is left out, a recorded one stays.
  assert.deepEqual(challengeRowOf({ kind: 'claim', shown: { kind: 'claim', said: CLAIM_QUOTE,
    contradictedBy: { actor: 'recorded', quote: 'line 001' } } }), { kind: 'claim', said: CLAIM_QUOTE,
    contradictedBy: { actor: 'recorded', quote: 'line 001' } });
  assert.deepEqual(challengeRowOf({ kind: 'claim', shown: { kind: 'claim', said: CLAIM_QUOTE,
    contradictedBy: 'SYNTHETIC agent commentary' } }), { kind: 'claim', said: CLAIM_QUOTE });
  // What a row states is shown whoever's words they are, with their actor: an ask from a project file the agent wrote,
  // a failing result of an untyped tool.
  assert.deepEqual(challengeRowOf({ kind: 'ask', shown: { kind: 'ask', status: 'not-done',
    asked: { actor: 'agent', quote: 'SYNTHETIC rule' }, missing: { actor: 'agent', quote: 'SYNTHETIC gap' } } }),
  { kind: 'ask', status: 'not-done', asked: { actor: 'agent', quote: 'SYNTHETIC rule' } });
  assert.deepEqual(challengeRowOf({ kind: 'failure', shown: { kind: 'failure', outcome: 'ran-failed',
    ran: { actor: 'agent', quote: 'npm test' }, output: { actor: 'agent', quote: 'SYNTHETIC out' } } }),
  { kind: 'failure', outcome: 'ran-failed', output: { actor: 'agent', quote: 'SYNTHETIC out' } });
  assert.deepEqual(challengeRowOf({ kind: 'nothing', shown: { said: CLAIM_QUOTE } }), {});
  // Through the pass, rows batched sixteen to a request: every checking request holds the claim it checks, on the
  // claim's own row, and no word of the agent's that is no row's statement.
  const shows = (checkRows_) => checkRows_.map((row) => ({ key: row.key, answer: 'shows', explanation: 'Synthetic.',
    receipts: [{ path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2, quote: QUOTE }] }));
  const seen = [];
  await run(passJudge({ check: shows, seen }), { report, session, snapshot: gitSnapshotOf({ session }) });
  const checking = seen.filter((r) => r.label.startsWith('challenge:code-check'));
  assert.equal(checking.length, 3);
  for (const request of checking) {
    const candidates = candidatesOf(request.prompt, request.challenge.items);
    assert.deepEqual([...new Set(candidates.map((c) => c.row.kind))].sort(), ['ask', 'claim', 'decision', 'failure']);
    assert.deepEqual(candidates.filter((c) => c.row.kind === 'claim').map((c) => c.row.said), [CLAIM_QUOTE]);
    assert.ok(request.prompt.includes(CLAIM_QUOTE), request.label);
    for (const agent of [DECIDED, SHORT, RESPONSE, '"npm test"']) assert.ok(!request.prompt.includes(agent), request.label);
  }
  // Step 1 itself was shown them all: it checks what the agent said.
  const step1 = seen.find((r) => r.label === 'code-check').prompt;
  for (const agent of [CLAIM_QUOTE, DECIDED, SHORT, RESPONSE]) assert.ok(step1.includes(agent), agent);
  // The note says what a row carries.
  assert.match(CODE_STEP_CHECK_NOTE, /What a row states is\s+what is checked, never evidence that it holds\./);
});

test('review of the code step (low): lens results merge by overlapping anchor whatever their kind; foundByLenses counts every lens', async () => {
  const both = (p, lens) => (lens === 'behaviour' ? [parseFinding()] : lens === 'tests'
    ? [parseFinding({ kind: 'weak_test', title: 'SYNTHETIC weak test', leadsFrom: ['S1'] })] : []);
  const result = await run(passJudge({ check: contradicting, pass: both }));
  assert.equal(result.codePass.findings.length, 1);
  assert.deepEqual([result.codePass.findings[0].kind, result.codePass.findings[0].foundByLenses],
    ['bug', ['behaviour', 'tests']]);
  assert.deepEqual(result.codePass.findings[0].leadsFrom.map((l) => l.key), ['S1']);
});

test('review of the code step (low, privacy): no request names a path outside the working directory or in a harness home', async () => {
  const OUTSIDE = '/private/var/SYNTHETIC/other-team/secret-project-name/plan.md';
  const HARNESS = '.claude/settings.json';
  const T1 = { turn: 'T1' };
  const blobs = { ...CODE_TEXT, plan: 'SYNTHETIC plan\n', cfg: '{"SYNTHETIC": true}\n' };
  const session = buildCodeSession('s-private', blobs, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
    { id: 'W2', kind: 'invocation', write: OUTSIDE, blob: 'plan', ...T1 },
    { id: 'R1', kind: 'invocation', read: HARNESS, blob: 'readUtil', ...T1 },
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 }]);
  const report = { ...sessionReport(), decisions: [{ id: `sha256:${'4'.repeat(64)}`, dimension: 'Where the plan goes',
    chosen: 'Elsewhere', actions: ['W2', 'R1', 'W1'], column: 'unasked', stated: null }] };
  const plan = codeSnapshotPlan(session);
  const states = { [OUTSIDE]: 'outside_root', [HARNESS]: 'harness_home' };
  const reads = plan.map((e) => (states[e.path] ? { path: e.path, state: states[e.path] }
    : e.path === 'src/parse.js' ? { path: e.path, bytes: enc(CODE_FILES['src/parse.js']), type: 'modified',
      base: { bytes: enc(BASE_PARSE) }, patch: PARSE_PATCH } : { path: e.path, state: 'deleted' }));
  // git listed the harness file under the working directory (a home that is a repository); 4 more paths outside it.
  plan.push({ path: HARNESS + '.bak', recordedPath: HARNESS + '.bak', changed: true, recorded: false, outside: false,
    last: null, edits: [] });
  reads.push({ path: HARNESS + '.bak', state: 'harness_home', type: 'modified', base: null, patch: null });
  for (const base of [{ ...GIT, outside: 4 }, RECORDED]) {
    const snapshot = freezeCodeSnapshot(plan, reads, { base });
    const seen = [];
    const result = await runCodePass({ report, session, snapshot, bound: BOUND, base, judge: passJudge({ check: contradicting,
      pass: onBehaviour(parseFinding()), seen }) });
    assert.ok(seen.length > 5, base.kind);
    for (const request of seen) {
      for (const name of ['secret-project-name', 'other-team', '/private/var', '.claude', 'settings.json'])
        assert.ok(!request.prompt.includes(name), `${base.kind} ${request.label}: ${name}`);
    }
    const lens = seen.find((r) => r.label === 'code-pass:behaviour').prompt;
    if (base.kind === 'git') {
      assert.match(lens, /^- and 1 more differing path outside the working directory or in a harness home: not named, no hunk shown$/m);
      assert.match(lens, /^- and 4 more paths differ from the start commit outside the working directory: not reviewed, not named$/m);
      assert.match(lens, /^- and 3 more files outside the working directory or in a harness home: not shown, not named$/m);
      assert.equal(result.codePass.base.outside, 4);
    } else {
      // With no git base, the diff is the recorded edits under the working directory, as git's lists are: the write
      // outside it is no part of the change under review — counted with the files, never named.
      assert.doesNotMatch(lens, /^- and \d+ more differing/m);
      assert.match(lens, /^- and 3 more files outside the working directory or in a harness home: not shown, not named$/m);
      assert.equal(result.codePass.files.find((f) => f.path === OUTSIDE).diff, undefined);
    }
    // A differing path under the working directory went unshown (the harness file git listed), and (the second review
    // of the code step) so did the recorded write outside it, counted in the footer: never "complete", whatever the base.
    assert.equal(result.codePass.coverage, 'partial', base.kind);
    assert.deepEqual(result.codePass.footer.withheld.map((w) => w.state).sort(), ['harness_home', 'harness_home',
      'outside_root']);
    assert.equal(result.codePass.findings.length, 1, base.kind);
  }
  assert.equal(namedFile({ path: 'src/a.js', state: 'outside_root' }), true, 'a name under the working directory');
  assert.equal(namedFile({ path: '../a.js', state: 'outside_root' }), false);
  assert.equal(namedFile({ path: '~/notes.md', state: 'outside_root' }), false);
  assert.equal(namedFile({ path: 'cfg/settings.json', state: 'harness_home' }), false, 'a harness home, by any name');
});

test('review of the code step (high): an added file counts as shown by its hunks only when they hold every line of it', async () => {
  const head = 'export const added = 1;\nexport const more = 2;\n';
  const frozen = gitSnapshotOf({ extra: [{ path: 'src/added.js', type: 'added', head,
    patch: '@@ -0,0 +1,2 @@\n+export const added = 1;\n+export const more = 2;\n' }] });
  const seen = [];
  const whole = await run(passJudge({ check: contradicting, seen }), { snapshot: frozen });
  assert.equal(whole.codePass.files.find((f) => f.path === 'src/added.js').state, 'shown');
  assert.ok(!shownFiles(seen.find((r) => r.label === 'code-pass:behaviour').prompt).some((f) => f.path === 'src/added.js'),
    'its hunks show it whole: no whole block');
  // The same file with a hunk that holds only its first line: what the hunks miss is shown whole, or it is not "shown".
  const partial = frozen.map((f) => (f.path === 'src/added.js' ? { ...f, hunks: [{ ...f.hunks[0], newCount: 1,
    rows: f.hunks[0].rows.slice(0, 1) }] } : f));
  const again = [];
  const result = await run(passJudge({ check: contradicting, seen: again }), { snapshot: partial });
  const lens = again.find((r) => r.label === 'code-pass:behaviour').prompt;
  const reported = result.codePass.files.find((f) => f.path === 'src/added.js').state;
  assert.ok(reported !== 'shown' || shownFiles(lens).some((f) => f.path === 'src/added.js'),
    'never reported shown when no request showed its second line');
  assert.ok(lens.includes('export const more = 2;'));
});

test('third review of the code step (low, test gap): a recorded edit withheld under the working directory keeps coverage partial', async () => {
  // A recorded write git does not list (an ignored `.env`, a file of a harness home in the working directory): with a
  // git base it has no diff state, so only the rule that a recorded edit no request shows a line of keeps coverage from
  // being complete — wherever it is, not only outside the working directory.
  const T1 = { turn: 'T1' };
  for (const [path, state] of [['.env', 'credential_path'], ['.claude/settings.json', 'harness_home']]) {
    const session = buildCodeSession('s-withheld', { ...CODE_TEXT, secret: 'API_KEY=SYNTHETIC\n' }, [
      { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
      { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
      { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
      { id: 'W2', kind: 'invocation', write: path, blob: 'secret', ...T1 },
      { id: 'W2-r', kind: 'observation', invocation: 'W2', blob: 'wrote', ...T1 },
      { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 }]);
    const plan = codeSnapshotPlan(session);
    const reads = plan.map((e) => (e.path === path ? { path: e.path, state }
      : { path: e.path, bytes: enc(CODE_FILES['src/parse.js']), type: 'modified', base: { bytes: enc(BASE_PARSE) },
        patch: PARSE_PATCH }));
    const snapshot = freezeCodeSnapshot(plan, reads, { base: GIT });
    assert.equal(snapshot.find((f) => f.path === path).diff, undefined, 'git lists no change of it');
    const result = await runCodePass({ report: sessionReport(), session, snapshot, bound: BOUND, base: GIT,
      judge: passJudge({ check: contradicting }) });
    assert.equal(result.codePass.coverage, 'partial', path);
    // Without that edit the same review is complete.
    const alone = await runCodePass({ report: sessionReport(), session, base: GIT, bound: BOUND,
      snapshot: freezeCodeSnapshot(plan.filter((e) => e.path !== path), reads.filter((r) => r.path !== path),
        { base: GIT }), judge: passJudge({ check: contradicting }) });
    assert.equal(alone.codePass.coverage, 'complete', path);
  }
});

test('second review of the code step (low): a recorded edit outside the working directory, never shown, keeps coverage partial', async () => {
  // The second review of the code step: a recorded edit no request shows a line of — outside the working directory (a
  // sibling folder of the repository, an agent's scratch file) — is a part of the change that went unshown. It is
  // withheld and counted, never named, and coverage is never complete beside it.
  const SCRATCH = '/private/tmp/SYNTHETIC-scratchpad/probe.py';
  const T1 = { turn: 'T1' };
  const session = buildCodeSession('s-scratch', { ...CODE_TEXT, probe: 'print(1)\n' }, [
    { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
    { id: 'W9', kind: 'invocation', write: SCRATCH, blob: 'probe', ...T1 },
    { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 }]);
  const plan = codeSnapshotPlan(session);
  const reads = plan.map((e) => (e.path === SCRATCH ? { path: e.path, state: 'outside_root' }
    : { path: e.path, bytes: enc(CODE_FILES['src/parse.js']), type: 'modified', base: { bytes: enc(BASE_PARSE) },
      patch: PARSE_PATCH }));
  for (const base of [GIT, RECORDED]) {
    const snapshot = freezeCodeSnapshot(plan, reads, { base });
    const result = await runCodePass({ report: sessionReport(), session, snapshot, bound: BOUND, base,
      judge: passJudge({ check: contradicting }) });
    assert.equal(result.codePass.coverage, 'partial', base.kind);
    assert.deepEqual(result.codePass.footer.withheld, [{ path: SCRATCH, state: 'outside_root' }], base.kind);
    // The same review without that edit is complete: the recorded edit outside alone keeps it partial.
    const inside = plan.filter((e) => e.path !== SCRATCH);
    const alone = await runCodePass({ report: sessionReport(), session, base, bound: BOUND,
      snapshot: freezeCodeSnapshot(inside, reads.filter((r) => r.path !== SCRATCH), { base }),
      judge: passJudge({ check: contradicting }) });
    assert.equal(alone.codePass.coverage, 'complete', base.kind);
    // A file the session only read outside the working directory is no change: it leaves coverage alone.
    const readOnly = await runCodePass({ report: sessionReport(), session, base, bound: BOUND,
      snapshot: freezeCodeSnapshot([...inside, { path: SCRATCH, recordedPath: SCRATCH, changed: false, recorded: false,
        outside: false, last: null, edits: [] }], [...reads.filter((r) => r.path !== SCRATCH),
        { path: SCRATCH, state: 'outside_root' }], { base }),
      judge: passJudge({ check: contradicting }) });
    assert.equal(readOnly.codePass.coverage, 'complete', base.kind);
  }
});
