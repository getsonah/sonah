// D82 step 10 (B5 O1-B, P7): the session review's PR comment reads only a pull request's metadata — its base and head
// revisions, its repository's id and whether that repository is private — never its files, patches or diff.
import { fail } from './errors.js';
import { request, targetPath } from './client.js';

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
