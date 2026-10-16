// D90 (owner decision 2026-10-15, privacy is not a design constraint): what packages/redact keeps — the ledger's bound,
// its validation and its hash. `redact(ledger)` masks nothing and declares nothing for what a text says: it is what
// `redact(…, { mask: false })` returned before D90 (D84: the session the model reads), so a recording's slice_hash is
// the same (pinned below). The secret detectors and the output layer are deleted. Synthetic texts and FAKE key-shaped
// strings only, built at run time so no source line is itself key-shaped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as redactModule from '../index.js';
import { redact, sliceHash, validHunks, entropy, ENTROPY_MIN, ATTACHED_CAP, ASK_OMISSION } from '../index.js';
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

test('D90: redact keeps every recorded text as recorded, declares nothing for it, and hashes as before', () => {
  const input = planted();
  const { ledger, dropped } = redact(planted());
  assert.deepEqual(dropped, [], 'nothing is declared for a secret');
  assert.equal(ledger.ask[0].text, input.ask[0].text);
  assert.equal(ledger.ask[0].redacted, undefined);
  assert.equal(ledger.ledger[0].cmd, input.ledger[0].cmd);
  assert.deepEqual(ledger.ledger[0].tailLines, input.ledger[0].tailLines);
  assert.equal(ledger.ledger[1].argsExcerpt, input.ledger[1].argsExcerpt);
  assert.equal(ledger.ledger[1].diff, input.ledger[1].diff);
  assert.equal(ledger.claim.finalMessage, input.claim.finalMessage);
  assert.equal(ledger.sayings[0].text, input.sayings[0].text);
  assert.equal(ledger.delegations[0].parentInstruction.text, `Use ${FAKE_KEY}`);
  assert.equal(ledger.delegations[0].finalAnswer.text, `Used ${FAKE_KEY}`);
  assert.equal(ledger.ledger.some((e) => e.redacted === true), false);
  // Deterministic, and a second pass changes nothing.
  assert.deepEqual(redact(ledger).ledger, ledger);
  assert.equal(sliceHash(redact(planted()).ledger), sliceHash(ledger));
  // The hash D84's unmasked load (`redact(…, { mask: false })`) gave this very ledger: deleting the detectors moves it
  // not at all.
  assert.equal(sliceHash(ledger), '6356f25c901255eb4c9454a816f6038629cec61ce932c3268da7fe93c521494a');
});

test('D90: what the module exports is the bound, the validation, the hash and the helpers other packages read', () => {
  assert.deepEqual(Object.keys(redactModule).sort(), ['ASK_MIDDLE', 'ASK_OMISSION', 'ASK_STRIP_KINDS', 'ATTACHED_CAP',
    'ENTROPY_MIN', 'FINAL_ANSWER_OMISSION', 'READ_LINE_NUMBER', 'RECORDED_FACTS', 'STATEMENT_OMISSION', 'entropy',
    'harvestMentions', 'isNumberedRead', 'readText', 'redact', 'sliceHash', 'validHunks']);
});

test('D90: every bound and every shape check stands', () => {
  // An attached file keeps its declared head and tail, around the declared cut; its head as recorded. The bound is the
  // windowing spec's 2k tokens at 3.6 bytes each (7,200 code points), its head and tail half each: frozen literals.
  assert.deepEqual({ ...ATTACHED_CAP }, { chars: 7_200, head: 3_600, tail: 3_600 });
  assert.ok(Object.isFrozen(ATTACHED_CAP));
  const words = (n) => Array.from({ length: n }, (_, i) => `word${String(i).padStart(5, '0')}`).join(' ');
  const due = compressAsk(`${FAKE_KEY} ${words(4_000)}`, ATTACHED_CAP);
  const kept = redact(led({ interjections: [{ kind: 'attached', turn: 0, text: due.text, elided: due.elided,
    beforeEvent: 0, source: 0, record: 1 }] })).ledger.interjections[0];
  const [head, tail] = kept.text.split(`\n${ASK_OMISSION}\n`);
  assert.ok(head && tail, 'bounded: a head and a tail around the declared cut');
  assert.ok([...head].length <= 3_600 && [...tail].length <= 3_600);
  assert.ok([...head].length > 3_600 - 16 && [...tail].length > 3_600 - 16, 'cut at the word boundary nearest the bound');
  assert.equal(kept.elided.length, 1);
  assert.equal(kept.elided[0].what, 'middle of turn');
  assert.ok(head.startsWith(`${FAKE_KEY} `), 'the head as recorded');
  // A task identity that is no identifier shape is withheld; one that is, is kept.
  const ids = redact(led({ ledger: [{ turn: 0, seq: 0, kind: 'other', workflowTaskId: 'not an id!',
    taskOutputTaskId: 'task_1' }] })).ledger.ledger[0];
  assert.equal(ids.workflowTaskId, undefined);
  assert.equal(ids.taskOutputTaskId, 'task_1');
  assert.equal(ids.taskIdentityRedacted, true);
  // The recorded facts keep their closed vocabulary: a member outside it is withheld; hunks are kept as recorded.
  const facts = redact(led({ ledger: [{ turn: 0, seq: 0, kind: 'edit', path: 'a.js',
    recorded: { tool: 'Edit', commandClass: 'nonsense', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
      lines: ['-a', `+k = "${FAKE_KEY}"`] }] } }] })).ledger.ledger[0].recorded;
  assert.equal(facts.commandClass, undefined);
  assert.equal(facts.withheld, true);
  assert.deepEqual(facts.hunks[0].lines, ['-a', `+k = "${FAKE_KEY}"`]);
  assert.equal(facts.hunkScrub, undefined, 'nothing was scrubbed, so no scrub is declared');
  // A recorder's hunks: a copy of each when every one has the recorder's shape, null otherwise.
  const hunks = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', `+k=${FAKE_KEY}`] }];
  const copy = validHunks(hunks);
  assert.deepEqual(copy, hunks);
  assert.notEqual(copy[0].lines, hunks[0].lines, 'a copy');
  for (const bad of [[], [{ lines: 'no' }], [{ ...hunks[0], lines: ['two\nlines'] }], [{ ...hunks[0], extra: 1 }], null])
    assert.equal(validHunks(bad), null, JSON.stringify(bad));
  // A recording's file names are never carried.
  assert.deepEqual(redact(led({ lineage: { files: ['/x/a.jsonl'] } })).ledger.lineage.files, ['recording-1']);
});

test('D90: nothing is declared redacted from what a text says; a declaration a ledger already carries is kept', () => {
  // Mark-shaped text a recording holds (a person pasted an earlier page, an agent printed one) is the recording's own:
  // kept as it is and never declared redacted.
  const recorded = led({ ask: [{ turn: 0, text: 'Deploy with ‹redacted:anthropic-key› now' }],
    sayings: [{ turn: 0, text: 'Used ‹dropped:high-entropy› and ‹dropped:high-entropy›.' }],
    commentary: [{ turn: 0, text: 'Set ‹redacted:secret-value›.' }],
    delegations: [{ adapter: 'claude', turn: 0, callId: 'call-1', childId: 'agent-1',
      parentInstruction: { tool: 'Agent', text: 'Use ‹redacted› here' },
      finalAnswer: { text: 'Kept ‹redacted:secret-value›' } }] });
  const { ledger } = redact(recorded);
  assert.equal(ledger.ask[0].text, recorded.ask[0].text);
  for (const field of [ledger.ask[0], ledger.sayings[0], ledger.commentary[0], ledger.delegations[0].parentInstruction,
    ledger.delegations[0].finalAnswer]) {
    assert.equal(field.redacted, undefined, JSON.stringify(field));
    assert.equal(field.redactedTokens, undefined, JSON.stringify(field));
  }
  assert.deepEqual(ledger.dropped, []);
  // A ledger an earlier Sonah's redactor wrote keeps its own declarations and its list of what it dropped, as they are.
  const persisted = led({ ask: [{ turn: 0, text: 'Deploy with ‹redacted:anthropic-key› now', redacted: true }],
    sayings: [{ turn: 0, text: 'Used ‹dropped:high-entropy› and ‹dropped:high-entropy›.', redacted: true,
      redactedTokens: 2 }],
    commentary: [{ turn: 0, text: 'Set ‹redacted:secret-value›.', redacted: true }],
    delegations: [{ adapter: 'claude', turn: 0, callId: 'call-1', childId: 'agent-1',
      finalAnswer: { text: 'Kept ‹redacted:secret-value›', redacted: true } }],
    dropped: [{ turn: 0, reason: 'redacted:anthropic-key', where: 'ask' }] });
  const kept = redact(persisted).ledger;
  assert.equal(kept.ask[0].redacted, true);
  assert.deepEqual([kept.sayings[0].redacted, kept.sayings[0].redactedTokens], [true, 2]);
  assert.equal(kept.commentary[0].redacted, true);
  assert.equal(kept.delegations[0].finalAnswer.redacted, true);
  assert.deepEqual(kept.dropped, persisted.dropped);
  assert.deepEqual(redact(kept).ledger, kept, 'a second pass changes nothing');
});

test('D90: entropy tells a random token from words (the slicer\'s delegation check) and masks nothing', () => {
  assert.equal(ENTROPY_MIN, 4.6);
  assert.ok(entropy('a3F9kQ2xZ7pL0wR5tY8uB1nM4vC6sD2e') >= ENTROPY_MIN);
  assert.ok(entropy('the the the the the the the the') < ENTROPY_MIN);
});
