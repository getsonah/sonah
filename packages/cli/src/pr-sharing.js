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
    terminal.question(`After reading the page, type '${expected}' to confirm you may post this comment on that pull `
      + 'request and accept its limits: ',
      (answer) => finish(answer === expected));
  });
}

const FIXES = Object.freeze({
  publication_disabled: 'Remove --post-comment for a local review. To post the comment, use a GitHub App token that '
    + 'can write reviews and checks, set SONAH_GITHUB_ACTOR_ID and SONAH_GITHUB_APP_ID, and name a pull request of a '
    + 'private repository.',
  stale_revision: 'The PR changed before the comment was posted. Run the same review again with a new --output '
    + 'filename (stored answers are reused) to share against its current head.',
  operation_uncertain: 'Keep the publication journal and inspect the PR. Rerun with the same review arguments and state directory, choosing a new --output filename to reconcile; do not delete the journal or start a fresh publication.',
  operation_busy: 'Wait for the other publisher. After a crash, confirm it stopped and inspect the publication journal before removing its lock.',
  operation_conflict: 'Preserve the publication journal and inspect the conflicting operation before sharing again.',
  operation_store_failed: 'Check that the review state directory is owned by you and writable; keep its existing publication journal.',
});
const sharingFailure = (code, stderr) => {
  stderr.write(`Sharing could not complete: ${code}. The local page and review history are retained.\n`);
  stderr.write(`Fix: ${FIXES[code] ?? 'Check GitHub App access and the PR.'}\n`);
  stderr.write('For another attempt, keep the existing review state and choose a new --output filename.\n');
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
  stdout = process.stdout, stderr = process.stderr, confirm = confirmPrSharing, mask = undefined }) {
  try {
    const principals = validatePrSharing({ env });
    const pr = await readPrTarget({ client, github });
    const plan = createPublicationPlan({ report, pr, mask });
    stdout.write(`PR comment preview for ${plan.target.owner}/${plan.target.repo}#${plan.target.number}, head ${plan.headOid}:\n${plan.review.body}\n`);
    stdout.write('Sharing posts this counts-only COMMENT and a neutral advisory check. '
      + 'Quotes, rows and the local page stay on this machine.\n');
    const confirmed = await confirm({ target: plan.target, body: plan.review.body, check: plan.check });
    if (confirmed !== true) {
      stdout.write('PR comment not posted.\n');
      if (confirmed === null) {
        stderr.write('Fix: confirmation needs an interactive terminal. Read the saved page, then rerun there with the same review state and a new --output filename, or remove --post-comment.\n');
        return { state: 'cancelled', exitCode: 2 };
      }
      return { state: 'cancelled' };
    }
    const operation = await publishReview({ client, plan,
      store: createFileOperationStore({ directory: join(stateDir, 'publication') }),
      policy: { mode: 'private-preview', ownerAuthorized: true, limitsAcknowledged: true,
        repositoryId: plan.target.repositoryId, ...principals } });
    if (operation.state === 'complete') {
      stdout.write('PR comment and neutral advisory check posted.\n');
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
