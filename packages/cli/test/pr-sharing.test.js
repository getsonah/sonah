// B3, moved onto the session review by D82 step 10: the confirmed, count-only PR comment. Synthetic report and a fake
// GitHub transport only; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { confirmPrSharing, sharePrReview, validatePrSharing } from '../src/pr-sharing.js';
import { REPORT_FOOTER_WORDS } from '../../render/report-words.js';

const BASE = 'b'.repeat(40), HEAD = 'a'.repeat(40);
const env = { SONAH_GITHUB_ACTOR_ID: '7', SONAH_GITHUB_APP_ID: '9' };
const github = () => ({ owner: 'example', repo: 'demo', number: 7 });
/** A session review's report (the checklist): one contradicted claim, one ask shown not done. */
const report = () => ({ pr: null, reviewScope: 'session-only', codeStatus: 'UNCHECKED', sessionStatus: 'DECIDE',
  reviewStatus: 'DECIDE', codeCoverage: 'missing', coverage: 'complete', sessionReview: 'complete', counts: {},
  decisions: [], requirements: [{ text: 'Synthetic hidden ask', status: 'not-done' }],
  findings: [{ id: 'sha256:' + 'd'.repeat(64), origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE',
    title: 'Synthetic hidden finding', explanation: 'Synthetic hidden explanation',
    scope: 'session-effect', anchor: null, receipts: [{ quote: 'Synthetic hidden receipt' }] }] });
function stream() {
  const value = { text: '', write(text) { value.text += text; } };
  return value;
}
function remote() {
  const value = { calls: [], reviews: [], checks: [], private: true, head: HEAD, loseCreate: false };
  value.client = { async request(request) {
    value.calls.push(structuredClone(request));
    if (request.method === 'GET') {
      if (request.path.includes('/reviews/')) return { status: 200, data: [] };
      if (request.path.includes('/reviews?')) return { status: 200, data: structuredClone(value.reviews) };
      if (request.path.includes('/check-runs?')) return { status: 200, data: { check_runs: structuredClone(value.checks) } };
      return { status: 200, data: { number: 7, base: { sha: BASE,
        repo: { id: 42, name: 'demo', private: value.private, owner: { login: 'example' } } }, head: { sha: value.head } } };
    }
    if (request.path.endsWith('/reviews')) {
      const result = { ...structuredClone(request.body), id: 101, state: 'PENDING', user: { id: 7 } };
      value.reviews.push(result);
      if (value.loseCreate) { value.loseCreate = false; throw new Error('synthetic lost response'); }
      return { status: 200, data: result };
    }
    if (request.path.endsWith('/events')) {
      const result = value.reviews[0]; result.state = 'COMMENTED'; result.body = request.body.body;
      return { status: 200, data: structuredClone(result) };
    }
    const result = { ...structuredClone(request.body), id: 201, app: { id: 9 } };
    value.checks.push(result); return { status: 201, data: result };
  } };
  return value;
}
async function setup(t) {
  const stateDir = await mkdtemp(join(tmpdir(), 'sonah-sharing-'));
  t.after(() => rm(stateDir, { recursive: true, force: true }));
  const server = remote(), stdout = stream(), stderr = stream();
  const args = { client: server.client, github: github(), report: report(), stateDir,
    env, stdout, stderr, confirm: async () => true };
  return { server, args, stdout, stderr, stateDir };
}

test('principal configuration accepts only exact trusted numeric IDs', () => {
  assert.deepEqual(validatePrSharing({ env }), { actorId: '7', appId: '9' });
  for (const actorId of [undefined, '', '0', '07', '-1', '1e3', '7\n', '9007199254740992', 7])
    assert.throws(() => validatePrSharing({ env: { ...env, SONAH_GITHUB_ACTOR_ID: actorId } }), { code: 'publication_disabled' });
  assert.throws(() => validatePrSharing({ env: { SONAH_GITHUB_ACTOR_ID: '7' } }), { code: 'publication_disabled' });
});

const posts = (server) => server.calls.filter((call) => call.method === 'POST');
/** The one metadata read a share makes before it plans: never the PR's files or diff. */
const metadataOnly = (server) => server.calls.every((call) => call.method !== 'GET'
  || (call.path === '/repos/example/demo/pulls/7' && call.headers === undefined));

test('declined or unavailable confirmation makes no write or publication journal', async (t) => {
  for (const answer of [false, undefined, 'yes', null]) {
    const { args, server, stateDir, stderr } = await setup(t);
    const result = await sharePrReview({ ...args, confirm: async () => answer });
    assert.equal(result.state, 'cancelled');
    assert.deepEqual(server.calls.map((call) => call.method), ['GET'], 'one metadata read, no write');
    assert.ok(metadataOnly(server));
    assert.deepEqual(await readdir(stateDir), []);
    assert.equal(result.exitCode, answer === null ? 2 : undefined);
    if (answer === null) assert.match(stderr.text, /interactive terminal/);
  }
});

test('default confirmation requires a TTY and exactly names the target; EOF cancels', async () => {
  const target = { owner: 'example', repo: 'demo', number: 7 };
  assert.equal(await confirmPrSharing({ target, input: new PassThrough(), output: new PassThrough() }), null);
  for (const answer of ['share example/demo#7\n', 'yes\n', 'share example/other#7\n', null]) {
    const input = new PassThrough(), output = new PassThrough();
    input.isTTY = true; output.isTTY = true;
    const pending = confirmPrSharing({ target, input, output });
    if (answer === null) input.end(); else input.write(answer);
    assert.equal(await pending, answer === 'share example/demo#7\n');
  }
});

// The answer to this question is the consent the publication policy records (`ownerAuthorized`, `limitsAcknowledged`),
// so its words are pinned: a rewrite may change their form, never drop the person's confirmation of their right to post.
test('the confirmation asks the person to read the page, to confirm their right to post on that pull request, and to accept its limits', async () => {
  const target = { owner: 'example', repo: 'demo', number: 7 };
  const input = new PassThrough(), output = new PassThrough();
  input.isTTY = true; output.isTTY = true;
  let asked = '';
  output.on('data', (chunk) => { asked += chunk.toString('utf8'); });
  const pending = confirmPrSharing({ target, input, output });
  input.write('share example/demo#7\n');
  assert.equal(await pending, true);
  // The terminal's cursor controls taken out, the person reads these two lines.
  asked = asked.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  assert.ok(asked.startsWith('Read the saved page before you answer.\n'), asked);
  assert.ok(asked.includes("Type 'share example/demo#7' to confirm your right to post this comment on that pull request "
    + 'and accept its limits: '), asked);
});

test('confirmed preview posts only counts and neutral COMMENT/check, persists before writes, then deduplicates', async (t) => {
  const { args, server, stdout, stateDir } = await setup(t);
  const rawRequest = server.client.request;
  server.client.request = async (request) => {
    if (request.method === 'POST') {
      const names = (await readdir(join(stateDir, 'publication'))).filter((name) => name.endsWith('.json'));
      assert.equal(names.length, 1);
      const journal = JSON.parse(await readFile(join(stateDir, 'publication', names[0]), 'utf8'));
      assert.ok(journal.requests.review.body.includes('Read it before you share it.'));
      assert.equal((await stat(join(stateDir, 'publication', names[0]))).mode & 0o777, 0o600);
    }
    return rawRequest(request);
  };
  const first = await sharePrReview(args);
  assert.equal(first.state, 'complete');
  const sent = posts(server);
  assert.equal(sent.length, 3);
  assert.equal(sent[0].body.comments.length, 0);
  assert.equal(sent[1].body.event, 'COMMENT');
  assert.equal(sent[2].body.conclusion, 'neutral');
  assert.ok(metadataOnly(server), 'the pull request\'s files and diff are never read');
  const disclosed = JSON.stringify(sent) + stdout.text;
  assert.doesNotMatch(disclosed, /Synthetic hidden/);
  assert.match(disclosed, /Read it before you share it/);
  // D82 step 10: the comment is the session review's checklist, as counts and fixed words.
  assert.match(sent[0].body.body, /What needs your attention:\n- 1 ask that the session review marks not done or partly done/);
  assert.match(sent[0].body.body, /\n- 1 claim .*contradicts/);
  assert.equal((await sharePrReview(args)).state, 'complete');
  assert.equal(posts(server).length, 3);
});

test('lost response resumes through existing journal without recreating the pending review', async (t) => {
  const { args, server, stderr } = await setup(t);
  server.loseCreate = true;
  assert.equal((await sharePrReview(args)).state, 'uncertain');
  assert.match(stderr.text, /operation_uncertain/);
  assert.match(stderr.text, /run the same review again with the same arguments and state directory, and a new --output file name\./);
  assert.equal((await sharePrReview(args)).state, 'complete');
  assert.equal(server.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/reviews')).length, 1);
  assert.equal(server.checks[0].conclusion, 'neutral');
});

test('a changed head or public target after confirmation prevents writes', async (t) => {
  for (const change of ['head', 'private']) {
    const { args, server } = await setup(t);
    const result = await sharePrReview({ ...args, confirm: async () => {
      if (change === 'head') server.head = 'f'.repeat(40); else server.private = false;
      return true;
    } });
    assert.equal(result.state, 'stale'); assert.equal(result.exitCode, 3);
    assert.equal(posts(server).length, 0);
  }
});

test('unsupported sharing configuration and a public repository do not confirm or write', async (t) => {
  for (const bad of ['env', 'public']) {
    const { args, server, stdout, stderr, stateDir } = await setup(t);
    let confirmations = 0;
    if (bad === 'env') args.env = {}; else server.private = false;
    const result = await sharePrReview({ ...args, confirm: async () => { confirmations++; return true; } });
    assert.equal(result.state, 'failed'); assert.equal(confirmations, 0);
    // A configuration that cannot post reads nothing; a public repository is known only from its metadata.
    assert.deepEqual(server.calls.map((call) => call.method), bad === 'env' ? [] : ['GET']);
    assert.deepEqual(await readdir(stateDir), []);
    assert.equal(stdout.text, ''); assert.match(stderr.text, /publication_disabled/);
  }
});

test('a throwing confirmation prints only a closed diagnostic and preserves local artifacts', async (t) => {
  const { args, server, stderr } = await setup(t);
  const result = await sharePrReview({ ...args, confirm: async () => { throw new Error('Synthetic private provider detail'); } });
  assert.equal(result.state, 'failed'); assert.equal(posts(server).length, 0);
  assert.match(stderr.text, /github_unavailable/); assert.doesNotMatch(stderr.text, /Synthetic private/);
});

test('the local page the comment follows carries the same read-before-share reminder', () => {
  // D97: the page's footer says it in the report's words.
  assert.match(REPORT_FOOTER_WORDS.share, /^Read this report before you share it\.$/);
});

test('a metadata read GitHub refuses or answers malformed fails closed, before confirmation or write', async (t) => {
  for (const reply of ['throw', 'malformed']) {
    const { args, server, stderr, stateDir } = await setup(t);
    const raw = server.client.request;
    server.client.request = async (request) => {
      if (request.method === 'GET' && reply === 'throw') throw new Error('Synthetic provider secret detail');
      if (request.method === 'GET') return { status: 200, data: { number: 7, base: { sha: 'short' } } };
      return raw(request);
    };
    let confirmations = 0;
    const result = await sharePrReview({ ...args, confirm: async () => { confirmations++; return true; } });
    assert.deepEqual([result.state, result.exitCode, confirmations], ['failed', 3, 0]);
    assert.equal(posts(server).length, 0); assert.deepEqual(await readdir(stateDir), []);
    assert.match(stderr.text, reply === 'throw' ? /github_unavailable/ : /github_response_invalid/);
    assert.doesNotMatch(stderr.text, /Synthetic provider/);
  }
});
