import { fail } from './errors.js';

// No automatic credential discovery and no retries of mutations. Tests inject fetch.
export function createGitHubClient({ token = null, fetchImpl = globalThis.fetch,
  apiBase = 'https://api.github.com' } = {}) {
  if (apiBase !== 'https://api.github.com' || typeof fetchImpl !== 'function'
      || (token != null && (typeof token !== 'string' || /[\r\n]/.test(token)))) fail('invalid_input');
  return Object.freeze({ async request({ method = 'GET', path, headers = {}, body } = {}) {
    if (!['GET', 'POST'].includes(method) || typeof path !== 'string' || !path.startsWith('/repos/')
        || path.startsWith('//') || /[\r\n#\\]/.test(path)) fail('invalid_input');
    const url = new URL(path, apiBase);
    if (url.origin !== apiBase) fail('invalid_input');
    if (method === 'POST') {
      const base = '/repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+';
      const create = new RegExp(`^${base}/pulls/[1-9][0-9]*/reviews$`).test(path);
      const submit = new RegExp(`^${base}/pulls/[1-9][0-9]*/reviews/[1-9][0-9]*/events$`).test(path);
      const check = new RegExp(`^${base}/check-runs$`).test(path);
      if ((!create && !submit && !check) || !body || (create && Object.hasOwn(body, 'event'))
          || (submit && body.event !== 'COMMENT') || (check && (body.conclusion !== 'neutral' || body.actions)))
        fail('publication_disabled');
    }
    let response;
    try {
      response = await fetchImpl(url.href, { method, redirect: 'error',
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10',
          ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { fail('github_unavailable'); }
    if (!response || !Number.isInteger(response.status)) fail('github_response_invalid');
    if (response.status < 200 || response.status >= 300) fail('github_unavailable');
    // D82 step 10: every answer is JSON (a PR's metadata, reviews, checks); no diff is ever read.
    let data;
    try { data = JSON.parse(await response.text()); } catch { fail('github_response_invalid'); }
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), data };
  } });
}

export async function request(client, method, path, body, headers) {
  let response;
  try { response = await client.request({ method, path, ...(body === undefined ? {} : { body }),
    ...(headers ? { headers } : {}) }); }
  catch { fail('github_unavailable'); }
  if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status >= 300)
    fail('github_unavailable');
  return response;
}

export function targetPath({ owner, repo, number }) {
  if (typeof owner !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(owner)
      || typeof repo !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(repo) || ['.', '..'].includes(repo)
      || !Number.isSafeInteger(number) || number < 1) fail('invalid_input');
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`;
}

export function hasNext(headers = {}) {
  const link = typeof headers.get === 'function' ? headers.get('link') : headers.link ?? headers.Link;
  return typeof link === 'string' && /;\s*rel="next"/.test(link);
}

// Pagination constructs local paths; it never follows a provider-controlled Link URL.
export async function listPages(client, path, { key = null, maxPages = 100 } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page++) {
    const response = await request(client, 'GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const rows = key ? response.data?.[key] : response.data;
    if (!Array.isArray(rows)) fail('github_response_invalid');
    items.push(...rows);
    if (!hasNext(response.headers) && rows.length < 100) return { items, complete: true };
  }
  return { items, complete: false };
}
