// M33 T (helper briefs), the adapter. A Codex hand-off whose brief the recorder encrypted is declared as that
// fact — its own capture loss, never a redaction — and still caps session coverage at least as much as a brief
// redaction withheld. The hand-off's verified task name rides on the delegate event as a plain field, never a
// source a receipt can quote, so no review request byte changes.
//
// Synthetic ledgers and synthetic Codex rollouts only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionFromLedger, DELEGATION_BRIEF_GAP_NOTES } from '../adapters/sonah-ledger.js';
import { buildLedger } from '../src/ledger.js';
import { coverageCauses, COVERAGE_CAUSES, COVERAGE_SENTENCE } from '../src/review.js';
import { runReview, planWindowRequests } from '../src/run-review.js';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { captureCase, windowNarrative } from '../../cli/test/m33-fast-profile-fixture.js';
import { TOKENS, TEXT, rootRows, jsonl, withoutHelperFields } from './m33-t-helper-brief-fixture.js';

const repo = { host: 'local', id: 'synthetic' };
const ENCRYPTED = Object.freeze({ tool: 'spawn_agent', field: 'message', encrypted: true });
const PLAIN = Object.freeze({ tool: 'spawn_agent', field: 'message', text: TEXT.fixBrief });
// What the base code carried for an encrypted token: redaction's token marker, flagged as a redaction.
const REDACTED = Object.freeze({ tool: 'spawn_agent', field: 'message', text: '‹dropped:high-entropy›', redacted: true });

/** A one-ask session with one Codex spawn carrying `parentInstruction`. A failed spawn declares no child gap,
 *  so whatever the brief declares is the only loss. */
const ABSENT = Symbol('no task name');
function handOff(parentInstruction, { status = 'failed', taskName = '/root/fix_parser', extra = {} } = {}) {
  const session = sessionFromLedger({
    ask: [{ turn: 1, text: 'Split the synthetic parser work.' }],
    delegations: [{ adapter: 'codex', kind: 'spawn', callId: 'spawn_fix', turn: 1, source: 0, status,
      reason: status === 'failed' ? 'delegation_spawn_failed' : 'delegation_child_unchecked',
      ...(taskName !== ABSENT ? { taskName } : {}), parentInstruction: structuredClone(parentInstruction), ...extra }],
  }, { sessionKey: 'm33-t' });
  return { session, report: buildLedger({ repo, session, pr: null, sessionCoverage: 'complete' }),
    event: session.delegations()[0] };
}
const briefGaps = (session) => session.adapterGaps.filter((gap) => gap.channel === 'actions');

test('M33 T an encrypted brief is its own declared loss, distinct from a redaction', () => {
  const { session, event } = handOff(ENCRYPTED);
  assert.deepEqual(event.input, [], 'no brief text exists to show');
  assert.equal(event.briefEncrypted, true);
  const gaps = briefGaps(session);
  assert.equal(gaps.length, 1);
  assert.deepEqual({ code: gaps[0].code, scope: gaps[0].scope, count: gaps[0].count, eventIds: gaps[0].eventIds,
    note: gaps[0].note }, { code: 'incomplete_inventory', scope: 'session', count: 1, eventIds: [event.id],
    note: DELEGATION_BRIEF_GAP_NOTES.recorder_encrypted });
  assert.equal(session.adapterGaps.some((gap) => gap.note === DELEGATION_BRIEF_GAP_NOTES.redaction_withheld), false,
    'an encrypted brief never trips the redaction gap');
  assert.equal(JSON.stringify(session).includes('‹dropped'), false);
});

test('M33 T the redaction gap for a brief is unchanged, word for word', () => {
  assert.equal(DELEGATION_BRIEF_GAP_NOTES.redaction_withheld, 'a delegation brief was partly withheld by redaction');
  const { session, event } = handOff(REDACTED);
  assert.equal(event.briefEncrypted, undefined);
  assert.deepEqual(briefGaps(session).map((gap) => [gap.code, gap.count, gap.note]),
    [['incomplete_inventory', 1, DELEGATION_BRIEF_GAP_NOTES.redaction_withheld]]);
});

test('M33 T an encrypted brief caps session coverage at least as much as a redacted one', () => {
  const plain = handOff(PLAIN).report;
  assert.equal(plain.coverage, 'complete', 'the fixture has no other loss');
  assert.deepEqual(plain.gaps, []);
  const redacted = handOff(REDACTED).report;
  const encrypted = handOff(ENCRYPTED).report;
  assert.equal(redacted.coverage, 'partial');
  assert.equal(encrypted.coverage, 'partial');
  assert.equal(encrypted.sessionStatus, redacted.sessionStatus);
  assert.deepEqual(encrypted.gaps.map((gap) => [gap.code, gap.channel, gap.scope]),
    redacted.gaps.map((gap) => [gap.code, gap.channel, gap.scope]));
});

test('M33 T the review names an encrypted brief in plain words, and never as a redaction', () => {
  assert.ok(COVERAGE_CAUSES.includes('briefs_encrypted'));
  const { report } = handOff(ENCRYPTED);
  assert.deepEqual(coverageCauses(report), [['briefs_encrypted', { n: 1 }]]);
  assert.equal(COVERAGE_SENTENCE.briefs_encrypted({ n: 1 }),
    'the recorder encrypted 1 brief that the agent gave a helper, so Sonah cannot show or check it');
  assert.equal(COVERAGE_SENTENCE.briefs_encrypted({ n: 3 }),
    'the recorder encrypted 3 briefs that the agent gave a helper, so Sonah cannot show or check them');
  // A redacted brief is never named as encrypted. D119: it is a hand-off whose recorded input Sonah holds only in
  // part, counted by its call (no longer summed into `incomplete_inventory` with other kinds).
  assert.deepEqual(coverageCauses(handOff(REDACTED).report), [['call_inputs_unread', { n: 1 }]]);
});

test('M33 T the verified task name rides on the delegate event as a plain field, never as quotable source', () => {
  for (const instruction of [ENCRYPTED, PLAIN]) {
    const { session, event } = handOff(instruction);
    assert.equal(event.taskName, '/root/fix_parser');
    assert.equal(session.sourcesFor(event).some((source) => /fix.parser/.test(source.text)), false);
    assert.equal(Object.values(session.blobs).some((text) => /fix.parser/.test(text)), false);
  }
  // Only a task name that passes the identity checks and survived redaction is carried.
  for (const [taskName, extra] of [['/root/Fix-Parser', {}], ['fix_parser', {}], ['/root', {}], [null, {}],
    [null, { identityUncheckedFields: ['taskName'] }], [ABSENT, {}], [42, {}],
    ['/root/fix_parser', { identityUncheckedFields: ['taskName'] }]]) {
    const { event } = handOff(ENCRYPTED, { taskName, extra });
    assert.equal(Object.hasOwn(event, 'taskName'), false, String(taskName));
  }
  const nested = handOff(ENCRYPTED, { taskName: '/root/fix_parser/write_tests' }).event;
  assert.equal(nested.taskName, '/root/fix_parser/write_tests');
});

// ---- the full path: a synthetic Codex rollout, sliced, redacted and adapted --------------------------------

async function codexSession(t, options) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-t-adapter-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-10-01T12-00-00-synthetic.jsonl');
  await writeFile(file, jsonl(rootRows(options)));
  return sessionFromLedger(redact(await sliceLineage([file])).ledger, { sessionKey: 'm33-t-root' });
}

test('M33 T a synthetic Codex session: encrypted spawn and follow-up, plaintext spawn', async (t) => {
  const session = await codexSession(t);
  const [fix, notes, follow] = session.delegations();
  assert.deepEqual([fix.tool, notes.tool, follow.tool], ['spawn_agent', 'spawn_agent', 'followup_task']);
  assert.deepEqual([fix.briefEncrypted, notes.briefEncrypted, follow.briefEncrypted], [true, undefined, true]);
  assert.deepEqual([fix.taskName, notes.taskName, follow.taskName], ['/root/fix_parser', '/root/write_changelog', undefined]);
  assert.deepEqual(fix.input, []);
  assert.deepEqual(session.textSpansOf(notes, 'input'), [TEXT.notesBrief]);
  const encryptedGap = session.adapterGaps.filter((gap) => gap.note === DELEGATION_BRIEF_GAP_NOTES.recorder_encrypted);
  assert.deepEqual(encryptedGap.map((gap) => [gap.code, gap.channel, gap.count, gap.eventIds]),
    [['incomplete_inventory', 'actions', 2, [fix.id, follow.id]]]);
  assert.equal(session.adapterGaps.some((gap) => gap.note === DELEGATION_BRIEF_GAP_NOTES.redaction_withheld), false);
  const all = JSON.stringify({ events: session.events, blobs: session.blobs, gaps: session.adapterGaps });
  for (const token of Object.values(TOKENS)) assert.equal(all.includes(token.slice(0, 32)), false);
  assert.equal(all.includes('‹dropped'), false);
});

test('M33 T narrative and challenge request bytes do not change with the task name or the encrypted flag', async (t) => {
  const session = await codexSession(t);
  const before = withoutHelperFields(session);
  assert.equal(before.delegations().some((event) => 'taskName' in event || 'briefEncrypted' in event), false);
  const narrativeOf = (s, request) => windowNarrative(s, request.window);
  const after = await captureCase({ runReview, planWindowRequests }, { name: 'codex-helpers', session, narrativeOf });
  const base = await captureCase({ runReview, planWindowRequests }, { name: 'codex-helpers', session: before, narrativeOf });
  assert.deepEqual(after, base);
  assert.ok(after.sentCount > after.windows, 'challenge requests were sent as well as narrative ones');
  // Nor does any request carry the task name or a token.
  const seen = [];
  await runReview({ session, pr: null, reviewScope: 'session-only', concurrency: 1,
    judge: async (request) => { seen.push(request); return request.challenge ? { votes: [] } : narrativeOf(session, request); } });
  for (const request of seen) {
    assert.equal(/fix.parser|write.changelog/.test(`${request.system}\n${request.prompt}`), false, request.label);
    for (const token of Object.values(TOKENS)) assert.equal(request.prompt.includes(token.slice(0, 32)), false);
  }
});

test('M33 T the review report states the encrypted briefs in plain words', async (t) => {
  const session = await codexSession(t);
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', concurrency: 1,
    judge: async (request) => (request.challenge ? { votes: [] } : windowNarrative(session, request.window)) });
  assert.ok(coverageCauses(report).some(([cause, counts]) => cause === 'briefs_encrypted' && counts.n === 2));
  const said = coverageCauses(report).map(([cause, counts]) => COVERAGE_SENTENCE[cause](counts)).join('; ');
  assert.match(said, /the recorder encrypted 2 briefs that the agent gave a helper, so Sonah cannot show or check them/);
  assert.ok([...(report.gaps ?? []), ...(report.session?.adapterGaps ?? [])].some((gap) =>
    gap?.note === DELEGATION_BRIEF_GAP_NOTES.recorder_encrypted), 'the brief\'s gap carries its own note');
  assert.doesNotMatch(said, /withheld by redaction/);
});
