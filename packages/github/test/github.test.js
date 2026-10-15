// D82 step 10: the boundary the session review's count-only PR comment uses — a metadata-only PR read, a plan built
// from the session review's report, and the journaled publisher. Fake GitHub transport only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitHubClient, readPullRequestMetadata, createPublicationPlan, publishReview,
  createFileOperationStore, PUBLICATION_PLAN_SCHEMA, escapePublicText } from '../index.js';

const BASE = 'b'.repeat(40), HEAD = 'a'.repeat(40);
const metadata = () => ({ number: 7, changed_files: 1, base: { sha: BASE,
  repo: { id: 42, name: 'demo', private: true, owner: { login: 'example' } } }, head: { sha: HEAD } });
const pr = () => ({ repo: { host: 'github.com', id: '42' }, number: 7, baseOid: BASE, headOid: HEAD,
  github: { owner: 'example', name: 'demo', private: true } });
/** A session review's report whose run state cannot be shown complete: one contradicted claim. */
const report = () => ({ pr: null, reviewScope: 'session-only', codeStatus: 'UNCHECKED', sessionStatus: 'DECIDE',
  reviewStatus: 'DECIDE', findings: [{
    id: 'sha256:' + 'd'.repeat(64), origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE',
    title: 'The agent said the cache was reachable', explanation: 'The recorded check failed to connect.',
    scope: 'session-effect', anchor: null, receipts: [{ role: 'observation', quote: 'connection refused' }],
  }] });
const planFor = (options = {}) => createPublicationPlan({ report: report(), pr: pr(), ...options });
const POLICY = { mode: 'private-preview', ownerAuthorized: true, limitsAcknowledged: true,
  repositoryId: '42', actorId: '7', appId: '9' };

function memoryStore() {
  const records = new Map(); const locks = new Set();
  return { records,
    async get(key) { return records.has(key) ? structuredClone(records.get(key)) : null; },
    async put(key, value) { records.set(key, structuredClone(value)); },
    async withLock(key, callback) {
      if (locks.has(key)) throw Object.assign(new Error('operation_busy'), { code: 'operation_busy' });
      locks.add(key); try { return await callback(); } finally { locks.delete(key); }
    },
  };
}

function fakeGitHub(options = {}) {
  const remote = { metadata: metadata(), reviews: [], comments: new Map(), checks: [], calls: [], fail: {},
    onRequest: null };
  const page = (rows, url, key = null) => {
    const number = Number(url.searchParams.get('page') ?? 1);
    const values = rows.slice((number - 1) * 100, number * 100);
    return { status: 200, data: key ? { [key]: values } : values,
      headers: rows.length > number * 100 ? { link: '<https://untrusted.invalid/ignored>; rel="next"' } : {} };
  };
  remote.client = { async request(input) {
    const request = structuredClone(input); remote.calls.push(request);
    if (remote.onRequest) await remote.onRequest(request);
    const url = new URL(request.path, 'https://api.github.com'); const path = url.pathname;
    if (request.method === 'GET') {
      if (path.endsWith('/pulls/7') && request.headers === undefined)
        return { status: 200, data: structuredClone(remote.metadata) };
      if (path.endsWith('/reviews')) return page(remote.reviews, url);
      if (/\/reviews\/\d+\/comments$/.test(path)) return page(remote.comments.get(Number(path.split('/').at(-2))) ?? [], url);
      if (path.endsWith('/check-runs')) return page(remote.checks, url, 'check_runs');
    }
    if (request.method === 'POST' && path.endsWith('/reviews')) {
      if (remote.fail.create === 'before') throw new Error('synthetic timeout');
      const created = { ...structuredClone(request.body), id: 101 + remote.reviews.length, state: 'PENDING', user: { id: 7 } };
      remote.reviews.push(created); remote.comments.set(created.id, request.body.comments ?? []);
      if (remote.fail.create === 'after') { remote.fail.create = null; throw new Error('synthetic lost response'); }
      return { status: 200, data: structuredClone(created) };
    }
    if (request.method === 'POST' && path.endsWith('/events')) {
      assert.equal(request.body.event, 'COMMENT');
      const review = remote.reviews.find((entry) => entry.id === Number(path.split('/').at(-2)));
      if (!review) return { status: 404, data: {} };
      review.state = 'COMMENTED'; review.body = request.body.body;
      if (remote.fail.submit === 'after') { remote.fail.submit = null; throw new Error('synthetic lost response'); }
      return { status: 200, data: structuredClone(review) };
    }
    if (request.method === 'POST' && path.endsWith('/check-runs')) {
      const created = { ...structuredClone(request.body), id: 201 + remote.checks.length, app: { id: 9 } };
      remote.checks.push(created);
      if (remote.fail.check === 'after') { remote.fail.check = null; throw new Error('synthetic lost response'); }
      return { status: 201, data: structuredClone(created) };
    }
    throw new Error('unexpected fake request');
  } };
  Object.assign(remote, options); return remote;
}

const read = (remote) => readPullRequestMetadata({ client: remote.client, owner: 'example', repo: 'demo', number: 7 });
const writes = (remote) => remote.calls.filter((entry) => entry.method === 'POST');
const publish = (remote, store, plan = planFor()) => publishReview({ client: remote.client, store, plan,
  policy: POLICY, now: () => '2026-09-20T00:00:00Z' });

test('the metadata read makes one GET of the PR, never its files or diff, and freezes its identity', async () => {
  const remote = fakeGitHub(); const result = await read(remote);
  assert.deepEqual(result, pr());
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.repo) && Object.isFrozen(result.github));
  assert.deepEqual(remote.calls, [{ method: 'GET', path: '/repos/example/demo/pulls/7' }]);
  remote.metadata.base.repo.private = false;
  assert.equal((await read(remote)).github.private, false, 'a public repository is read as public, never refused here');
});

test('GitHub malformed and abbreviated OIDs never become frozen revisions', async () => {
  for (const oid of ['HEAD', 'abcdef', 'h'.repeat(40)]) {
    const remote = fakeGitHub(); remote.metadata.head.sha = oid;
    await assert.rejects(read(remote), { code: 'github_response_invalid' });
  }
});

test('a metadata answer for another PR, repository or owner is refused, never planned against', async () => {
  for (const mutate of [(m) => { m.number = 8; }, (m) => { m.base.repo.name = 'other'; },
    (m) => { m.base.repo.owner.login = 'someone'; }, (m) => { m.base.repo.id = 0; },
    (m) => { delete m.base.repo.private; }]) {
    const remote = fakeGitHub(); mutate(remote.metadata);
    await assert.rejects(read(remote), { code: 'github_response_invalid' });
  }
});

test('publication defaults disclose counts and the run state, never a status, private finding prose or receipts', () => {
  const result = report(); result.findings[0].title = 'SYNTHETIC_PRIVATE_TITLE';
  result.findings[0].receipts[0].quote = 'SYNTHETIC_PRIVATE_QUOTE';
  const plan = planFor({ report: result });
  const serialized = JSON.stringify(plan);
  assert.ok(!serialized.includes('SYNTHETIC_PRIVATE_'));
  assert.equal(plan.review.comments.length, 0);
  // D71 (a): the body says whether Sonah's own review ran, never a status.
  assert.ok(plan.review.body.includes("Sonah's review did not complete"));
  assert.doesNotMatch(plan.review.body, /DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED/);
  assert.equal(plan.check.conclusion, 'neutral');
  assert.equal(plan.check.output.title, 'Advisory review did not complete');
  assert.ok(Object.isFrozen(plan.review));
  assert.equal(plan.id, planFor({ report: result }).id);
});

test('the plan has no disclosure, inline comment or diff: finding text, receipts and anchors never reach it', () => {
  const result = report();
  result.findings[0].anchor = { path: 'config/redis.yml', side: 'RIGHT', startLine: 3, endLine: 3 };
  const disclosure = { allowedFindingIds: [result.findings[0].id], includeReceipts: true,
    protectedViewUrl: 'https://example.invalid/x' };
  const plan = planFor({ report: result, diff: 'SYNTHETIC_DIFF_TEXT', disclosure });
  assert.equal(plan.schema, PUBLICATION_PLAN_SCHEMA);
  assert.deepEqual(plan, planFor(), 'a disclosure policy or a diff changes nothing: there is none to apply');
  assert.equal(plan.review.comments.length, 0);
  for (const text of ['cache was reachable', 'connection refused', 'redis.yml', 'SYNTHETIC_DIFF_TEXT',
    'example.invalid'])
    assert.ok(!JSON.stringify(plan).includes(text), text);
  assert.deepEqual(Object.keys(plan).sort(), ['baseOid', 'check', 'contentHash', 'headOid', 'id', 'marker', 'review',
    'schema', 'target']);
});

test('the comment\'s one masking call site masks a planted key before escaping, hashing or posting', () => {
  // publication.js `maskPublicText` (fix 5 swaps in the shared output masking there): every sentence of the comment
  // that is not a fixed literal passes through it. Fake keys, assembled at run time.
  for (const key of [['gh', 'p_', 'FAKE'.repeat(9)].join(''), ['AK', 'IA', 'FAKEFAKEFAKEFAKE'].join('')]) {
    const out = escapePublicText(`token ${key} here`);
    assert.ok(!out.includes(key) && !out.includes('FAKEFAKE'), out);
    assert.match(out, /^token ‹redacted:[^›]+› here$/);
  }
  assert.equal(escapePublicText('1 ask of yours not shown done.'), '1 ask of yours not shown done\\.',
    'a clean sentence is only escaped');
});

test('default and automatic publication gates fail before networking or journal writes', async () => {
  const remote = fakeGitHub(); const store = memoryStore(); const plan = planFor();
  for (const [policy, code] of [[undefined, 'publication_disabled'], [{ mode: 'automatic', qualityPassed: true }, 'quality_gate_unmet']]) {
    await assert.rejects(publishReview({ client: remote.client, store, plan, policy }), { code });
  }
  assert.equal(remote.calls.length, 0); assert.equal(store.records.size, 0);
});

test('private preview requires exact owner authorization and cannot post to a now-public PR', async () => {
  const remote = fakeGitHub(); const plan = planFor(); const store = memoryStore();
  await assert.rejects(publishReview({ client: remote.client, store, plan,
    policy: { ...POLICY, ownerAuthorized: false } }), { code: 'publication_disabled' });
  remote.metadata.base.repo.private = false;
  assert.equal((await publish(remote, store, plan)).state, 'stale');
  assert.equal(writes(remote).length, 0);
});

test('COMMENT publication journals each intent before POST and creates an advisory neutral check', async () => {
  const remote = fakeGitHub(); const store = memoryStore();
  const plan = planFor();
  remote.onRequest = async (request) => {
    if (request.method === 'POST') {
      const operation = store.records.get(plan.id);
      assert.ok(operation); assert.equal(operation.marker, plan.marker);
      assert.ok(operation.requests.reviewHash);
      if (request.path.endsWith('/events')) assert.ok(operation.requests.submitHash);
      if (request.path.endsWith('/check-runs')) assert.ok(operation.requests.checkHash);
    }
  };
  const result = await publish(remote, store, plan);
  assert.equal(result.state, 'complete'); assert.equal(writes(remote).length, 3);
  assert.ok(!Object.hasOwn(writes(remote)[0].body, 'event'), 'creation is a pending review');
  assert.equal(writes(remote)[1].body.event, 'COMMENT');
  assert.equal(writes(remote)[2].body.conclusion, 'neutral');
  assert.equal(writes(remote)[2].body.head_sha, HEAD);
  await publish(remote, store, plan);
  assert.equal(writes(remote).length, 3, 'a completed operation is not posted again');
});

for (const phase of ['create', 'submit', 'check']) {
  test(`lost ${phase} response reconciles existing objects instead of duplicating them`, async () => {
    const remote = fakeGitHub(); remote.fail[phase] = 'after';
    const store = memoryStore(); const plan = planFor();
    assert.equal((await publish(remote, store, plan)).state, 'uncertain');
    assert.equal((await publish(remote, store, plan)).state, 'complete');
    assert.equal(remote.reviews.length, 1); assert.equal(remote.checks.length, 1);
    assert.equal(writes(remote).length, 3, 'each remote mutation is performed once');
  });
}

test('an uncertain create with no visible review does not authorize another create', async () => {
  const remote = fakeGitHub(); remote.fail.create = 'before';
  const store = memoryStore(); const plan = planFor();
  assert.equal((await publish(remote, store, plan)).state, 'uncertain');
  remote.fail.create = null;
  assert.equal((await publish(remote, store, plan)).state, 'uncertain');
  assert.equal(writes(remote).length, 1);
});

test('reconciliation scans every review page and checks the authenticated author', async () => {
  const remote = fakeGitHub(); remote.fail.create = 'after';
  const store = memoryStore(); const plan = planFor();
  await publish(remote, store, plan);
  remote.reviews.unshift(...Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, state: 'COMMENTED', body: 'unrelated' })));
  assert.equal((await publish(remote, store, plan)).state, 'complete');
  assert.ok(remote.calls.some((call) => call.path.includes('/reviews?') && call.path.endsWith('page=2')));
  const other = fakeGitHub(); other.fail.create = 'after'; const otherStore = memoryStore();
  await publish(other, otherStore, plan);
  other.reviews[0].user.id = 88;
  assert.equal((await publish(other, otherStore, plan)).state, 'uncertain');
  assert.equal(writes(other).length, 1);
});

test('reconciliation rejects inline content the plan never had rather than claim a complete publication', async () => {
  const remote = fakeGitHub(); remote.fail.create = 'after';
  const store = memoryStore(); const plan = planFor();
  await publish(remote, store, plan);
  remote.comments.get(remote.reviews[0].id).push({ path: 'a.js', side: 'RIGHT', line: 1, body: 'different content' });
  assert.equal((await publish(remote, store, plan)).state, 'uncertain');
  assert.equal(writes(remote).length, 1);
});

test('reconciliation rejects a forged check from another app', async () => {
  const remote = fakeGitHub(); remote.fail.check = 'after'; const store = memoryStore(); const plan = planFor();
  await publish(remote, store, plan);
  remote.checks[0].app.id = 999;
  assert.equal((await publish(remote, store, plan)).state, 'uncertain');
  assert.equal(remote.checks.length, 1); assert.equal(writes(remote).length, 3);
});

test('a moving head between review creation and submission never submits the stale draft', async () => {
  const remote = fakeGitHub(); const store = memoryStore(); const plan = planFor();
  remote.onRequest = async (request) => {
    if (request.method === 'GET' && remote.reviews.length) remote.metadata.head.sha = 'f'.repeat(40);
  };
  const operation = await publish(remote, store, plan);
  assert.notEqual(operation.state, 'complete');
  assert.equal(writes(remote).length, 1); assert.equal(remote.reviews[0].state, 'PENDING');
  assert.equal(remote.checks.length, 0);
});

test('a corrupted journal cannot replace the exact review payload under an existing operation ID', async () => {
  const remote = fakeGitHub(); remote.fail.create = 'before'; const store = memoryStore(); const plan = planFor();
  await publish(remote, store, plan);
  store.records.get(plan.id).requests.review.event = 'APPROVE';
  await assert.rejects(publish(remote, store, plan), { code: 'operation_conflict' });
  assert.equal(writes(remote).length, 1);
});

test('stale heads block publication and an in-flight operation is locked against duplicate workers', async () => {
  const remote = fakeGitHub(); remote.metadata.head.sha = 'f'.repeat(40);
  assert.equal((await publish(remote, memoryStore())).state, 'stale'); assert.equal(writes(remote).length, 0);
  const second = fakeGitHub(); const store = memoryStore(); const plan = planFor();
  let release; const blocked = new Promise((resolve) => { release = resolve; });
  let entered; const seen = new Promise((resolve) => { entered = resolve; });
  second.onRequest = async () => { entered(); await blocked; };
  const pending = publish(second, store, plan); await seen;
  await assert.rejects(publish(second, store, plan), { code: 'operation_busy' });
  release(); assert.equal((await pending).state, 'complete'); assert.equal(second.reviews.length, 1);
});

test('durable private journal survives a new store instance after a lost response', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-github-test-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const remote = fakeGitHub(); remote.fail.create = 'after'; const plan = planFor();
  assert.equal((await publish(remote, createFileOperationStore({ directory }), plan)).state, 'uncertain');
  const path = join(directory, `${plan.id}.json`);
  const saved = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(saved.marker, plan.marker); assert.deepEqual(saved.requests.review, plan.review);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await publish(remote, createFileOperationStore({ directory }), plan)).state, 'complete');
  assert.equal(remote.reviews.length, 1);
});

test('HTTP adapter rejects approval, merge and actionable check requests without sending them', async () => {
  let calls = 0; const client = createGitHubClient({ token: 'synthetic', fetchImpl: async () => { calls++; } });
  for (const input of [
    { method: 'POST', path: '/repos/example/demo/pulls/7/reviews', body: { event: 'APPROVE' } },
    { method: 'POST', path: '/repos/example/demo/pulls/7/reviews/1/events', body: { event: 'REQUEST_CHANGES' } },
    { method: 'POST', path: '/repos/example/demo/pulls/7/merge', body: {} },
    { method: 'POST', path: '/repos/example/demo/check-runs', body: { conclusion: 'failure' } },
  ]) await assert.rejects(client.request(input), { code: 'publication_disabled' });
  assert.equal(calls, 0);
});

test('HTTP adapter refuses redirects and hides provider secrets from safe diagnostics', async () => {
  const client = createGitHubClient({ token: 'synthetic', fetchImpl: async (_url, options) => {
    assert.equal(options.redirect, 'error'); throw new Error('SYNTHETIC_PROVIDER_SECRET');
  } });
  await assert.rejects(client.request({ path: '/repos/example/demo/pulls/7' }), (error) =>
    error.code === 'github_unavailable' && !error.message.includes('SYNTHETIC_PROVIDER_SECRET'));
});

test('HTTP adapter reads JSON only: a diff or other text answer is refused, whatever the request asked for',
  async () => {
  const client = createGitHubClient({ token: 'synthetic', fetchImpl: async () => ({ status: 200,
    headers: new Headers(), text: async () => 'diff --git a/a.js b/a.js\n' }) });
  for (const headers of [undefined, { Accept: 'application/vnd.github.diff' }])
    await assert.rejects(client.request({ path: '/repos/example/demo/pulls/7', headers }),
      { code: 'github_response_invalid' });
});
