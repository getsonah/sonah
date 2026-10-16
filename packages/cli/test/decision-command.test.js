// D69 f (g): `sonah decision` records your answer to one decision of a session review, keyed by the session's redacted
// hash and the decision's ledger id, in the same owner-only file every decision review uses; an id the report does not
// hold is refused. Every report and reason here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDecisionArgs, resolveDecisionId, runDecisionCommand, DECISION_COMMAND_REFUSALS,
  DECISION_COMMAND_USAGE } from '../src/decision-command.js';
import { acceptableReason, answersFor, loadDecisionReviews, recordDecisionReview } from '../src/decision-reviews.js';

const exec = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
const HASH = 'a'.repeat(64);
const ID = `sha256:${'1234567890ab'}${'c'.repeat(52)}`;
const OTHER = `sha256:${'1234567890ad'}${'d'.repeat(52)}`;

async function home(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah decision command '));
  const saved = process.env.SONAH_HOME;
  process.env.SONAH_HOME = dir;
  t.after(async () => { if (saved === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = saved;
    await rm(dir, { recursive: true, force: true }); });
  const report = join(dir, 'report.private.json');
  await writeFile(report, JSON.stringify({ windowResults: [], decisions: [{ id: ID }, { id: OTHER }, { id: 'sha256:short' }, {}] }));
  return { dir, report };
}
const quiet = () => { const out = [], err = []; return { out, err, io: { write: (s) => out.push(s), error: (s) => err.push(s) } }; };

test('D69 f (g) the command line: a verb, a session hash, a decision id, the report and a reason, nothing else', () => {
  const ok = ['change', HASH, '1234567890ab', '--report', 'r.json', '--reason', ' Use the store. '];
  assert.deepEqual(parseDecisionArgs(ok), { verb: 'change', hash: HASH, id: 'sha256:1234567890ab', report: 'r.json', reason: 'Use the store.' });
  assert.equal(parseDecisionArgs(['accept', HASH, ID, '--reason', 'x', '--report', 'r']).id, ID);
  for (const argv of [[], ok.slice(0, 5), ['approve', ...ok.slice(1)], ['change', 'A'.repeat(64), ...ok.slice(2)],
    ['change', HASH, '12345', ...ok.slice(3)], ['change', HASH, 'zzzzzzzzzzzz', ...ok.slice(3)], [...ok.slice(0, 5), '--reason', '  '],
    [...ok.slice(0, 5), '--report', 'again'], [...ok.slice(0, 5), '--model', 'x']])
    assert.throws(() => parseDecisionArgs(argv), { code: 'usage' }, JSON.stringify(argv));
  // An id resolves only to exactly one ledger decision id of the report.
  const report = { decisions: [{ id: ID }, { id: OTHER }] };
  assert.deepEqual(resolveDecisionId(report, 'sha256:1234567890ab'), { id: ID });
  assert.deepEqual(resolveDecisionId(report, 'sha256:1234567890a'), { refusal: 'decision_ambiguous' });
  assert.deepEqual(resolveDecisionId(report, 'sha256:ffffffffffff'), { refusal: 'decision_not_in_report' });
  assert.deepEqual(resolveDecisionId({}, ID), { refusal: 'decision_not_in_report' });
});

test('D69 f (g) an answer is recorded owner-only, keyed by the session hash and the full ledger id', async (t) => {
  const { dir, report } = await home(t);
  const { out, err, io } = quiet();
  assert.equal(await runDecisionCommand(['clarify', HASH, '1234567890ab', '--report', report, '--reason', 'Why a Map?'], io), 0);
  assert.deepEqual([out, err], [['recorded: clarify 1234567890ab\n'], []]);
  const file = join(dir, 'decision-reviews.ndjsonl');
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  const [row] = (await readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual({ ...row, ts: 'x' }, { v: 2, ts: 'x', hash: HASH, decisionId: ID, verb: 'clarify', reason: 'Why a Map?' });
  // The latest answer stands; another session's hash holds none of this one's.
  assert.equal(await runDecisionCommand(['accept', HASH, ID, '--report', report, '--reason', 'Fine after all.'], quiet().io), 0);
  const reviews = await loadDecisionReviews();
  assert.deepEqual([...answersFor(HASH, reviews)], [[ID, { verb: 'accept', reason: 'Fine after all.' }]]);
  assert.deepEqual([...answersFor('b'.repeat(64), reviews)], []);
  // A legacy (v1) record an older build left beside it is not written now, and is no answer of a session page.
  assert.equal(await recordDecisionReview({ hash: HASH, decisionKey: 'e'.repeat(64), verb: 'accept', reason: 'Old.' }), false);
  await appendFile(file, JSON.stringify({ v: 1, ts: new Date().toISOString(), hash: HASH, decisionKey: 'e'.repeat(64),
    verb: 'accept', reason: 'Old.' }) + '\n');
  assert.equal(answersFor(HASH, await loadDecisionReviews()).size, 1);
});

test('D69 f (g) an id the report does not hold, an unreadable report or a reason too long is refused, never recorded', async (t) => {
  const { dir, report } = await home(t);
  const refused = async (argv, code, exit = 1) => {
    const { out, err, io } = quiet();
    assert.equal(await runDecisionCommand(argv, io), exit, argv.join(' '));
    assert.deepEqual([out, err], [[], [`sonah decision: ${code}\n`]]);
  };
  await refused(['accept', HASH, 'ffffffffffff', '--report', report, '--reason', 'x'], 'decision_not_in_report');
  const twins = join(dir, 'twins.json');
  await writeFile(twins, JSON.stringify({ decisions: [{ id: ID }, { id: `sha256:1234567890ab${'f'.repeat(52)}` }] }));
  await refused(['accept', HASH, '1234567890ab', '--report', twins, '--reason', 'x'], 'decision_ambiguous');
  await refused(['accept', HASH, '1234567890ab', '--report', join(dir, 'missing.json'), '--reason', 'x'], 'report_unreadable');
  await writeFile(join(dir, 'list.json'), '[]');
  await refused(['accept', HASH, '1234567890ab', '--report', join(dir, 'list.json'), '--reason', 'x'], 'report_unreadable');
  await refused(['accept', HASH, '1234567890ab', '--report', report, '--reason', 'x'.repeat(2001)], 'reason_rejected');
  await assert.rejects(stat(join(dir, 'decision-reviews.ndjsonl')), { code: 'ENOENT' }, 'nothing was written');
  // A usage error prints the usage line and exits 2.
  const { err, io } = quiet();
  assert.equal(await runDecisionCommand(['accept'], io), 2);
  assert.deepEqual(err, [`${DECISION_COMMAND_USAGE}\n`]);
  assert.deepEqual([...DECISION_COMMAND_REFUSALS], ['report_unreadable', 'decision_not_in_report', 'decision_ambiguous',
    'reason_rejected', 'not_recorded']);
});

test('D90: a reason holding a key-shaped string is recorded as the person wrote it', async (t) => {
  // D90 (owner decision 2026-10-15): a reason is kept as written; nothing is refused for what a redactor would have
  // masked. A FAKE key, built at run time.
  const { report } = await home(t);
  const reason = `token ${['sk', 'ant', 'api03', 'FAKE'.repeat(10)].join('-')} stays in the deploy script`;
  assert.equal(acceptableReason(reason), true);
  assert.equal(await runDecisionCommand(['accept', HASH, '1234567890ab', '--report', report, '--reason', reason],
    quiet().io), 0);
  assert.deepEqual([...answersFor(HASH, await loadDecisionReviews())], [[ID, { verb: 'accept', reason }]]);
});

test('D69 f (g) through the binary: recorded with exit 0, refused with 1, a usage error with 2', async (t) => {
  const { dir, report } = await home(t);
  const run = async (args) => {
    try { const r = await exec(process.execPath, [BIN, 'decision', ...args], { env: { PATH: '/usr/bin:/bin', HOME: dir, SONAH_HOME: dir } });
      return { code: 0, ...r }; } catch (e) { return { code: e.code, stdout: e.stdout, stderr: e.stderr }; }
  };
  assert.deepEqual(await run(['accept', HASH, '1234567890ab', '--report', report, '--reason', 'Good.']),
    { code: 0, stdout: 'recorded: accept 1234567890ab\n', stderr: '' });
  const refused = await run(['accept', HASH, 'ffffffffffff', '--report', report, '--reason', 'Good.']);
  assert.deepEqual([refused.code, refused.stdout, refused.stderr], [1, '', 'sonah decision: decision_not_in_report\n']);
  assert.equal((await run(['accept', HASH])).code, 2);
});
