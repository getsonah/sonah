// D177: the words of the coverage cause `request_copies_unread` (review.js COVERAGE_SENTENCE). A request copy is a row
// the recorder wrote of what it sent the agent (Claude Code 2.1.303 and later, `api-request-blob`); Sonah counts the
// copies that no structural twin settles (D150) and does not read them. The words say so, and say that your messages
// come from the recorder's other records: "could not match ... copies of messages" read as if your words were missed,
// and "message" is one message of yours (docs/STYLE.md, S4). The second sentence holds because the labeller never gives
// a copy the person's label: an unmatched copy of role user is no human record, no ask and no instruction event, so
// adding one to a recording changes none of them. D177's review: the words give no cause, since a copy of a form the
// reader does not list (an extra key) is counted here too and is never compared with a twin, so "because they differ"
// would be false of it. Synthetic rows only; no recording is read and no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COVERAGE_SENTENCE } from '../src/review.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { sliceLineage } from '../../slicer/index.js';
import { readSession, claudeLabeller, requestBlobRow } from '../../slicer/src/records.js';
import { LABELS } from '../../slicer/src/labels.js';
import { redact } from '../../redact/index.js';
import { SESSION, apiRequestBlob } from '../../slicer/test/d150-recorder-rows-fixture.js';

const PROMPT = 'Fix the parser so an empty line is skipped.';
let seq = 0;
const envelope = (extra) => ({ cwd: '/repo', entrypoint: 'cli', gitBranch: 'main', isSidechain: false,
  parentUuid: seq ? `d177-${seq}` : null, sessionId: SESSION, timestamp: '2026-10-28T20:00:00.000Z',
  userType: 'external', uuid: `d177-${++seq}`, version: '2.1.308', ...extra });
/** The recorded rows, the same bytes on each call (their uuids from 1). */
const recorded = () => (seq = 0, [
  envelope({ type: 'user', origin: { kind: 'human' }, promptSource: 'typed', message: { role: 'user', content: PROMPT } }),
  envelope({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } }),
]);
/** Copies of role user that no structural twin settles: new words, the person's words beside a block no row holds, the
 *  person's words in a block of another form, a result of a call no row records, words in a list and in a string. */
const UNMATCHED = [
  apiRequestBlob({ role: 'user', content: 'SYNTHETIC_D177 words found in no row.' }),
  apiRequestBlob({ role: 'user', content: [{ type: 'text', text: 'SYNTHETIC_D177 block words found in no row.' }] }),
  apiRequestBlob({ role: 'user', content: [{ type: 'text', text: PROMPT },
    { type: 'text', text: 'SYNTHETIC_D177 words beside the prompt.' }] }),
  apiRequestBlob({ role: 'user', content: [{ type: 'text', text: PROMPT, cache_control: { type: 'ephemeral' } }] }),
  apiRequestBlob({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_d177', content: 'ok' }] }),
];

async function sliced(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'evidence-d177-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${SESSION}.jsonl`);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const ledger = redact(await sliceLineage([file], { cwd: '/repo' })).ledger;
  return { ledger, read: await readSession(file), session: sessionFromLedger(ledger, { sessionKey: 's' }) };
}
const instructions = (session) => session.events.filter((e) => e.kind === 'instruction')
  .map((e) => [e.authority, session.textSpansOf(e, 'text').join('')]);

test('D177: the copies Sonah did not read are said as what the recorder sent the agent, never as your messages', () => {
  assert.equal(COVERAGE_SENTENCE.request_copies_unread({ n: 1 }), 'Sonah did not read 1 copy of what the recorder sent '
    + "the agent. Sonah reads your messages from the recorder's other records");
  assert.equal(COVERAGE_SENTENCE.request_copies_unread({ n: 33 }), 'Sonah did not read 33 copies of what the recorder '
    + "sent the agent. Sonah reads your messages from the recorder's other records");
  for (const counts of [{ n: 1 }, { n: 2 }, { n: 3, atLeast: true }, {}]) {
    const text = COVERAGE_SENTENCE.request_copies_unread(counts);
    assert.equal(/could not match|messages sent to the agent/.test(text), false, text);
  }
});

test('D177: an unmatched copy of role user is never the person\'s: no human record, no ask, no instruction event',
  async (t) => {
    const without = await sliced(t, recorded());
    assert.deepEqual(without.ledger.ask.map((a) => a.text), [PROMPT]);
    assert.deepEqual(instructions(without.session), [['human', PROMPT]]);
    for (const blob of UNMATCHED) {
      assert.ok(requestBlobRow(blob), JSON.stringify(blob.message).slice(0, 80));
      const rows = [...recorded(), blob];
      // The labeller gives it no label (unread), never the person's.
      const labeller = claudeLabeller();
      const values = rows.map((row) => labeller.label(row));
      labeller.finish();
      assert.notEqual(values.at(-1).label, LABELS.human, JSON.stringify(blob.message).slice(0, 80));
      assert.equal(values.at(-1).label, null, JSON.stringify(blob.message).slice(0, 80));
      const { ledger, read, session } = await sliced(t, rows);
      // No record of it, and the person's rows are counted as before.
      assert.ok(read.records.every((rec) => rec.raw?.type !== 'api-request-blob'));
      assert.equal(ledger.capture.labels.human, without.ledger.capture.labels.human);
      // Your asks and the instruction events are the recording's own, as without it; the copy is counted once.
      assert.deepEqual(ledger.ask, without.ledger.ask);
      assert.deepEqual(instructions(session), instructions(without.session));
      assert.equal(ledger.unreadRows?.request_copy, 1);
      assert.equal(JSON.stringify(ledger).includes('SYNTHETIC_D177'), false);
    }
  });

test('D177 (its review): a copy of a form the reader does not list is counted as a copy, never compared and never the '
  + 'person\'s, so the words give no cause', async (t) => {
  const without = await sliced(t, recorded());
  // The person's own prompt, byte for byte, in a copy with one key more than the listed form: it differs from no record,
  // yet no twin is looked for (records.js reads it by its structure and leaves it unread).
  const blob = { ...apiRequestBlob({ role: 'user', content: PROMPT }), extraKey: 'SYNTHETIC_D177' };
  assert.equal(requestBlobRow(blob), false);
  const rows = [...recorded(), blob];
  const labeller = claudeLabeller();
  const values = rows.map((row) => labeller.label(row));
  labeller.finish();
  assert.notEqual(values.at(-1).label, LABELS.human);
  const { ledger, session } = await sliced(t, rows);
  assert.equal(ledger.unreadRows?.request_copy, 1, 'counted as a copy');
  assert.equal(ledger.capture.labels.human, without.ledger.capture.labels.human);
  assert.deepEqual(ledger.ask, without.ledger.ask);
  assert.deepEqual(instructions(session), instructions(without.session));
  // So the sentence for its count says what Sonah did and where it reads your messages, and claims no cause.
  assert.equal(COVERAGE_SENTENCE.request_copies_unread({ n: ledger.unreadRows.request_copy }), 'Sonah did not read 1 '
    + "copy of what the recorder sent the agent. Sonah reads your messages from the recorder's other records");
});
