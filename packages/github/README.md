# GitHub boundary

Dependency-free metadata reader and advisory publisher for the session review's count-only PR comment. Its tests use
a fake GitHub transport. Nothing is posted automatically: a comment is posted only when a person asks for it and
confirms it.

```js
import {
  createGitHubClient, readPullRequestMetadata, createPublicationPlan,
  createFileOperationStore, publishReview,
} from './packages/github/index.js';

// Token is supplied explicitly. Nothing reads credentials from the environment or disk.
const client = createGitHubClient({ token, fetchImpl });
const pr = await readPullRequestMetadata({ client, owner, repo, number });
const plan = createPublicationPlan({ report, pr }); // safe, no network writes
```

An injected client implements `request({method,path,headers?,body?})` and returns
`{status,headers?,data}`. Paths are relative to GitHub's API. The supplied HTTP implementation
refuses redirects, supports GitHub.com only, and never retries a mutation. Provider bodies and
exceptions are not exposed through error messages.

The reader makes one request: the pull request's metadata. It returns, frozen, the stable GitHub repository ID
(`pr.repo`), owner/name/private status (`pr.github`), the target branch SHA (`baseOid`) and the head (`headOid`), after
checking that the answer names the requested pull request and repository. It never reads the pull request's files,
patches or diff.

`createPublicationPlan({report, pr})` builds the comment from a session review's report (the checklist): whether
Sonah's own review ran, every declared cause of what it could not cover with its count, and the checklist's attention
lines, in fixed sentences — counts and code-owned words only, never a status, a quote, a path or row text. Every
sentence that is not a fixed literal passes the masking call site (today's redactor) and is escaped as Markdown/HTML
before public-content hashing. The plan has no inline comments and no disclosure policy. Plans are immutable,
process-local capabilities minted by the builder, not arbitrary JSON accepted for posting.

`publishReview({client,plan,store,policy})` defaults to disabled and rejects automatic mode, whatever flags a caller
supplies. The only way to post is a manual, confirmed comment on a pull request of a private repository, with its
limits acknowledged (`mode: 'private-preview'`). It requires all of:

```js
{
  mode: 'private-preview', ownerAuthorized: true, limitsAcknowledged: true,
  repositoryId: '42', actorId: '7', appId: '9'
}
```

The authenticated principal IDs must be supplied by the trusted local integration, not model
output. The repository must still be private when each mutation is made. The CLI's explicit
`sonah review ... --github OWNER/REPO --pr N --post-comment` wires this manual path only after a saved HTML page and
interactive confirmation, using numeric `SONAH_GITHUB_ACTOR_ID` / `SONAH_GITHUB_APP_ID` supplied by the user.
A GitHub App with checks-write permission is required for the advisory check.
This package does not acquire permission or expand token scopes itself.

`createFileOperationStore({directory})` supplies a durable journal and per-PR exclusive lock.
Each exact request and its content hash is fsynced before POST. The sequence is pending
`createReview`, `submitReview(event:'COMMENT')`, then a completed **neutral** advisory check.
There are no approval, request-changes, merge, auto-merge or fix-action publication paths.
The check describes operational completion only.

Lost responses leave the operation uncertain. Recovery paginates reviews/checks and requires
the exact content marker, SHA, authenticated author/app and inline contents (none) before proceeding.
It never retries creation just because a list currently shows nothing. Missing or conflicting
remote evidence requires investigation; absence is not proof the first POST failed. A stale
head leaves any pending review untouched. Existing reviews are never edited or deleted.
Completed operations are idempotent; concurrent local workers are excluded. An orphaned lock
after a process crash is deliberately not reclaimed automatically: confirm the old worker is
dead, inspect/reconcile its journal, then remove the lock as an explicit recovery action.

The pending-create/submit sequencing was inspected in Pullfrog's `mcp/review.ts` at
`e354ba26ce66bb317aa30ec13e4bdff962373474`. No upstream implementation was copied; in
particular its draft-deletion recovery and approval/fix controls are not adopted.

API contracts were checked against the official GitHub documentation:
[PR reads](https://docs.github.com/en/rest/pulls/pulls),
[pending reviews and submission](https://docs.github.com/en/rest/pulls/reviews), and
[check runs](https://docs.github.com/en/rest/checks/runs). Run the fake-only boundary tests with
`node --test packages/github/test/*.test.js`.
