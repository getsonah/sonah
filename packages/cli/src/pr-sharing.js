// B3 wires the existing manual private-preview publisher; D82 step 10 moved it onto the session review (`sonah review
// ... --github OWNER/REPO --pr N --post-comment`). The comment is counts and fixed words only, built from the session
// review's report (github/publication.js `publicCommentText`), and the saved local page precedes a separate,
// interactive confirmation.
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { createPublicationPlan, createFileOperationStore, publishReview, readPullRequestMetadata, GitHubError,
  GITHUB_ERROR_CODES } from '../../github/index.js';

const principalId = (value) => typeof value === 'string' && /^[1-9]\d*$/.test(value)
  && Number.isSafeInteger(Number(value));

export function validatePrSharing({ env = process.env } = {}) {
  const actorId = env.SONAH_GITHUB_ACTOR_ID, appId = env.SONAH_GITHUB_APP_ID;
  // These are the user's trusted integration configuration, never reviewer/model output.
  if (!principalId(actorId) || !principalId(appId)) throw new GitHubError('publication_disabled');
  return { actorId, appId };
}

export function confirmPrSharing({ target, input = process.stdin, output = process.stderr }) {
  if (input.isTTY !== true || output.isTTY !== true) return Promise.resolve(null);
  const expected = `share ${target.owner}/${target.repo}#${target.number}`;
  return new Promise((resolve) => {
    const terminal = createInterface({ input, output });
    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true; terminal.close(); resolve(answer);
    };
    terminal.once('close', () => finish(false));
    terminal.once('SIGINT', () => finish(false));
    terminal.question(`${PR_SHARING_WORDS.readFirst}\n${PR_SHARING_WORDS.confirm(expected)}`,
      (answer) => finish(answer === expected));
  });
}

/** The advice printed after "Fix:" when sharing fails, by its closed code. */
export const PR_SHARING_FIXES = Object.freeze({
  publication_disabled: 'Remove --post-comment for a local review. To post the comment, use a GitHub App token that '
    + 'can write reviews and checks. Set SONAH_GITHUB_ACTOR_ID and SONAH_GITHUB_APP_ID, and name a pull request of a '
    + 'private repository.',
  stale_revision: 'The pull request changed before Sonah posted the comment. To share against its current head, run '
    + 'the same review again with a new --output file name. Sonah reuses its stored answers.',
  operation_uncertain: 'Keep the publication journal and inspect the pull request. To reconcile, run the same review '
    + 'again with the same arguments and state directory, and a new --output file name. Do not delete the journal or '
    + 'start a new publication.',
  operation_busy: 'Wait for the other publisher. After a crash, check that it stopped, and inspect the publication '
    + 'journal before you remove its lock.',
  operation_conflict: 'Keep the publication journal, and inspect the other operation before you share again.',
  operation_store_failed: 'Check that you own the state directory of this review and can write to it. Keep the '
    + 'publication journal that is there.',
});
/** The lines the sharing step prints, and the question it asks before it posts. The answer is the consent that the
 *  publication policy records (`ownerAuthorized`, `limitsAcknowledged`): the person confirms that they have the right
 *  to post this comment on that pull request, and accepts its limits. These words change form only, never that
 *  meaning. */
export const PR_SHARING_WORDS = Object.freeze({
  readFirst: 'Read the saved page before you answer.',
  confirm: (expected) => `Type '${expected}' to confirm your right to post this comment on that pull request and `
    + 'accept its limits: ',
  failed: (code) => `Sharing could not finish: ${code}. Sonah keeps the local page and the history of this review.`,
  fix: (words) => `Fix: ${words}`,
  otherFix: 'Check the access of the GitHub App and the pull request.',
  again: 'For another attempt, keep the state of this review and choose a new --output file name.',
  preview: (target, head, body) => `PR comment preview for ${target}, head ${head}:\n${body}`,
  posts: 'Sharing posts this COMMENT, which holds counts only, and a neutral advisory check. Quotes, items and the '
    + 'local page stay on this computer.',
  notPosted: 'Sonah did not post the PR comment.',
  needsTerminal: 'Fix: the confirmation needs an interactive terminal. Read the saved page. Then run Sonah there again '
    + 'with the same state directory and a new --output file name, or remove --post-comment.',
  posted: 'Sonah posted the PR comment and the neutral advisory check.',
});
const sharingFailure = (code, stderr) => {
  const W = PR_SHARING_WORDS;
  stderr.write(`${W.failed(code)}\n`);
  stderr.write(`${W.fix(Object.hasOwn(PR_SHARING_FIXES, code) ? PR_SHARING_FIXES[code] : W.otherFix)}\n`);
  stderr.write(`${W.again}\n`);
};

/** The pull request a comment is for (`github`: `{ owner, repo, number }` as the person typed it), read by its
 *  metadata alone and checked: it exists, the token can read it, and its repository is private. The session review
 *  reads it before its first model call, so a comment that could never be posted stops the review there; and again
 *  after the page (`sharePrReview`), so the comment is planned against the head current then. */
export async function readPrTarget({ client, github }) {
  const pr = await readPullRequestMetadata({ client, ...github });
  if (pr.github.private !== true) throw new GitHubError('publication_disabled');
  return pr;
}

export async function sharePrReview({ client, github, report, stateDir, env = process.env,
  stdout = process.stdout, stderr = process.stderr, confirm = confirmPrSharing }) {
  try {
    const principals = validatePrSharing({ env });
    const pr = await readPrTarget({ client, github });
    const plan = createPublicationPlan({ report, pr });
    const W = PR_SHARING_WORDS;
    stdout.write(`${W.preview(`${plan.target.owner}/${plan.target.repo}#${plan.target.number}`, plan.headOid,
      plan.review.body)}\n`);
    stdout.write(`${W.posts}\n`);
    const confirmed = await confirm({ target: plan.target, body: plan.review.body, check: plan.check });
    if (confirmed !== true) {
      stdout.write(`${W.notPosted}\n`);
      if (confirmed === null) {
        stderr.write(`${W.needsTerminal}\n`);
        return { state: 'cancelled', exitCode: 2 };
      }
      return { state: 'cancelled' };
    }
    const operation = await publishReview({ client, plan,
      store: createFileOperationStore({ directory: join(stateDir, 'publication') }),
      policy: { mode: 'private-preview', ownerAuthorized: true, limitsAcknowledged: true,
        repositoryId: plan.target.repositoryId, ...principals } });
    if (operation.state === 'complete') {
      stdout.write(`${PR_SHARING_WORDS.posted}\n`);
      return { state: 'complete' };
    }
    const code = operation.state === 'stale' ? 'stale_revision' : 'operation_uncertain';
    sharingFailure(code, stderr);
    return { state: operation.state === 'stale' ? 'stale' : 'uncertain', exitCode: 3 };
  } catch (error) {
    const code = GITHUB_ERROR_CODES.includes(error?.code) ? error.code : 'github_unavailable';
    sharingFailure(code, stderr);
    return { state: 'failed', exitCode: 3 };
  }
}

/** The kind of each of this file's word tables, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ PR_SHARING_FIXES: 'notice', PR_SHARING_WORDS: 'notice',
  'PR_SHARING_WORDS.readFirst': 'action', 'PR_SHARING_WORDS.confirm': 'action', 'PR_SHARING_WORDS.preview': 'label' });
/** The arguments each function of a word table is rendered with for the style linter. */
export const STYLE_FIXTURES = Object.freeze({
  'PR_SHARING_WORDS.confirm': [['share owner/repo#7']], 'PR_SHARING_WORDS.failed': [['stale_revision']],
  'PR_SHARING_WORDS.fix': [[PR_SHARING_FIXES.stale_revision]],
  'PR_SHARING_WORDS.preview': [['owner/repo#7', 'a'.repeat(40), 'Sonah advisory review']],
});
