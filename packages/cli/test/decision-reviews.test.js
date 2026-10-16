import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, appendFile, stat, chmod, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { recordDecisionReview, loadDecisionReviews } from '../src/decision-reviews.js';
import { scratchDir } from '../../slicer/test/scratch-dir.js';

const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
// Ledger decision ids (an M33 report's), the key of every record the store writes.
const ID_A = `sha256:${'1'.repeat(64)}`;
const ID_B = `sha256:${'2'.repeat(64)}`;
const review = (hash, decisionId, verb = 'accept') => ({ v: 2, ts: '2026-09-10T12:00:00.000Z', hash, decisionId, verb, reason: 'Reviewed the changed lines.' });

async function withHome(run) {
  const home = await scratchDir('sonah decision review ');
  const saved = process.env.SONAH_HOME;
  process.env.SONAH_HOME = home;
  try { await run(home); }
  finally { if (saved === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = saved; }
}

test('records append with private permissions, reject invalid reasons, and load the latest choice independently', async () => withHome(async (home) => {
  const key = ID_A;
  assert.equal(await recordDecisionReview({ hash: HASH, decisionId: key, verb: 'accept', reason: '   ' }), false);
  assert.equal(await recordDecisionReview({ hash: HASH, decisionId: key, verb: 'later', reason: 'Wait.' }), false);
  assert.equal(await recordDecisionReview({ hash: '../not-a-hash', decisionId: key, verb: 'accept', reason: 'Reviewed.' }), false);
  assert.equal(await recordDecisionReview({ hash: HASH, decisionId: key, verb: 'accept', reason: 'x'.repeat(2001) }), false);
  assert.equal(await recordDecisionReview({ hash: HASH, decisionId: key, verb: 'change', reason: '  Please use the existing parser.  ' }), true);
  const file = join(home, 'decision-reviews.ndjsonl');
  const original = await readFile(file, 'utf8');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(original).reason, 'Please use the existing parser.');
  assert.equal(await recordDecisionReview({ hash: HASH, decisionId: ID_B, verb: 'clarify', reason: 'Explain the locale choice.' }), true);
  assert.equal(await recordDecisionReview({ hash: HASH, decisionId: key, verb: 'accept', reason: 'The updated choice is acceptable.' }), true);
  const bytes = await readFile(file, 'utf8');
  assert.ok(bytes.startsWith(original), 'existing records remain unchanged');
  assert.equal(bytes.trim().split('\n').length, 3);
  const reviews = await loadDecisionReviews();
  assert.equal(reviews.get(HASH).get(key).verb, 'accept');
  assert.equal(reviews.get(HASH).get(ID_B).verb, 'clarify');
  assert.equal(reviews.has(OTHER), false);
  await appendFile(file, '{incomplete\n' + JSON.stringify({ ...review(HASH, key), verb: 'invented' }) + '\n');
  assert.equal((await loadDecisionReviews()).get(HASH).get(key).verb, 'accept', 'invalid trailing rows do not erase valid history');
}));

test('the store repairs its own file permissions and refuses a linked log', async () => withHome(async (home) => {
  const file = join(home, 'decision-reviews.ndjsonl');
  await writeFile(file, '', { mode: 0o644 });
  await chmod(file, 0o644);
  assert.equal(await recordDecisionReview({ hash: HASH, decisionId: ID_A, verb: 'accept', reason: 'Reviewed.' }), true);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const linkedHome = join(home, 'linked'); await mkdir(linkedHome);
  await symlink(file, join(linkedHome, 'decision-reviews.ndjsonl'));
  const bytes = await readFile(file, 'utf8');
  process.env.SONAH_HOME = linkedHome;
  assert.equal(await recordDecisionReview({ hash: HASH, decisionId: ID_A, verb: 'change', reason: 'No.' }), false);
  assert.equal((await loadDecisionReviews()).size, 0);
  assert.equal(await readFile(file, 'utf8'), bytes);
}));
