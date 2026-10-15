// W3e-3 — every text field is scanned the way it was written (security).
//
// F197. A token split across a backslash-continued line survived redaction whole in `cmd`: the
// field was scrubbed as one string, never joined, so neither half matched and both were emitted
// side by side. W3e-1 had fixed exactly this for `scrubLines` only. Every field now goes through
// ONE rule (`settle` in redact/index.js): each logical line is scanned joined AND each physical line
// on its own (and the whole field as one string where it always was); the original is emitted only
// when every scan is clean; otherwise the field's own masked form if it hides everything every
// scan found, else the masked joined form if that does, else the line — or, for an all-or-nothing
// field, the field — is dropped and declared.
//
// F198. An ask with nothing left is no longer the literal "[line dropped: …]": it has no quotable
// text and declares the drop, and the adapter marks its instruction omitted.
//
// F199. The dropped-lines note names the reason the lines were dropped, from one frozen table.
//
// ---- Inventory: every string field that leaves `redact` -----------------------------------------
//
// field                                   | before W3e-3                                  | now
// --------------------------------------- | --------------------------------------------- | ---------------------------------------------
// ask[].text                              | scrub, whole string; key blocks per physical  | scrubField: whole, whole joined, each
//                                         | line; NOT joined, NOT per line                | logical line joined, each physical line
// ask[].mentions[]                        | NOT SCANNED (names harvested from pasted      | flagged(): whole + joined + per line; a
//                                         | material, lowercased)                         | flagged mention is dropped, declared
// ask[].elided[].what                     | slicer's closed words, never session text     | unchanged
// interjections[].text, .mentions[]       | (OWNER DECISION B, 2026-10-01: new)           | exactly as ask[].text and ask[].mentions
// ledger[].cmd                            | scrub, whole string; key blocks per physical  | scrubField (all or nothing: the field goes)
// ledger[].argsExcerpt                    | line; NOT joined, NOT per line  (F197 leak)   | scrubField
// ledger[].firstErrorLine                 | D69 (c): deleted; a legacy one is dropped     | dropped, never shown
// ledger[].diff                           | per physical line; NOT joined                 | per line + each side's continued lines
//                                         |                                               | joined (old: context and -, new: context and +)
// ledger[].tailLines[]                    | per entry; NOT joined                         | per entry + continued entries joined
// ledger[].before.text, after.text        | scrubLines: joined + per physical line (W3e-1)| scrubLines, through the same rule
// claim.finalMessage, sayings[].text,     | scrubLines                                    | scrubLines, through the same rule
//   commentary[].text, instructions[].text,
//   delegations[].parentInstruction.text,
//   children[].parentInstructions[]…text
// claim.<any other string> (prBody)       | NOT SCANNED (no production producer today)    | scrubLines('claim')
// delegations[].callId/childId/taskName/  | scrub, whole string; nulled on any change     | flagged(): nulled on any finding
//   target
// sources[].sessionId/childId/            | scrub, whole string; nulled on any change     | flagged(): nulled on any finding
//   parentThreadId/taskPath
// lineage.rootSessionId                   | NOT SCANNED                                   | flagged(): nulled on any finding
// children[].ledger                       | redact(), recursively                         | same
// lineage.files                           | ordinal aliases, never exported raw
// path, cwd                               | channel-specific path policy
// kind, attempted, via, outcome, result.*,| closed vocabularies written by the slicer, never session text
//   before.source/withheld, marks[].kind, delegation adapter/status/reason/kind/tool/field,
//   dropped[], capture.reasons
//
// Source blobs. `sliceLineage({ includeSources: true })` adds `sources`: recording identities
// (the sources row above), no text. The quotable blobs are built by the adapter
// (evidence/adapters/sonah-ledger.js `put`) only from redacted fields: ask/instruction text,
// commentary and saying text, `cmd`, `tailLines` joined by newlines, before/after text, a
// delegation's brief, and a linked child's blobs (redacted recursively). The last tests below walk
// every blob.
//
// Every fixture is synthetic. Secret-shaped values are assembled at run time, so this file carries
// no literal a secret scan would flag. No real recording is read and no session text is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { verifyReceipt } from '../../evidence/src/session.js';
import { instructionReviewScope } from '../../evidence/src/ledger.js';

const { redact } = R;
const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });

// ---- the secrets, and their halves ----------------------------------------------------------------

// M33 R repair 8: the token's middle reads `Taken`, not `Token` — a word of the proximity rule's vocabulary inside a half
// would put that half's own line in scope, and the premise below (a half passes a scan of its own line) needs a half
// with no such word. What the tests pin is unchanged: a secret only the joined view sees.
const GH = ['gh', 'p_', 'W3e3SplitTaken', 'AbcdefGhij', 'KlmnPqrs12', '3456'].join('');
const AWS = ['AK', 'IA', 'W3E3', 'SPLITKEY', '0001'].join('');
const PW_VALUE = ['Tr0ub4dor', '-W3', 'e3-split', '-value'].join('');
const PW = [['pass', 'word'].join(''), '=', PW_VALUE].join('');
/** Each secret, cut where neither half is a secret (or high-entropy) on its own. */
const SECRETS = {
  'a ghp_-shaped token': { whole: GH, halves: [GH.slice(0, 22), GH.slice(22)] },
  'an AWS-shaped key': { whole: AWS, halves: [AWS.slice(0, 8), AWS.slice(8)] },
  'a password= value': { whole: PW, halves: [PW.slice(0, PW.length - 14), PW.slice(PW.length - 14)] },
};
/** The secret split across a backslash-newline and the continuation's indentation. */
const split = ({ halves: [a, b] }, indent = '    ') => `${a}\\\n${indent}${b}`;
const noHalf = (text, secret, label) => {
  assert.equal(typeof text === 'string' ? text.includes(secret.whole) : false, false, `${label}: the secret survives whole`);
  for (const half of secret.halves)
    assert.ok(typeof text !== 'string' || !text.includes(half), `${label}: a half survives: ${JSON.stringify(half.slice(0, 4))}…`);
};

// Premise, once: the second half alone is not a secret to the per-line scan (and for the token and
// the key, neither is the first), so only a joined scan can catch the whole value.
test('W3e-3 premise: a half of a split secret passes a scan of its own line', () => {
  const through = (line) => redact(led({ ledger: [{ turn: 1, kind: 'bash', cmd: line }] })).ledger.ledger[0].cmd;
  for (const [name, s] of Object.entries(SECRETS)) {
    const halves = name === 'a password= value' ? s.halves.slice(1) : s.halves;
    for (const half of halves) assert.equal(through(`echo ${half}`), `echo ${half}`, name);
  }
});

// ---- F197: a split secret survives in no field -------------------------------------------------

const command = (s) => `curl -sS -H "x-trace: ${split(s)} --retry 3" https://api.example.test/v1`;
const event = (over) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', ...over }] })).ledger.ledger[0];

const FIELDS = {
  cmd: (s) => event({ cmd: command(s) }).cmd,
  argsExcerpt: (s) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'deploy.sh',
    argsExcerpt: `old\n⟪→⟫\n${command(s)}` }] })).ledger.ledger[0].argsExcerpt,
  'a diff line': (s) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'deploy.sh',
    diff: command(s).split('\n').map((l) => `+${l}`).join('\n') }] })).ledger.ledger[0].diff,
  'a diff whose continuation line alone changed': (s) => {
    const [head, tail] = command(s).split('\n');
    return redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'deploy.sh',
      diff: [` ${head}`, '-    "old" --retry 3 https://api.example.test/v1', `+${tail}`].join('\n') }] })).ledger.ledger[0].diff;
  },
  tailLines: (s) => (event({ tailLines: ['$ ./deploy.sh', ...`request header ${split(s)} rejected`.split('\n'), 'exit 1'] }).tailLines ?? []).join('\n'),
  ask: (s) => redact(led({ ask: [{ turn: 1, text: `please run\n${command(s)}\nand report` }] })).ledger.ask[0].text,
  'a write body': (s) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'deploy.sh',
    after: { text: command(s), truncated: false, lines: 2 } }] })).ledger.ledger[0].after.text,
  saying: (s) => redact(led({ sayings: [{ turn: 1, text: command(s) }] })).ledger.sayings[0].text,
};

for (const [name, secret] of Object.entries(SECRETS)) {
  for (const [field, through] of Object.entries(FIELDS)) {
    test(`F197 ${name} split across a continuation survives in no half (${field})`, () => {
      noHalf(through(secret), secret, field);
    });
  }
}

test('F197 a split token in a command is caught as the secret it is, declared once, and the rest is kept', () => {
  const s = SECRETS['a ghp_-shaped token'];
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 4, seq: 0, kind: 'bash', cmd: command(s) }] }));
  assert.equal(ledger.ledger[0].cmd, 'curl -sS -H "x-trace: ‹redacted:github-token› --retry 3" https://api.example.test/v1');
  assert.deepEqual(dropped, [{ turn: 4, reason: 'redacted:github-token', where: 'cmd' }]);
});

test('F197 a dirty continued line is joined; the clean continued lines around it stay as written', () => {
  const s = SECRETS['an AWS-shaped key'];
  const cmd = ['docker run --rm \\', `  -e KEY=${split(s, '  ')} \\`, '  node:20 npm test'].join('\n');
  // Premise: the key is split between the second and third physical lines of one logical line.
  const out = event({ cmd }).cmd;
  noHalf(out, s, 'cmd');
  assert.match(out, /‹redacted:aws-key›/);
  const tail = ['$ make', 'step one \\', '  continues', ...`key ${split(s)} end`.split('\n'), 'done'];
  const lines = event({ tailLines: tail }).tailLines;
  assert.deepEqual(lines, ['$ make', 'step one \\', '  continues', 'key ‹redacted:aws-key› end', 'done'],
    'the clean continued entry keeps its backslash; only the dirty logical line is joined');
});

test('F197 the diff joins each side on its own: a token split over a context line and an added line is caught', () => {
  const s = SECRETS['a ghp_-shaped token'];
  const out = FIELDS['a diff whose continuation line alone changed'](s);
  noHalf(out, s, 'diff');
  assert.ok(!out.includes('"old"'), 'the whole logical line goes: its two sides cannot be joined into one line');
  assert.match(out, /\[… 3 diff line\(s\) dropped: GitHub token …\]$/, 'declared, with its reason');
});

test('F197 a split secret in every field of one ledger reaches no quotable blob of the session', () => {
  for (const [name, s] of Object.entries(SECRETS)) {
    const cmd = command(s);
    const { ledger } = redact(led({
      ask: [{ turn: 1, text: `deploy with\n${cmd}` }],
      ledger: [
        { turn: 1, seq: 0, kind: 'bash', cmd, outcome: 'failed', exitCode: 1,
          tailLines: ['$ deploy', ...`header ${split(s)} rejected`.split('\n')], firstErrorLine: `Error: ${split(s)}` },
        // D69 (c): a legacy first error line is dropped (asserted below).
        { turn: 1, seq: 1, kind: 'create', path: 'deploy.sh', argsExcerpt: cmd, diff: cmd.split('\n').map((l) => `+${l}`).join('\n'),
          after: { text: cmd, truncated: false, lines: 2 }, result: { seen: true, outcome: 'succeeded', provenance: 'native' } },
        { turn: 1, seq: 2, kind: 'edit', path: 'deploy.sh',
          before: { text: cmd, source: 'read', turn: 1, partial: false, truncated: false, lines: 2 },
          after: { text: `${cmd}\n⟪→⟫\nold`, truncated: false, lines: 4, parts: 1, priorParts: 1 } },
      ],
      claim: { finalMessage: cmd },
      sayings: [{ turn: 1, text: cmd }],
      commentary: [{ turn: 1, beforeEvent: 0, text: cmd }],
      delegations: [{ adapter: 'claude', callId: 'call-1', turn: 1, childId: null, status: 'unresolved',
        reason: 'child_unchecked', parentInstruction: { text: cmd, tool: 'Task', field: 'prompt' } }],
    }));
    const session = sessionFromLedger(ledger, { sessionKey: 'w3e3' });
    const blobs = Object.values(session.blobs);
    assert.ok(blobs.length >= 6, `${name}: premise: the fields became blobs`);
    for (const [i, blob] of blobs.entries()) noHalf(blob, s, `${name}: blob ${i}`);
    for (const field of ['cmd', 'argsExcerpt', 'diff']) for (const e of ledger.ledger) noHalf(e[field], s, `${name}: ${field}`);
    assert.ok(ledger.ledger.every((e) => !Object.hasOwn(e, 'firstErrorLine')), `${name}: a legacy firstErrorLine is dropped`);
    noHalf(JSON.stringify(ledger), s, `${name}: anywhere in the redacted ledger`);
  }
});

// ---- F197: nothing clean is rewritten ----------------------------------------------------------

const CLEAN_CMD = ['docker run --rm \\', '  --volume "./src:/work/src" \\', '  --env NODE_ENV=test \\', '  node:20 npm test'].join('\n');

test('F197 a clean multi-line command stays byte-identical in every field', () => {
  assert.equal(event({ cmd: CLEAN_CMD }).cmd, CLEAN_CMD);
  assert.equal(redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'a.sh', argsExcerpt: CLEAN_CMD }] })).ledger.ledger[0].argsExcerpt, CLEAN_CMD);
  assert.deepEqual(event({ tailLines: CLEAN_CMD.split('\n') }).tailLines, CLEAN_CMD.split('\n'));
  const diff = CLEAN_CMD.split('\n').map((l, i) => `${i === 1 ? '-' : '+'}${l}`).join('\n');
  assert.equal(redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'a.sh', diff }] })).ledger.ledger[0].diff, diff);
  assert.equal(redact(led({ ask: [{ turn: 1, text: `run this\n${CLEAN_CMD}` }] })).ledger.ask[0].text, `run this\n${CLEAN_CMD}`);
});

test('F197 a dirty command whose secret sits on one physical line is emitted exactly as before', () => {
  const cmd = ['curl -sS \\', `  -H "x-key: ${AWS}" \\`, '  https://api.example.test/v1'].join('\n');
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 2, seq: 0, kind: 'bash', cmd }] }));
  assert.equal(ledger.ledger[0].cmd, cmd.replace(AWS, '‹redacted:aws-key›'), 'the continuations stay');
  assert.deepEqual(dropped, [{ turn: 2, reason: 'redacted:aws-key', where: 'cmd' }]);
});

test('F197 redaction stays idempotent over every field it now joins', () => {
  for (const s of Object.values(SECRETS)) {
    const input = led({ ask: [{ turn: 1, text: command(s) }], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: command(s),
      tailLines: command(s).split('\n'), diff: command(s).split('\n').map((l) => `+${l}`).join('\n') }] });
    const once = redact(input).ledger;
    const twice = redact({ ...once, dropped: [] }).ledger;
    assert.deepEqual({ ...twice, dropped: [] }, { ...once, dropped: [] });
  }
});

// ---- F197: a secret the whole-string scan never saw, one line down -------------------------------

// The whole-string scan let an assignment on one line swallow the next line whole (`FOO=` then a
// newline then `TOKEN=value` reads as FOO's value), so the secret-named value below it was never
// matched. Scanned per physical line, it is.
const NAMED_VALUE = ['aaaabbbb', 'ccccdddd', '1234'].join('');
const SWALLOWED = `FOO=\n${['TO', 'KEN'].join('')}=${NAMED_VALUE}`;

test('F197 a secret-named value swallowed by the line above it survives in no field', () => {
  assert.ok(!(event({ cmd: SWALLOWED }).cmd ?? '').includes(NAMED_VALUE), 'cmd');
  assert.ok(!redact(led({ ask: [{ turn: 1, text: SWALLOWED }] })).ledger.ask[0].text.includes(NAMED_VALUE), 'ask');
});

test('F197 the ask keeps every line the scan did not flag', () => {
  const out = redact(led({ ask: [{ turn: 1, text: `use this\n${SWALLOWED}\nthen deploy` }] })).ledger.ask[0];
  assert.ok(out.text.startsWith('use this\nFOO=\n') && out.text.endsWith('\nthen deploy'), 'the human\'s other words stay');
  assert.ok(!out.text.includes(NAMED_VALUE));
});

// ---- F197: the fields no scan used to reach -------------------------------------------------------

test('F197 an ask mention, the lineage\'s session id and any other claim text are scanned too', () => {
  const token = GH.toLowerCase();
  const { ledger, dropped } = redact(led({
    ask: [{ turn: 1, text: 'see the attached file', mentions: ['lib/util.js', `${token}.json`] }],
    lineage: { rootSessionId: GH, files: ['a.jsonl'], compactionBoundaries: [] },
    claim: { finalMessage: 'done', prBody: `Rotated ${AWS} out of the config.` },
  }));
  assert.deepEqual(ledger.ask[0].mentions, ['lib/util.js'], 'a token-shaped mention is dropped');
  assert.equal(ledger.ask[0].redacted, true);
  assert.equal(ledger.lineage.rootSessionId, null, 'a secret-shaped session id is nulled like every recording identity');
  assert.ok(!ledger.claim.prBody.includes(AWS));
  assert.ok(dropped.some((d) => d.where === 'ask mention') && dropped.some((d) => d.where === 'recording identity'));
  const clean = redact(led({ ask: [{ turn: 1, text: 'x', mentions: ['lib/util.js', 'makefile'] }],
    lineage: { rootSessionId: '4f2a91c7-28db-4a83-9d2e-482217df292d', files: [], compactionBoundaries: [] } })).ledger;
  assert.deepEqual(clean.ask[0].mentions, ['lib/util.js', 'makefile'], 'ordinary mentions stay');
  assert.equal(clean.ask[0].redacted, undefined);
  assert.equal(clean.lineage.rootSessionId, '4f2a91c7-28db-4a83-9d2e-482217df292d', 'an ordinary session id stays');
});

test('M28 recording filenames cross the redaction boundary only as stable ordinal aliases', () => {
  const secret = 'DB_PASSWORD=hunter2';
  const input = led({ lineage: { rootSessionId: 'ordinary-recording',
    files: [`/tmp/${secret}/root.jsonl`, '/tmp/plain/child.jsonl'], compactionBoundaries: [] } });
  const first = redact(input).ledger;
  assert.deepEqual(first.lineage.files, ['recording-1', 'recording-2']);
  assert.deepEqual(redact(first).ledger.lineage.files, first.lineage.files);
  assert.ok(!JSON.stringify(first).includes(secret));
});

// ---- F198: a dropped ask is declared, never quoted as the human's words ------------------------------

const BEGIN = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const END = ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const keyLine = (i) => Array.from({ length: 64 }, (_, k) => B64[(i * 29 + k * 37 + ((k * k) % 11)) % 64]).join('');
const LEGACY_DROPPED_ASK = ['[line', 'dropped:', 'unclassified', 'high-entropy', 'content]'].join(' ');

/** An ask no form can show safely: a key only the physical line sees (the join glues a word onto
 *  it) and, in the same logical line, a token only the joined line sees. */
const UNSHOWABLE = [`echo ${AWS}\\`, `QRS ${split(SECRETS['a ghp_-shaped token'])}`].join('\n');

test('F198 an ask with nothing left has no text and declares the drop', () => {
  for (const [name, text] of [['a pasted key', [BEGIN, keyLine(0), keyLine(1), END].join('\n')],
    ['an ask no form can show', UNSHOWABLE]]) {
    const { ledger } = redact(led({ ask: [{ turn: 1, text }] }));
    const [ask] = ledger.ask;
    assert.equal(ask.text, '', `${name}: no text, and never the redactor's words`);
    assert.equal(ask.redacted, true, name);
    assert.equal(ask.redactedLines, text.split('\n').length, `${name}: the drop is counted`);
    noHalf(JSON.stringify(ledger), SECRETS['a ghp_-shaped token'], name);
    assert.ok(!JSON.stringify(ledger).includes(AWS), name);
  }
});

test('F198 an ask with no text is never given the redactor\'s words', () => {
  const [ask] = redact(led({ ask: [{ turn: 1, text: null }] })).ledger.ask;
  assert.notEqual(ask.text, LEGACY_DROPPED_ASK);
});

const humanQuote = (session, id, quote) => verifyReceipt(session, { eventId: id, role: 'instruction', quote }).ok;

test('F198 a dropped ask is an omitted instruction: never quotable, and the scope is incomplete', () => {
  const { ledger } = redact(led({ ask: [{ turn: 1, text: 'keep the public API stable' }, { turn: 2, text: UNSHOWABLE }],
    ledger: [{ turn: 2, seq: 0, kind: 'bash', cmd: 'npm test', outcome: 'passed' }] }));
  const session = sessionFromLedger(ledger, { sessionKey: 'w3e3-f198' });
  const dropped = session.events.find((e) => e.id === 'I2');
  assert.ok(dropped, 'the instruction still has its place in the order');
  assert.equal(dropped.omitted, true);
  assert.equal(dropped.redacted, true);
  assert.equal(session.textOf(dropped, 'text'), '', 'no quotable text');
  for (const quote of ['line dropped', 'unclassified high-entropy', 'echo', 'QRS'])
    assert.equal(humanQuote(session, 'I2', quote), false, `not quotable as the human's words: ${quote}`);
  assert.ok(humanQuote(session, 'I1', 'public API stable'), 'the other instruction still grounds');
  assert.equal(instructionReviewScope(session).complete, false, 'the human\'s words are missing');
});

test('F198 a ledger persisted with the old literal is read as a dropped ask, not as the human\'s words', () => {
  const session = sessionFromLedger(led({ ask: [{ turn: 1, text: 'ship it' }, { turn: 2, text: LEGACY_DROPPED_ASK, redacted: true }] }),
    { sessionKey: 'w3e3-legacy' });
  const legacy = session.events.find((e) => e.id === 'I2');
  assert.equal(legacy.omitted, true);
  assert.equal(humanQuote(session, 'I2', 'line dropped: unclassified'), false);
  assert.equal(instructionReviewScope(session).complete, false);
  // A human who really typed those words, with nothing redacted, is still quotable.
  const typed = sessionFromLedger(led({ ask: [{ turn: 1, text: LEGACY_DROPPED_ASK }] }), { sessionKey: 'w3e3-typed' });
  assert.ok(humanQuote(typed, 'I1', 'line dropped: unclassified'));
});

// ---- F199: the note says why -------------------------------------------------------------------

const NOTE = (n, phrase) => `[… ${n} line(s) dropped: ${phrase} …]`;
const PHRASE = () => R.DROPPED_NOTE_PHRASES ?? {};
const BLOB = 'Zk3!q9Xv%2Lp#7Rw@Nb^4Ty&8Ue*Hs$Jd';                    // unclassified, high entropy
const API_LINE = `  API_KEY=${['hunter2', '-W3E3'].join('')} \\`;         // SECRET_KEY sees it on its own line
const body = (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'conf/app.env',
  after: { text, truncated: false, lines: text.split('\n').length } }] })).ledger.ledger[0].after;

test('F199 every reason redact can declare has one phrase, and only those do', () => {
  const reasons = R.REDACTION_REASONS ?? [];
  assert.ok(reasons.length >= 20, 'premise: the reason set is exported');
  assert.deepEqual(Object.keys(PHRASE()).sort(), [...reasons].sort());
  const phrases = Object.values(PHRASE());
  assert.equal(new Set(phrases).size, phrases.length, 'one phrase per reason');
  assert.equal(Object.isFrozen(PHRASE()), true);
  for (const phrase of phrases) assert.match(phrase, /^[A-Za-z][A-Za-z -]*[A-Za-z]$/);
  assert.equal(PHRASE()['dropped:unclassified-high-entropy'], 'unclassified high-entropy content', 'the common note is unchanged');
});

test('F199 the note names a key block, a secret-named value and an unclassified line by what they were', () => {
  const key = body(['const a = 1;', BEGIN, keyLine(0), END].join('\n'));
  assert.equal(key.text, `const a = 1;\n${NOTE(3, 'private key block')}`);
  const named = body(['env \\', API_LINE, '  node app.js'].join('\n'));
  assert.equal(named.text, NOTE(3, 'secret-named value'));
  const blob = body(['alpha', `seed: ${BLOB}`].join('\n'));
  assert.equal(blob.text, `alpha\n${NOTE(1, 'unclassified high-entropy content')}`);
});

test('F199 mixed reasons: one note per reason, at each source cut, counting every dropped line', () => {
  const text = [`seed: ${BLOB}`, 'keep me', BEGIN, keyLine(0), END, 'env \\', API_LINE, '  node app.js'].join('\n');
  const out = body(text);
  const notes = out.text.split('\n').filter((l) => l.startsWith('[… '));
  assert.deepEqual(notes, [NOTE(1, 'unclassified high-entropy content'), NOTE(3, 'private key block'), NOTE(3, 'secret-named value')]);
  assert.equal(out.redactedLines, 7);
  assert.ok(out.text.startsWith(`${NOTE(1, 'unclassified high-entropy content')}\nkeep me\n`));
  const diff = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'k.pem',
    diff: [`+${BEGIN}`, `+${keyLine(0)}`, `+${END}`, `+seed ${BLOB}`, '+ok'].join('\n') }] })).ledger.ledger[0].diff;
  assert.equal(diff, ['+ok', '[… 3 diff line(s) dropped: private key block …]',
    '[… 1 diff line(s) dropped: unclassified high-entropy content …]'].join('\n'));
});

test('F199 every phrase in the table is recognised by the adapter and never quotable', () => {
  const phrases = Object.values(PHRASE());
  assert.ok(phrases.length > 0, 'premise: the table is exported');
  for (const phrase of phrases) {
    const note = NOTE(2, phrase);
    const text = ['const a = 1;', 'const b = 2;', note].join('\n');
    const session = sessionFromLedger(led({ ask: [{ turn: 1, text: 'edit' }], ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'a.js',
      after: { text, truncated: false, lines: 3, redactedLines: 2 } }] }), { sessionKey: 'w3e3-f199' });
    const write = session.events.find((e) => e.id === 'A1-0');
    const [change] = write.changes;
    assert.equal(session.textOf(change, 'after'), 'const a = 1;\nconst b = 2;', `${phrase}: not part of the body`);
    for (const quote of [phrase, `dropped: ${phrase}`, note])
      assert.equal(verifyReceipt(session, { eventId: write.id, role: 'code', quote }).ok, false, `${phrase}: not quotable`);
  }
});
