// D153: the after-point re-check's request (prompt.js `recheckRequest`): window k's kept request with only its "Now
// answer" replaced by fixed words and the ask rows an earlier window found not met. The bytes are pinned, so a stored
// answer replays (D60). Synthetic sessions only: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { NOW_ANSWER, NOW_ANSWER_AGAIN, RECHECK_HEADING, RECHECK_WORDS, RECHECK_ROWS, RECHECK_NOW_ANSWER,
  recheckRequest } from '../src/prompt.js';
import { aliasTable } from '../src/windows.js';
import * as reviewRun from '../src/run-review.js';
import { recheckSession, receipt } from './d153-recheck-fixture.js';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const partly = () => ({ text: 'add a test for the guest greeting',
  instruction: receipt('I1', 'instruction', 'and add a test for it'), status: 'partly-done',
  deliverable: receipt('ED1', 'code', 'return name || "guest"'),
  shortfall: receipt('C1', 'commentary', 'I did not add a test yet.') });
const notDone = () => ({ text: 'update the changelog', instruction: receipt('I2', 'instruction', 'update the changelog'),
  status: 'not-done', shortfall: receipt('C2', 'commentary', 'The changelog is not updated.') });
const small = (tail = NOW_ANSWER) => ({ system: 'SYSTEM', prompt: `# Checklist for window 2\n\nTHE WINDOW\n${tail.join('\n')}`,
  schema: { type: 'object' }, label: 'narrative:w2' });
const named = (...ids) => { const table = aliasTable(); for (const id of ids) table.of(id); return table.freeze(); };

test('D153: the re-check of one window, byte for byte (golden)', () => {
  const out = recheckRequest({ request: small(), rows: [partly(), notDone()], aliases: named('I2', 'I1'),
    label: 'narrative:w2:recheck' });
  const expected = ['# Checklist for window 2', '', 'THE WINDOW', '', RECHECK_HEADING, '', ...RECHECK_WORDS, '',
    RECHECK_ROWS,
    '{"text":"add a test for the guest greeting","instruction":{"eventId":"E2","role":"instruction","quote":"and add a test for it"},"status":"partly-done","deliverable":{"role":"code","quote":"return name || \\"guest\\""},"shortfall":{"role":"commentary","quote":"I did not add a test yet."}}',
    '{"text":"update the changelog","instruction":{"eventId":"E1","role":"instruction","quote":"update the changelog"},"status":"not-done","shortfall":{"role":"commentary","quote":"The changelog is not updated."}}',
    '', ...RECHECK_NOW_ANSWER].join('\n');
  assert.equal(out.prompt, expected);
  assert.deepEqual({ ...out, prompt: null }, { ...small(), prompt: null, label: 'narrative:w2:recheck' },
    'the system, the schema and every other member are the window\'s own');
  // The fixed words, pinned: a change to any of them moves this digest, and no stored answer replays. (Moved once: the
  // words now let a row found not-done be given partly-done.)
  assert.equal(sha(out.prompt), 'b366960fbefa51364baa9750365d015ee5990cd1e5164a118f7607eabbfc0089');
});

test('D153: on a planned review, the re-check is the window\'s own request with only its "Now answer" replaced', () => {
  const session = recheckSession();
  const plan = reviewRun.planWindowRequests({ session, reviewScope: 'session-only' });
  const { request, aliases } = plan.requests[1];
  const out = recheckRequest({ request, rows: [partly()], aliases, label: 'narrative:w2:recheck' });
  const tail = `\n${NOW_ANSWER.join('\n')}`;
  assert.ok(request.prompt.endsWith(tail));
  const head = request.prompt.slice(0, request.prompt.length - tail.length);
  assert.ok(out.prompt.startsWith(`${head}\n\n${RECHECK_HEADING}\n\n${RECHECK_WORDS.join('\n')}\n\n${RECHECK_ROWS}\n`));
  assert.ok(out.prompt.endsWith(`\n\n${RECHECK_NOW_ANSWER.join('\n')}`));
  assert.ok(!out.prompt.includes(NOW_ANSWER[1]), 'the window\'s "Now answer" is gone');
  for (const key of ['system', 'schema', 'window', 'evidencePrompt']) assert.equal(out[key], request[key], key);
  assert.equal(out.label, 'narrative:w2:recheck');
  // The instruction is named as the window's request names it; the earlier receipts by role and quote alone, though the
  // window names the earlier message (C1, carried) and the window's own aliases go on naming nothing new.
  const added = out.prompt.slice(head.length);
  const [row] = added.split('\n').filter((line) => line.startsWith('{'));
  assert.equal(JSON.parse(row).instruction.eventId, aliases.of('I1'));
  assert.ok(request.prompt.includes(`[${aliases.of('I1')}] HUMAN INSTRUCTION`));
  assert.ok(aliases.has('C1') && !added.includes(`"${aliases.of('C1')}"`) && !added.includes('"C1"'));
  assert.ok(!added.includes('"ED1"') && !Object.hasOwn(JSON.parse(row).shortfall, 'eventId'));
  assert.equal(recheckRequest({ request, rows: [partly()], aliases, label: 'narrative:w2:recheck' }).prompt, out.prompt,
    'deterministic');
});

test('D153: a window\'s request after served lines ends with the other "Now answer", which is replaced the same way', () => {
  const out = recheckRequest({ request: small(NOW_ANSWER_AGAIN), rows: [partly()], aliases: named('I1'), label: 'x' });
  assert.ok(out.prompt.startsWith(`# Checklist for window 2\n\nTHE WINDOW\n\n${RECHECK_HEADING}\n`));
  assert.ok(!out.prompt.includes(NOW_ANSWER_AGAIN[1]));
});

test('D153: the rows are shown in the order given, and only rows it can show make a request', () => {
  const aliases = named('I1', 'I2');
  const one = recheckRequest({ request: small(), rows: [partly(), notDone()], aliases, label: 'x' }).prompt;
  const other = recheckRequest({ request: small(), rows: [notDone(), partly()], aliases, label: 'x' }).prompt;
  assert.notEqual(one, other, 'the order is the caller\'s (the merged order), and it is kept');
  const none = (rows, request = small(), table = aliases) => recheckRequest({ request, rows, aliases: table, label: 'x' });
  assert.equal(none([]), null, 'no row');
  assert.equal(none(null), null, 'no list');
  assert.equal(none([partly()], { ...small(), prompt: 'no closing' }), null, 'no session-only "Now answer"');
  assert.equal(none([partly()], { system: 'S' }), null, 'no prompt');
  assert.equal(none([{ ...partly(), status: 'done' }]), null, 'a done row is not re-checked');
  assert.equal(none([{ ...partly(), status: 'not-checked' }]), null, 'nor a not-checked one');
  assert.equal(none([{ ...partly(), shortfall: undefined }]), null, 'an accusing row has a shortfall');
  assert.equal(none([{ ...partly(), instruction: { quote: 'x' } }]), null, 'and an instruction receipt');
  assert.equal(none([partly()], small(), named('I2')), null, 'an instruction the window does not name');
  assert.equal(none([partly(), null]), null, 'a row that is not one');
  // Without an alias table (a request that names events by their stable ids), the instruction keeps its id.
  const stable = recheckRequest({ request: small(), rows: [partly()], aliases: null, label: 'x' }).prompt;
  assert.ok(stable.includes('"instruction":{"eventId":"I1"'));
});
