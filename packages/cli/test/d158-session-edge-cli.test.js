// D158: a session review (session-review.js `reviewSession`) passes the session's edge maps switch to the review only
// when a caller turns it on; off, every answer, window record and progress byte it stores is the same, and on, so are
// they: the maps are zero-call and only the report gains them. Synthetic only: a temporary directory, a fake judge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reviewSession, createSessionReviewStore } from '../src/session-review.js';
import { createAnswerCache } from '../src/answer-cache.js';
import { edgeSession, receipt } from '../../evidence/test/d158-session-edge-fixture.js';

const IDENTITY = { backend: 'claude-cli', model: 'sonnet' };
const narrative = (x = {}) => ({ decisions: [], pivots: [], claims: [], requirements: [], ...x });
const judge = async (request) => {
  if (request.challenge) return { votes: request.challenge.items.map((item) => {
    const cited = item.candidate?.supportedBy ?? item.candidate?.stated ?? null;
    return { key: item.key, verdict: 'not-refuted', explanation: 'Synthetic check.',
      receipts: cited ? [{ eventId: cited.eventId, role: cited.role, quote: cited.quote }] : [] };
  }) };
  return narrative({ claims: [{ text: 'all tests pass', stated: receipt('C1', 'commentary', 'All tests pass.'),
    supportedBy: receipt('A3-r', 'observation', 'ok 1 - empty name') }] });
};

async function stored(dir) {
  const out = {};
  const walk = async (at) => {
    for (const entry of (await readdir(at, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) await walk(path);
      else out[path.slice(dir.length)] = await readFile(path, 'utf8');
    }
  };
  await walk(dir);
  return out;
}

async function run(t, option) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d158-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const report = await reviewSession({ session: edgeSession(), judge, ...IDENTITY,
    answerCache: createAnswerCache(join(dir, 'answers'), IDENTITY), store: createSessionReviewStore(join(dir, 'review')),
    ...option });
  return { report, files: await stored(dir) };
}

test('D158: the edge maps reach the report only when turned on, and nothing stored moves', async (t) => {
  const absent = await run(t, {});
  const off = await run(t, { sessionEdgeMaps: false });
  const on = await run(t, { sessionEdgeMaps: true });
  const reportOf = (r) => r.report?.report ?? r.report;
  assert.ok(!Object.hasOwn(reportOf(absent), 'sessionEdge'));
  assert.deepEqual(off.files, absent.files);
  assert.equal(JSON.stringify(reportOf(off)), JSON.stringify(reportOf(absent)));
  const { sessionEdge, ...rest } = reportOf(on);
  assert.equal(JSON.stringify(rest), JSON.stringify(reportOf(absent)));
  assert.equal(sessionEdge.claims.counts.verified, 1);
  assert.deepEqual(Object.keys(on.files), Object.keys(absent.files));
  for (const [path, text] of Object.entries(on.files))
    if (!/report\.private\.json$/.test(path)) assert.equal(text, absent.files[path], path);
});
