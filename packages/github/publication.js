import { createHash } from 'node:crypto';
import { canonicalJson } from '../evidence/contracts/index.js';
import { PUBLIC_STATUSES, honestStatuses, reviewRunState } from '../evidence/src/ledger.js';
import { coverageCauses, COVERAGE_SENTENCE, attentionSummary } from '../evidence/src/review.js';
import { CODE_REPORT_WORDS, reportNotReviewedOf } from '../evidence/src/code-report.js';
import { fail } from './errors.js';
import { request, targetPath, listPages } from './client.js';
import { isOid, freeze, checkMetadata } from './reader.js';

export const PUBLICATION_POLICY = Object.freeze({ mode: 'disabled', automaticQualityGate: 'unmet' });
const plans = new WeakSet();
const hash = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');
// C-01 PublicStatus, M33: a report status is one of PUBLIC_STATUSES. D71 (a): they are checked here as the report's
// shape only; none is published.
const STATUS = new Set(PUBLIC_STATUSES);
/** D82 step 10: the plan's shape. /2: built from a session review's report against a metadata-only PR read — a
 *  counts-only comment with no inline comments, no disclosure policy and no diff base (/1 planned a combined code
 *  review's comment against its diff, with an optional finding disclosure). */
export const PUBLICATION_PLAN_SCHEMA = 'sonah.publication-plan/2';

/** A positive safe integer: the only thing a cause's count may be beside a coverage statement. */
const positiveCount = (n) => Number.isSafeInteger(n) && n > 0;

/**
 * D71 (a), owner decision 2026-10-08: no verdict anywhere the human sees — on a PR too, Sonah never says the work is
 * fine. The public summary says only whether Sonah's own review ran (ledger.js REVIEW_RUN_STATES), and, when the
 * coverage is short of complete, every declared cause with its count, then the checklist's attention lines, in the
 * renderer's code-owned sentences (counts and fixed words only, each escaped for the public surface). A
 * cause whose count is not a positive safe integer cannot be published: the review would stand without the counted
 * limits that qualify it.
 */
export const PUBLIC_RUN_WORDS = Object.freeze({
  complete: 'Sonah finished its review. It lists what you should check. It never says that the work is correct.',
  incomplete: 'Sonah did not finish its review. Read what Sonah could not check before you use this review.',
});
/** D71 (a): the GitHub check's title, by run state. The conclusion is always `neutral`: informational, never success
 *  or failure. D122 (a review low of D118: a status word never says complete without naming what is missing): a run
 *  that finished and reviewed no code (`reportNotReviewedOf`) says so (`completeNoCode`). */
export const CHECK_TITLES = Object.freeze({ complete: 'Sonah finished its advisory review',
  completeNoCode: 'Sonah finished its advisory review, but no code was reviewed',
  incomplete: 'Sonah did not finish its advisory review' });
/** The comment's other fixed words: its title, the causes line, the attention heading and the advisory sentences. */
export const PUBLICATION_WORDS = Object.freeze({
  title: 'Sonah advisory review',
  notCovered: (sentences) => `Not covered: ${sentences.join(' · ')}.`,
  noCause: 'Not covered: the report declares partial session coverage but names no cause.',
  attention: 'What needs your attention:',
  advisory: 'This is an advisory COMMENT review. It does not approve the change or allow a merge. Read it before you '
    + 'share it.',
});
const NO_CAUSE_SENTENCE = PUBLICATION_WORDS.noCause;

function coverageStatement(report) {
  if (report.coverage === 'complete' && report.codeCoverage !== 'partial') return '';
  let causes;
  try { causes = coverageCauses(report); } catch { fail('invalid_input'); }
  if (!Array.isArray(causes)) fail('invalid_input');
  if (!causes.length) return report.coverage === 'partial' ? `${NO_CAUSE_SENTENCE}\n\n` : '';
  const sentences = causes.map(([cause, counts]) => {
    if (!Object.hasOwn(COVERAGE_SENTENCE, cause) || !positiveCount(counts?.n)
        || (counts.m !== undefined && !(positiveCount(counts.m) && counts.m >= counts.n))) fail('invalid_input');
    return escapePublicText(COVERAGE_SENTENCE[cause](counts));
  });
  return `${PUBLICATION_WORDS.notCovered(sentences)}\n\n`;
}

/** D71 (a), (d); S6 (S5 review M2): the checklist's attention lines (review.js `attentionSummary`: counts and fixed words,
 *  in the checklist's order), each escaped for the public surface, or nothing when none is counted. D88 (owner decision
 *  2026-10-14): only the agent's judgment and the settled problems are counted; then the one plain line that says how
 *  many rows Sonah could not check are folded, and where, when there are any. */
function attentionStatement(report) {
  let summary;
  try { summary = attentionSummary(report); } catch { fail('invalid_input'); }
  const { lines, folded } = summary ?? {};
  if (!Array.isArray(lines)) fail('invalid_input');
  const parts = [];
  if (lines.length) parts.push(`${PUBLICATION_WORDS.attention}\n${lines.map((line) =>
    `- ${escapePublicText(line.split('**').join(''))}`).join('\n')}`);
  if (typeof folded === 'string') parts.push(escapePublicText(folded));
  return parts.length ? `${parts.join('\n\n')}\n\n` : '';
}

/** D118 (a), the owner's go of 2026-10-18 (the dogfood's DF2): when no code was reviewed (evidence code-report.js
 *  `codeNotReviewedOf`), the first screen's sentence and its one closed reason, right after whether Sonah's review ran:
 *  fixed words only, escaped as every other sentence is. The comment names no path, so no folder (it is public). A
 *  combined pull request review (an earlier route, `reviewScope` not session-only, no code pass record) is not one. */
function noCodeStatement(report) {
  // D122: one definition with the report model and the terminal (`reportNotReviewedOf`).
  const reason = reportNotReviewedOf(report);
  return reason === null ? ''
    : `${escapePublicText(CODE_REPORT_WORDS.notReviewed(CODE_REPORT_WORDS.notReviewedReasons[reason]))}\n\n`;
}

/**
 * The one place the comment's text is escaped before it is shown, hashed or posted (D82 step 10): every sentence of the
 * comment that is not a fixed literal of this file passes through this call — its control characters dropped, and
 * every character Markdown or HTML would read as markup or a mention escaped. D90 (owner decision 2026-10-15): nothing
 * is masked. A value that is not text is `disclosure_rejected`, and nothing is posted.
 */
export function escapePublicText(value) {
  if (typeof value !== 'string') fail('disclosure_rejected');
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/@/g, '&#64;')
    .replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&');
}

/**
 * D82 step 10: the comment's text, from a session review's report (the checklist) alone: whether Sonah's review ran,
 * what it could not cover, where your attention is needed, and the fixed advisory sentences. Counts and fixed words
 * only — no quote, path, row text or status. The statuses are recomputed from the report's own facts first and are
 * checked as its shape only (audit A3; C-06 M33). Needs no PR: a dry run shows it as it is.
 */
export function publicCommentText(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)
      || !STATUS.has(report.codeStatus) || !STATUS.has(report.sessionStatus) || !STATUS.has(report.reviewStatus)
      || !Array.isArray(report.findings)) fail('invalid_input');
  let recomputed;
  try { recomputed = honestStatuses(report); } catch { fail('invalid_input'); }
  if (!STATUS.has(recomputed.codeStatus) || !STATUS.has(recomputed.sessionStatus)
      || !STATUS.has(recomputed.reviewStatus)) fail('invalid_input');
  report = { ...report, ...recomputed };
  const run = reviewRunState(report) === 'complete' ? 'complete' : 'incomplete';
  const summary = `${PUBLICATION_WORDS.title}\n\n${PUBLIC_RUN_WORDS[run]}\n\n`
    + noCodeStatement(report)
    + coverageStatement(report)
    + attentionStatement(report)
    + PUBLICATION_WORDS.advisory;
  return { run, summary };
}

/** A plan to post one counts-only COMMENT review and one neutral check on `pr` (a metadata-only read), from the
 *  session review's `report`. Built without a model or the network; the only plans `publishReview` accepts. */
export function createPublicationPlan({ report, pr }) {
  if (!pr || !isOid(pr.baseOid) || !isOid(pr.headOid) || pr.baseOid.length !== pr.headOid.length
      || pr.repo?.host !== 'github.com' || !/^\d+$/.test(pr.repo.id ?? '')
      || typeof pr.github?.owner !== 'string' || typeof pr.github?.name !== 'string') fail('invalid_input');
  const { run, summary } = publicCommentText(report);
  // D122: whether no code was reviewed, by the one definition (`reportNotReviewedOf`), for the check's title.
  const noCode = reportNotReviewedOf(report) !== null;
  const target = { owner: pr.github.owner.toLowerCase(), repo: pr.github.name.toLowerCase(), number: pr.number,
    repositoryId: pr.repo.id, private: pr.github.private === true };
  targetPath(target);
  const identity = { target, baseOid: pr.baseOid, headOid: pr.headOid, publicBody: summary };
  const id = hash(identity); const marker = `<!-- sonah-review:${id} -->`;
  const body = `${summary}\n\n${marker}`;
  // D71 (a): the check is informational — `neutral`, never `success` or `failure` — and its title says only whether
  // Sonah's own review ran.
  const check = { name: 'Sonah advisory review', head_sha: pr.headOid, status: 'completed', conclusion: 'neutral',
    external_id: id, output: { title: run === 'complete' && noCode ? CHECK_TITLES.completeNoCode : CHECK_TITLES[run],
      summary: `${summary}\n\n${marker}` } };
  if (Buffer.byteLength(body) > 60000) fail('disclosure_rejected');
  // No inline comments: a session review anchors nothing to a line of the PR (C-10).
  const review = { commit_id: pr.headOid, body, comments: [] };
  const plan = freeze({ schema: PUBLICATION_PLAN_SCHEMA, id, marker, target, baseOid: pr.baseOid, headOid: pr.headOid,
    contentHash: `sha256:${hash({ review, check })}`, review, check });
  plans.add(plan);
  return plan;
}

function authorize(plan, policy) {
  if (!plans.has(plan)) fail('operation_conflict');
  if (policy?.mode === 'automatic') fail('quality_gate_unmet');
  if (policy?.mode !== 'private-preview') fail('publication_disabled');
  if (policy.ownerAuthorized !== true || policy.limitsAcknowledged !== true || !plan.target.private
      || policy.repositoryId !== plan.target.repositoryId || !/^\d+$/.test(String(policy.actorId ?? ''))
      || !/^\d+$/.test(String(policy.appId ?? ''))) fail('publication_disabled');
}

async function current(client, plan) {
  const metadata = (await request(client, 'GET', targetPath(plan.target))).data;
  const actual = checkMetadata(metadata, plan.target);
  if (actual.baseOid !== plan.baseOid || actual.headOid !== plan.headOid
      || actual.repositoryId !== plan.target.repositoryId || actual.private !== true) fail('stale_revision');
}

function reviewMatches(review, plan, policy) {
  return review?.commit_id === plan.headOid && review.body === plan.review.body
    && String(review.user?.id) === String(policy.actorId) && Number.isSafeInteger(review.id)
    && ['PENDING', 'COMMENTED'].includes(review.state);
}

async function reconcileReview(client, plan, policy) {
  const result = await listPages(client, `${targetPath(plan.target)}/reviews`);
  if (!result.complete) fail('operation_uncertain');
  const matches = result.items.filter((review) => reviewMatches(review, plan, policy));
  if (matches.length > 1) fail('operation_conflict');
  const review = matches[0];
  if (!review) return null;
  const comments = await listPages(client, `${targetPath(plan.target)}/reviews/${review.id}/comments`);
  if (!comments.complete || comments.items.length !== plan.review.comments.length) fail('operation_uncertain');
  const project = (comment) => ({ path: comment.path, side: comment.side, line: comment.original_line ?? comment.line,
    body: comment.body, ...(comment.start_line == null && comment.original_start_line == null ? {}
      : { start_line: comment.original_start_line ?? comment.start_line, start_side: comment.start_side }) });
  const actual = comments.items.map((comment) => canonicalJson(project(comment))).sort();
  const expected = plan.review.comments.map((comment) => canonicalJson(comment)).sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) fail('operation_uncertain');
  return review;
}

async function reconcileCheck(client, plan, policy) {
  const path = `/repos/${plan.target.owner}/${plan.target.repo}/commits/${plan.headOid}/check-runs?filter=all`;
  const result = await listPages(client, path, { key: 'check_runs' });
  if (!result.complete) fail('operation_uncertain');
  const matches = result.items.filter((check) => check?.head_sha === plan.headOid && check.external_id === plan.id
    && check.name === plan.check.name && String(check.app?.id) === String(policy.appId)
    && check.output?.summary === plan.check.output.summary && check.status === 'completed' && check.conclusion === 'neutral'
    && Number.isSafeInteger(check.id));
  if (matches.length > 1) fail('operation_conflict');
  return matches[0] ?? null;
}

// Pending-create -> COMMENT-submit is the useful upstream library pattern. Unlike upstream,
// uncertainty never deletes a draft or retries creation: a late response must not double-post.
export async function publishReview({ client, plan, store, policy = PUBLICATION_POLICY,
  now = () => new Date().toISOString() }) {
  authorize(plan, policy);
  if (!store || ['get', 'put', 'withLock'].some((name) => typeof store[name] !== 'function')) fail('invalid_input');
  const targetKey = hash({ repositoryId: plan.target.repositoryId, number: plan.target.number });
  return store.withLock(targetKey, async () => {
    let operation = await store.get(plan.id);
  if (operation && (operation.contentHash !== plan.contentHash || operation.marker !== plan.marker)) fail('operation_conflict');
    if (operation && (!operation.requests?.review || !operation.requests?.check
        || canonicalJson(operation.requests.review) !== canonicalJson(plan.review)
        || canonicalJson({ ...operation.requests?.check, completed_at: null }) !== canonicalJson({ ...plan.check, completed_at: null })
        || !Number.isFinite(Date.parse(operation.requests?.check?.completed_at)))) fail('operation_conflict');
    if (!operation) {
      const completedAt = now();
      if (typeof completedAt !== 'string' || !Number.isFinite(Date.parse(completedAt))) fail('invalid_input');
      operation = { schema: 'sonah.publication-operation/1', id: plan.id, marker: plan.marker,
        contentHash: plan.contentHash, state: 'prepared', review: { phase: 'ready', id: null },
        check: { phase: 'ready', id: null },
        requests: { review: plan.review, check: { ...plan.check, completed_at: completedAt } } };
      await store.put(plan.id, operation);
    }
    const persist = async () => store.put(plan.id, operation);
    const uncertain = async () => { operation.state = 'uncertain'; await persist(); return structuredClone(operation); };
    if (operation.state === 'complete') return structuredClone(operation);
    try { await current(client, plan); }
    catch (error) { operation.state = error.code === 'stale_revision' ? 'stale' : 'uncertain'; await persist(); return structuredClone(operation); }

    if (operation.review.phase !== 'ready') {
      let found;
      try { found = await reconcileReview(client, plan, policy); } catch { return uncertain(); }
      if (!found) return uncertain(); // Absence after an uncertain POST is not proof of non-creation.
      operation.review = { id: found.id, phase: found.state === 'COMMENTED' ? 'submitted' : 'pending' };
      await persist();
    } else {
      operation.review.phase = 'create-inflight';
      operation.requests.reviewHash = `sha256:${hash(operation.requests.review)}`;
      await persist(); // The journal is durable BEFORE the remote mutation.
      try {
        await current(client, plan);
        const created = (await request(client, 'POST', `${targetPath(plan.target)}/reviews`, operation.requests.review)).data;
        if (!reviewMatches(created, plan, policy) || created.state !== 'PENDING') return uncertain();
        operation.review = { phase: 'pending', id: created.id }; await persist();
      } catch { return uncertain(); }
    }

    if (operation.review.phase === 'pending') {
      operation.review.phase = 'submit-inflight';
      operation.requests.submit = { event: 'COMMENT', body: plan.review.body };
      operation.requests.submitHash = `sha256:${hash(operation.requests.submit)}`;
      await persist();
      try {
        await current(client, plan);
        const submitted = (await request(client, 'POST', `${targetPath(plan.target)}/reviews/${operation.review.id}/events`, operation.requests.submit)).data;
        if (!reviewMatches(submitted, plan, policy) || submitted.id !== operation.review.id || submitted.state !== 'COMMENTED') return uncertain();
        operation.review.phase = 'submitted'; await persist();
      } catch { return uncertain(); }
    }

    if (operation.check.phase !== 'ready') {
      let found;
      try { found = await reconcileCheck(client, plan, policy); } catch { return uncertain(); }
      if (!found) return uncertain();
      operation.check = { phase: 'created', id: found.id };
    } else {
      operation.check.phase = 'create-inflight';
      operation.requests.checkHash = `sha256:${hash(operation.requests.check)}`;
      await persist();
      try {
        await current(client, plan);
        const created = (await request(client, 'POST', `/repos/${plan.target.owner}/${plan.target.repo}/check-runs`, operation.requests.check)).data;
        if (!Number.isSafeInteger(created?.id) || created.head_sha !== plan.headOid || created.external_id !== plan.id
            || created.name !== plan.check.name || created.status !== 'completed' || created.conclusion !== 'neutral'
            || created.output?.summary !== plan.check.output.summary || String(created.app?.id) !== String(policy.appId)) return uncertain();
        operation.check = { phase: 'created', id: created.id };
      } catch { return uncertain(); }
    }
    operation.state = 'complete'; await persist(); return structuredClone(operation);
  });
}

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ PUBLIC_RUN_WORDS: 'notice', CHECK_TITLES: 'heading',
  PUBLICATION_WORDS: 'notice', 'PUBLICATION_WORDS.title': 'heading', 'PUBLICATION_WORDS.attention': 'heading' });
export const STYLE_FIXTURES = Object.freeze({
  'PUBLICATION_WORDS.notCovered': [[['1 of 2 review windows did not finish']],
    [['1 of 2 review windows did not finish', 'the recorder shortened 2 messages of yours']]] });
/** D122: the owner's words of D118 ("No code was reviewed."), passive on purpose: no review of any actor read code. */
export const STYLE_ALLOW = Object.freeze({ 'CHECK_TITLES.completeNoCode': ['actor-unknown'] });
