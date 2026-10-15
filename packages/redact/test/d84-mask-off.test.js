// D84 (owner decision 2026-10-12, "off for the model, on for output"): `redact(…, { mask: false })` bounds and
// validates and masks nothing (what the model reads); `maskForPeople` is the one output function. Synthetic texts and
// FAKE key-shaped strings only, built at run time so no source line is itself key-shaped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, sliceHash, maskForPeople, scrubDiffWhole, scrubHunks, ATTACHED_CAP, ASK_OMISSION }
  from '../index.js';
import { compressAsk } from '../../slicer/src/ask.js';

const FAKE_KEY = ['sk', 'ant', 'api03', 'FAKEonlyForTests0123456789abcdefXYZ0123456789fake'].join('-');
const FAKE_AWS = ['AKIA', 'FAKE', 'TEST', 'ONLY', '0000'].join('');
const BOUNDARY = (end) => `-----${end} ${['RSA', 'PRIVATE', 'KEY'].join(' ')}-----`;
const PEM = [BOUNDARY('BEGIN'), 'MIIEowIBAAKCAQEAfakeFAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKEfakeFAKE01', BOUNDARY('END')]
  .join('\n');
const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const planted = () => led({
  ask: [{ turn: 0, text: `Deploy with ${FAKE_KEY} and mail ops@example.com` }],
  ledger: [{ turn: 0, seq: 0, kind: 'bash', cmd: `export ANTHROPIC_API_KEY=${FAKE_KEY} && aws s3 ls # ${FAKE_AWS}`,
    tailLines: ['ok', `token: ${FAKE_KEY}`, ...PEM.split('\n')] },
  { turn: 0, seq: 1, kind: 'edit', path: 'src/settings.js', argsExcerpt: `const key = "${FAKE_KEY}";`,
    diff: `+const key = "${FAKE_KEY}";` }],
  claim: { finalMessage: `Deployed with ${FAKE_KEY}.` },
  sayings: [{ turn: 0, text: `I exported ${FAKE_KEY}.` }],
  delegations: [{ adapter: 'claude', turn: 0, callId: 'call-1', childId: 'agent-1',
    parentInstruction: { text: `Use ${FAKE_KEY}` }, finalAnswer: { text: `Used ${FAKE_KEY}` } }],
});

test('D84: masking off keeps every recorded text as recorded and declares nothing', () => {
  const masked = redact(planted());
  const open = redact(planted(), { mask: false });
  assert.ok(!JSON.stringify(masked.ledger).includes(FAKE_KEY), 'the default still masks');
  assert.ok(masked.dropped.length > 0);
  assert.deepEqual(open.dropped, [], 'nothing is declared for a secret');
  const input = planted();
  assert.equal(open.ledger.ask[0].text, input.ask[0].text);
  assert.equal(open.ledger.ask[0].redacted, undefined);
  assert.equal(open.ledger.ledger[0].cmd, input.ledger[0].cmd);
  assert.deepEqual(open.ledger.ledger[0].tailLines, input.ledger[0].tailLines);
  assert.equal(open.ledger.ledger[1].argsExcerpt, input.ledger[1].argsExcerpt);
  assert.equal(open.ledger.ledger[1].diff, input.ledger[1].diff);
  assert.equal(open.ledger.claim.finalMessage, input.claim.finalMessage);
  assert.equal(open.ledger.sayings[0].text, input.sayings[0].text);
  assert.equal(open.ledger.delegations[0].parentInstruction.text, `Use ${FAKE_KEY}`);
  assert.equal(open.ledger.delegations[0].finalAnswer.text, `Used ${FAKE_KEY}`);
  assert.equal(open.ledger.ledger.some((e) => e.redacted === true), false);
  // Deterministic, and a second pass changes nothing.
  assert.deepEqual(redact(open.ledger, { mask: false }).ledger, open.ledger);
  assert.equal(sliceHash(redact(planted(), { mask: false }).ledger), sliceHash(open.ledger));
  assert.notEqual(sliceHash(open.ledger), sliceHash(masked.ledger), 'the hash is over the ledger it is given');
});

test('D84: masking off keeps every bound and every shape check', () => {
  // An attached file keeps its declared head and tail, exactly as with masking.
  const words = (n) => Array.from({ length: n }, (_, i) => `word${String(i).padStart(5, '0')}`).join(' ');
  const due = compressAsk(`${FAKE_KEY} ${words(4_000)}`, ATTACHED_CAP);
  const attached = (mask) => redact(led({ interjections: [{ kind: 'attached', turn: 0, text: due.text,
    elided: due.elided, beforeEvent: 0, source: 0, record: 1 }] }), { mask }).ledger.interjections[0];
  const open = attached(false), masked = attached(true);
  for (const kept of [open, masked]) {
    const [head, tail] = kept.text.split(`\n${ASK_OMISSION}\n`);
    assert.ok(head && tail, 'bounded: a head and a tail around the declared cut');
    assert.ok([...head].length <= ATTACHED_CAP.head && [...tail].length <= ATTACHED_CAP.tail);
    assert.equal(kept.elided.length, 1);
    assert.equal(kept.elided[0].what, 'middle of turn');
  }
  assert.ok(open.text.startsWith(`${FAKE_KEY} `), 'the head as recorded');
  assert.ok(masked.text.startsWith('‹redacted:anthropic-key› '));
  assert.equal(open.text.split(`\n${ASK_OMISSION}\n`)[1], masked.text.split(`\n${ASK_OMISSION}\n`)[1], 'one tail');
  // A task identity that is no identifier shape is still withheld; one that is, is kept.
  const ids = redact(led({ ledger: [{ turn: 0, seq: 0, kind: 'other', workflowTaskId: 'not an id!',
    taskOutputTaskId: 'task_1' }] }), { mask: false }).ledger.ledger[0];
  assert.equal(ids.workflowTaskId, undefined);
  assert.equal(ids.taskOutputTaskId, 'task_1');
  // The recorded facts keep their closed vocabulary: a member outside it is withheld either way.
  const facts = redact(led({ ledger: [{ turn: 0, seq: 0, kind: 'edit', path: 'a.js',
    recorded: { tool: 'Edit', commandClass: 'nonsense', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
      lines: ['-a', `+k = "${FAKE_KEY}"`] }] } }] }), { mask: false }).ledger.ledger[0].recorded;
  assert.equal(facts.commandClass, undefined);
  assert.equal(facts.withheld, true);
  assert.deepEqual(facts.hunks[0].lines, ['-a', `+k = "${FAKE_KEY}"`]);
  assert.equal(facts.hunkScrub, undefined, 'nothing was scrubbed, so no scrub is declared');
  // A recording's file names are never carried, masked or not.
  assert.deepEqual(redact(led({ lineage: { files: ['/x/a.jsonl'] } }), { mask: false }).ledger.lineage.files,
    ['recording-1']);
});

test('D84: the slicer helpers take the same option', () => {
  const lines = [`+KEY=${FAKE_KEY}`, ...PEM.split('\n').map((line) => `+${line}`)];
  const open = scrubDiffWhole(lines, { mask: false });
  assert.deepEqual(open, { lines, drops: lines.map(() => null), groups: [] });
  assert.ok(scrubDiffWhole(lines).lines.every((line) => line === null || !line.includes(FAKE_KEY)));
  const hunks = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', `+k=${FAKE_KEY}`] }];
  assert.deepEqual(scrubHunks(hunks, null, { mask: false }),
    { hunks: [{ ...hunks[0], lines: [...hunks[0].lines] }], scrub: null, reasons: [], lost: false });
  assert.equal(scrubHunks([{ lines: 'no' }], null, { mask: false }), null, 'the shape check stands');
  assert.ok(!JSON.stringify(scrubHunks(hunks)).includes(FAKE_KEY));
});

test('D84: maskForPeople masks a text for a person, is stable, and fails closed', () => {
  const text = `Deployed with ${FAKE_KEY}.\nAWS ${FAKE_AWS}\nmail ops@example.com\n${PEM}\nDone.`;
  const once = maskForPeople(text);
  for (const secret of [FAKE_KEY, FAKE_AWS, 'ops@example.com', 'MIIEowIBAAKCAQEA'])
    assert.ok(!once.includes(secret), `masked: ${secret.slice(0, 4)}`);
  assert.ok(once.startsWith('Deployed with ‹redacted:anthropic-key›.'));
  assert.ok(once.endsWith('\nDone.'), 'the lines around a mask are kept');
  assert.equal(maskForPeople(once), once, 'a second pass changes nothing');
  assert.equal(maskForPeople(text), once, 'the same text, the same answer');
  assert.equal(maskForPeople(''), '');
  assert.equal(maskForPeople('Plain words, a path src/a.js and a count of 12.'),
    'Plain words, a path src/a.js and a count of 12.');
  for (const value of [null, undefined, 3, {}, ['x']]) assert.throws(() => maskForPeople(value), TypeError);
});
