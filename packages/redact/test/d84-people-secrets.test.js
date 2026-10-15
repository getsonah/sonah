// D84 review (2026-10-13), findings 1 and 2: what the redactor's full walk hides in a ledger the model reads unredacted
// (`peopleSecretsOf`), and the masking of those values in a text written for a person (`maskValues`, `maskForPeople`).
// Synthetic ledgers and FAKE values only, each built at run time so no line of this file is itself key-shaped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NO_PEOPLE_SECRETS, joinHidden, keepPeopleSecrets, maskForPeople, maskValues, peopleMask,
  peopleSecretsFor, peopleSecretsOf, redact } from '../index.js';

const LONE = ['tangerine', 'quartz', 'fake'].join('');
const CRED = ['fake7', 'Token4', 'Only2', 'Tests'].join('');
const KEY = ['sk', 'ant', 'api03', 'FAKEonlyForTests0123456789abcdefXYZ0123456789fake'].join('-');
const bash = (cmd, out, seq = 0) => ({ turn: 1, seq, kind: 'bash', cmd, tailLines: out.split('\n') });
const ledgerOf = (...entries) => ({ ask: [], ledger: entries });

test('D84 review: a value only its event\'s other field names is a session value, masked in any text', () => {
  const ledger = ledgerOf(bash('echo $DB_PASSWORD', LONE));
  assert.equal(maskForPeople(LONE), LONE, 'premise: read alone, the value passes the prose rules');
  assert.equal(redact(structuredClone(ledger)).ledger.ledger[0].tailLines[0], '‹redacted:secret-value›',
    'premise: the full walk hides it (S1: the command names it)');
  const secrets = peopleSecretsOf(ledger);
  assert.deepEqual([...secrets.values], [LONE]);
  assert.deepEqual([...secrets.of(LONE).values], [LONE], 'what the walk hid in the field the output is stored as');
  // Restated by the model, in its own words: masked, with the walk's own mark.
  assert.equal(maskForPeople(`the command showed ${LONE}.`, secrets.values),
    'the command showed ‹redacted:secret-value›.');
  // A field with nothing hidden, and a text no field holds, have nothing hidden.
  assert.deepEqual(secrets.of('echo $DB_PASSWORD'), NO_PEOPLE_SECRETS.of(''));
  assert.deepEqual(secrets.of('no field holds this'), NO_PEOPLE_SECRETS.of(''));
});

test('D84 review: a value the walk shows elsewhere, or one never a value alone, stays masked only where it was hidden',
  () => {
    // Shown elsewhere, unmasked: no secret alone (the walk's own judgement there), so not masked in every text.
    const elsewhere = ledgerOf(bash('echo $DB_PASSWORD', LONE), bash(`ls ${LONE}`, `${LONE}/README.md`, 1));
    const shown = peopleSecretsOf(elsewhere);
    assert.deepEqual([...shown.values], []);
    assert.deepEqual([...shown.of(LONE).values], [LONE], 'still hidden in the field the walk hid it in');
    // A count (the password family never reads one as a value alone, S1): hidden in its field, nowhere else.
    for (const cmd of ['export DB_PASSWORD=1234 && npm start', 'PASSWORD=1234 ./run.sh']) {
      const secrets = peopleSecretsOf(ledgerOf(bash(cmd, 'ok')));
      assert.deepEqual([...secrets.values], [], cmd);
      assert.deepEqual([...secrets.of(cmd).values], ['1234'], cmd);
      assert.equal(maskForPeople('it printed 1234 lines', secrets.values), 'it printed 1234 lines');
    }
  });

test('D84 review: a field the walk withholds whole is withheld whole; an identity is never a value', () => {
  const input = JSON.stringify({ config: { nested: KEY } });
  const generic = ledgerOf({ turn: 1, seq: 0, kind: 'other', tool: 'mcp__x__y', genericTool: true,
    argsExcerpt: input });
  assert.equal(redact(structuredClone(generic)).ledger.ledger[0].argsExcerpt, undefined, 'premise: withheld whole');
  assert.equal(peopleSecretsOf(generic).of(input).whole, true);
  // A hand-off's call id the identity scan withholds is an identity, never a text a person reads as recorded.
  const handoff = { ask: [], ledger: [], delegations: [{ turn: 1, kind: 'agent', adapter: 'claude', callId: KEY,
    report: { text: 'done' } }] };
  assert.equal(redact(structuredClone(handoff)).ledger.delegations[0].callId, null, 'premise: the id is withheld');
  assert.deepEqual([...peopleSecretsOf(handoff).values], []);
});

test('D84 review: the walk is deterministic, leaves its ledger as it was, and runs once per session', () => {
  const ledger = ledgerOf(bash('echo $DB_PASSWORD', LONE), { turn: 1, seq: 1, kind: 'create',
    path: 'deploy/credentials.json', argsExcerpt: `{"db":{"value":"${CRED}"}}`,
    after: { text: `{"db":{"value":"${CRED}"}}`, truncated: false, lines: 1 } });
  const before = structuredClone(ledger);
  const one = peopleSecretsOf(ledger), two = peopleSecretsOf(ledger);
  assert.deepEqual([...one.values], [...two.values]);
  assert.deepEqual([...one.values].sort(), [CRED, LONE].sort());
  assert.deepEqual(ledger, before, 'the ledger the model reads is not changed');
  // Kept with a session: found on first use, then the same answer; a session kept with none has nothing hidden.
  let runs = 0;
  const counted = Object.defineProperty({ ...ledger }, 'ask',
    { enumerable: true, get: () => { runs++; return ledger.ask; } });
  const session = keepPeopleSecrets({}, counted);
  assert.equal(runs, 0, 'nothing runs before a person-facing text is written');
  assert.equal(peopleSecretsFor(session), peopleSecretsFor(session));
  const after = runs;
  assert.ok(after > 0);
  peopleSecretsFor(session);
  assert.equal(runs, after, 'found once, then kept');
  assert.equal(peopleSecretsFor({}), NO_PEOPLE_SECRETS);
  assert.throws(() => peopleSecretsFor(keepPeopleSecrets({}, { get ask() { throw new Error('unreadable'); } })),
    'fails closed: a walk that cannot run throws');
});

test('D84 review: maskValues masks whole tokens, keeps the walk\'s marks, never reads into a mark, and is idempotent',
  () => {
    const values = ['abcd1234wxyz'];
    assert.equal(maskValues('x abcd1234wxyz.', values), 'x ‹redacted:secret-value›.');
    assert.equal(maskValues('xabcd1234wxyz', values), 'xabcd1234wxyz', 'inside a longer token: not this value');
    assert.equal(maskValues('‹redacted:abcd1234wxyz›', values), '‹redacted:abcd1234wxyz›', 'a mark is never read');
    const once = maskValues('a abcd1234wxyz b abcd1234wxyz', values);
    assert.equal(once, 'a ‹redacted:secret-value› b ‹redacted:secret-value›');
    assert.equal(maskValues(once, values), once);
    // A value the model restated, that a cut made before this pass left at a text's end or start: masked as far as it
    // stands, from 4 characters. One it never restated is not read into a text's last or first word.
    const restated = peopleMask(values, { restatedIn: { explanation: 'it printed abcd1234wxyz there' } });
    assert.equal(restated('showed abcd123'), 'showed ‹redacted:secret-value›');
    assert.equal(restated('showed abcd123…'), 'showed ‹redacted:secret-value›…');
    assert.equal(restated('…34wxyz is set'), '…‹redacted:secret-value› is set');
    assert.equal(restated('showed abc'), 'showed abc', 'three characters are no part of a value');
    assert.equal(maskValues('showed abcd123', values), 'showed abcd123', 'a value never restated is not cut-matched');
    assert.equal(peopleMask(values, { restatedIn: { explanation: 'nothing' } })('showed abcd123'), 'showed abcd123');
    // The walk's own mark, when the list is the walk's.
    const secrets = peopleSecretsOf(ledgerOf(bash('export DB_PASSWORD=Quill-Fake-Value-77', 'ok')));
    const cmd = 'export DB_PASSWORD=Quill-Fake-Value-77';
    assert.equal(maskValues(cmd, secrets.of(cmd).values), redact(structuredClone(ledgerOf(bash(cmd, 'ok'))))
      .ledger.ledger[0].cmd, 'the same bytes the walk left');
    // Several fields together.
    const both = joinHidden([secrets.of(cmd), { values: ['abcd1234wxyz'], whole: false }]);
    assert.deepEqual([...both.values].sort(), ['Quill-Fake-Value-77', 'abcd1234wxyz'].sort());
    assert.equal(joinHidden([]).whole, false);
  });

test('D84 review: the output function fails closed on what it cannot read', () => {
  assert.throws(() => maskForPeople('text', 'not a list'), TypeError);
  assert.throws(() => maskForPeople('text', [1]), TypeError);
  assert.throws(() => peopleMask([null]), TypeError);
  assert.throws(() => peopleMask(['v'])(undefined), TypeError);
  const mask = peopleMask([LONE]);
  assert.equal(mask(`a ${LONE}`), maskForPeople(`a ${LONE}`, [LONE]));
  assert.equal(mask(`a ${LONE}`), 'a ‹redacted:secret-value›', 'the cache answers as the function does');
});
