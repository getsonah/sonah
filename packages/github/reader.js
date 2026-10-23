// D82 step 10 (B5 O1-B, P7): the session review's PR comment reads only a pull request's metadata — its base and head
// revisions, its repository's id and whether that repository is private — never its files, patches or diff. D143:
// `sonah sessions --github` reads the same metadata, with its count of commits, and the list of its commits (each one's
// id, message and committer date). Every read here is a GET.
import { fail } from './errors.js';
import { listPages, request, targetPath } from './client.js';

export const isOid = (value) => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
export const freeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export function checkMetadata(metadata, target) {
  if (!metadata || metadata.number !== target.number || !isOid(metadata.base?.sha)
      || !isOid(metadata.head?.sha) || metadata.base.sha.length !== metadata.head.sha.length
      || !Number.isSafeInteger(metadata.base?.repo?.id) || metadata.base.repo.id < 1
      || typeof metadata.base.repo.private !== 'boolean'
      || typeof metadata.base.repo.name !== 'string' || metadata.base.repo.name.toLowerCase() !== target.repo.toLowerCase()
      || typeof metadata.base.repo.owner?.login !== 'string'
      || metadata.base.repo.owner.login.toLowerCase() !== target.owner.toLowerCase()) fail('github_response_invalid');
  return { baseOid: metadata.base.sha, headOid: metadata.head.sha,
    repositoryId: String(metadata.base.repo.id), private: metadata.base.repo.private };
}

/** One metadata read of `owner/repo#number`, frozen: the identity a counts-only comment is planned against. */
export async function readPullRequestMetadata({ client, owner, repo, number }) {
  const target = { owner, repo, number };
  const metadata = checkMetadata((await request(client, 'GET', targetPath(target))).data, target);
  return freeze({ repo: { host: 'github.com', id: metadata.repositoryId }, number,
    github: { owner, name: repo, private: metadata.private }, baseOid: metadata.baseOid, headOid: metadata.headOid });
}

/** GitHub lists at most this many commits of a pull request (REST "List commits on a pull request"); past it, the list
 *  is not whole. https://docs.github.com/en/rest/pulls/pulls#list-commits-on-a-pull-request */
export const PULL_REQUEST_COMMITS_CAP = 250;

/**
 * D143: the commits of `owner/repo#number`, as GitHub lists them (GET .../pulls/{n}/commits, page by page with
 * listPages), beside the pull request's own count of commits (GET .../pulls/{n}, the read readPullRequestMetadata makes):
 * `{ baseOid, headOid, count, commits, whole }`, each commit `{ sha, message, time }` (its committer time in seconds),
 * oldest first as GitHub lists them. `whole` only when the list holds every commit the count says: past 250, GitHub
 * lists the first 250, and listPages, which reads a short last page as the end, cannot tell. Reads no file, patch or diff.
 */
export async function readPullRequestCommits({ client, owner, repo, number }) {
  const target = { owner, repo, number };
  const data = (await request(client, 'GET', targetPath(target))).data;
  const checked = checkMetadata(data, target);
  const count = data.commits;
  if (!Number.isSafeInteger(count) || count < 0) fail('github_response_invalid');
  const listed = await listPages(client, `${targetPath(target)}/commits`,
    { maxPages: Math.ceil(PULL_REQUEST_COMMITS_CAP / 100) });
  const commits = listed.items.map((item) => {
    const time = Date.parse(item?.commit?.committer?.date);
    if (!isOid(item?.sha) || typeof item.commit?.message !== 'string' || !Number.isFinite(time))
      fail('github_response_invalid');
    return { sha: item.sha, message: item.commit.message, time: Math.floor(time / 1000) };
  });
  return freeze({ baseOid: checked.baseOid, headOid: checked.headOid, count, commits,
    whole: listed.complete && commits.length === count });
}
