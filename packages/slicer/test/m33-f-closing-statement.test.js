// M33 F repair 3. A closing statement (slicer `sayings`: a turn's last assistant text) is never cut.
//
// The slicer used to cut a statement over 8000 UTF-16 units to its first 6000 and last 2000, mid-line, around '[…]' —
// BEFORE redaction, so a token straddling either cut reached redaction as two halves. M33 F repair 3 removed the cut:
// the slicer keeps the whole statement. D68 (E) (owner decision 2026-10-07): what the agent PRODUCED is kept whole, so
// nothing bounds the statement either (`STATEMENT_CAP`, `boundStatement`, `FINAL_ANSWER_CAP` and `boundFinalAnswer`
// are deleted); a persisted ledger an earlier Sonah bounded keeps its marker, and a second pass changes nothing. D90
// (owner decision 2026-10-15, privacy is not a design constraint): nothing in it is masked either — a token where an
// old cut fell stands whole, as recorded.
//
// Also here, the M33 F recheck's minors: redaction rebuilds a helper report from an allow-list and bounds one a ledger
// already marks truncated unless it carries Sonah's cut; and a report the recording shows arrived before its only
// candidate hand-off is not attached to it.
//
// Synthetic Codex rollouts and synthetic ledgers only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { INTER_AGENT_COUNTS } from '../src/inter-agent.js';
import * as redaction from '../../redact/index.js';
import { TEXT, SECRET, finalAnswer, rootMeta, ask, said, spawn, lateReportRows, jsonl }
  from '../../evidence/test/m33-f-final-answer-fixture.js';

async function write(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-f-statement-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-10-01T12-00-00-synthetic.jsonl');
  await writeFile(file, jsonl(rows));
  return file;
}
const { redact, STATEMENT_OMISSION, FINAL_ANSWER_OMISSION } = redaction;
/** The 8,000 / 6,000 / 2,000 code points an earlier Sonah bounded a statement and a report by (M33 F to D68 E). */
const RETIRED = Object.freeze({ chars: 8000, head: 6000, tail: 2000 });
const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const points = (text) => [...text].length;

/** A 40-character GitHub token and the 93-character Anthropic-shaped key the fixture carries. */
const GHP = `ghp_${'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz'.slice(0, 36)}`;
const TOKENS = Object.freeze({ ghp: GHP, sk: SECRET });

const LINE = 'checked the parser module and left it as it was';
/** Exactly `n` code points of prose: whole lines, then a partial line of `y` with no line break. */
const prose = (n) => {
  let out = '';
  while (out.length + LINE.length + 1 <= n) out += `${LINE}\n`;
  return out + 'y'.repeat(n - out.length);
};
/** A statement holding `token` from code point `at`, `after` code points of prose after it. */
const straddling = (token, at, after) => {
  const rest = ' is the key\n';
  return `${prose(at)}${token}${rest}${prose(after - rest.length)}`;
};
/** A statement whose head cut (code point 6000) falls `offset` characters into `token`. */
const acrossHead = (token, offset) => straddling(token, RETIRED.head - offset, 4_000);
/** A statement whose tail cut (where its last 2000 code points begin) falls `offset` characters into `token`. */
const acrossTail = (token, offset) => {
  const at = 7_000;
  const text = straddling(token, at, RETIRED.tail + offset - token.length);
  assert.equal(points(text) - RETIRED.tail, at + offset, 'the token starts `offset` before the tail cut');
  return text;
};
const offsets = (token, step = 1) => Array.from({ length: Math.floor((token.length + 5) / step) }, (_, i) => i * step - 2);

// ---- D68 (E): no bound, the markers kept only to read a persisted ledger ------------------------------------------

test('D68 (E) the statement and report bounds are deleted; their markers stay, never the recorder\'s words', () => {
  for (const name of ['STATEMENT_CAP', 'boundStatement', 'FINAL_ANSWER_CAP', 'boundFinalAnswer'])
    assert.equal(name in redaction, false, `${name} is deleted`);
  assert.equal(STATEMENT_OMISSION, '[… statement middle omitted before review …]');
  assert.equal(FINAL_ANSWER_OMISSION, '[… report middle omitted before review …]');
  assert.doesNotMatch(STATEMENT_OMISSION, /recorder/);
  assert.notEqual(STATEMENT_OMISSION, FINAL_ANSWER_OMISSION, 'a statement is not a helper report');
});

test('M33 F repair 3 the slicer keeps the whole closing statement: it cuts nothing, and writes no marker', async (t) => {
  const statement = straddling(GHP, RETIRED.head - 20, 4_000);
  const raw = await sliceLineage([await write(t, [rootMeta(), ask(), said(statement)])]);
  assert.equal(raw.sayings[0].text, statement.trim());
  assert.equal(raw.sayings[0].text.includes(STATEMENT_OMISSION), false);
});

test('D68 (E) redaction keeps a long statement whole: no marker, no cut, a second pass changes nothing', () => {
  const lines = Array.from({ length: 1_600 }, (_, i) => `Statement line ${String(i).padStart(4, '0')} checked it.`);
  const long = lines.join('\n');
  assert.ok(points(long) > RETIRED.chars * 4);
  const once = redact(led({ sayings: [{ turn: 1, text: long }] })).ledger;
  assert.deepEqual(once.sayings[0], { turn: 1, text: long });
  assert.deepEqual(redact({ ...once, dropped: [] }).ledger.sayings[0], once.sayings[0]);
  // A persisted statement an earlier Sonah bounded keeps its marker and its text: a second pass changes nothing.
  const persisted = `${'h'.repeat(RETIRED.head)}\n${STATEMENT_OMISSION}\n${'t'.repeat(RETIRED.tail)}`;
  assert.deepEqual(redact(led({ sayings: [{ turn: 1, text: persisted }] })).ledger.sayings[0], { turn: 1, text: persisted });
});

// ---- the whole statement, as recorded -----------------------------------------------------------------------------------

test('M33 F repair 3, D90 a token at a retired cut stands whole, as recorded (every offset)', () => {
  for (const [name, token] of Object.entries(TOKENS)) {
    for (const [side, build] of [['head', acrossHead], ['tail', acrossTail]]) {
      for (const offset of offsets(token)) {
        const statement = build(token, offset);
        assert.ok(points(statement) > RETIRED.chars);
        const once = redact(led({ sayings: [{ turn: 1, text: statement }] }));
        const saying = once.ledger.sayings[0];
        const where = `${name} across the ${side} cut at ${offset}`;
        assert.equal(saying.text, statement, `${where}: as recorded`);
        assert.equal(saying.text.includes(STATEMENT_OMISSION), false, `${where}: nothing bounds it (D68 E)`);
        assert.equal(saying.redacted, undefined, where);
        // A second pass leaves the statement as the first left it.
        const twice = redact({ ...once.ledger, dropped: [] }).ledger.sayings[0];
        assert.deepEqual(twice, saying, where);
      }
    }
  }
});

test('M33 F repair 3, D90 a key block or a secret-named block at a retired cut keeps every line of its value', () => {
  // The key-block edges are assembled here, so this source carries no key-block header of its own.
  const [begin, end] = ['-----BEGIN', '-----END'].map((edge) => [edge, 'PRIVATE', 'KEY-----'].join(' '));
  const pem = [begin, 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5',
    'Uk9UQVRFRC1LRVktTUFURVJJQUwtRk9SLVRIRS1URVNU', 'WkVSTy1PTkUtVFdPLVRIUkVFLUZPVVItRklWRS1TSVg=', end].join('\n');
  const yaml = ['deploy:', '  client_secret: |', '    c3ludGhldGljLXZhbHVlLWxpbmUtb25l', '    c3ludGhldGljLXZhbHVlLWxpbmUtdHdv',
    'done: true'].join('\n');
  const bodies = { pem: pem.split('\n').slice(1, 4), yaml: ['c3ludGhldGljLXZhbHVlLWxpbmUtb25l', 'c3ludGhldGljLXZhbHVlLWxpbmUtdHdv'] };
  for (const [name, block] of Object.entries({ pem, yaml })) {
    // The block's first code point sits `-shift` code points before the cut (head), or the cut sits `-shift` code
    // points after the line break before it (tail): from just before the block to just after it.
    for (let shift = -block.length - 2; shift <= 2; shift += 7) {
      const head = `${prose(RETIRED.head + shift)}\n${block}\n${prose(4_000)}`;
      const tailAt = 7_000;
      const tailText = `${prose(tailAt)}\n${block}\n`;
      const tail = `${tailText}${prose(RETIRED.tail - (points(tailText) - tailAt) - shift)}`;
      assert.equal(points(tail) - RETIRED.tail, tailAt - shift);
      for (const [side, statement] of [['head', head], ['tail', tail]]) {
        const saying = redact(led({ sayings: [{ turn: 1, text: statement }] })).ledger.sayings[0];
        for (const body of bodies[name]) assert.ok(saying.text.includes(body), `${name} ${side} ${shift}`);
        assert.equal(saying.text.includes(STATEMENT_OMISSION), false, `${name} ${side} ${shift}`);
      }
    }
  }
});

test('D68 (E), D90 a token in what was the cut-away middle is kept where it stands, and nothing is declared', () => {
  const statement = `${prose(7_000)}\nThe key is ${GHP} here.\n${prose(3_000)}`;
  const saying = redact(led({ sayings: [{ turn: 1, text: statement }] })).ledger.sayings[0];
  assert.deepEqual(saying, { turn: 1, text: statement }, 'the whole statement is kept, as recorded');
  const short = redact(led({ sayings: [{ turn: 1, text: `Rotated ${GHP} today.` }] })).ledger.sayings[0];
  assert.deepEqual(short, { turn: 1, text: `Rotated ${GHP} today.` });
});

test('M33 F repair 3, D90 through the slicer and redaction: a token at a retired cut reaches the ledger whole', async (t) => {
  for (const [name, token] of Object.entries(TOKENS)) {
    for (const [side, build] of [['head', acrossHead], ['tail', acrossTail]]) {
      for (const offset of offsets(token, name === 'ghp' ? 1 : 5)) {
        const raw = await sliceLineage([await write(t, [rootMeta(), ask(), said(build(token, offset))])]);
        const clean = redact(raw).ledger;
        const where = `${name} across the ${side} cut at ${offset}`;
        assert.ok(clean.sayings[0].text.includes(token), where);
        assert.equal(clean.sayings[0].text.includes(STATEMENT_OMISSION), false, where);
      }
    }
  }
});

// ---- helper reports: an allow-list, kept whole ------------------------------------------------

const withReport = (finalAnswerValue) => led({ delegations: [{ adapter: 'codex', callId: 'spawn-fix', turn: 1,
  status: 'completed', source: 0, record: 4, taskName: 'fix_parser', finalAnswer: finalAnswerValue }] });
const reportAfter = (ledger) => redact(ledger).ledger.delegations[0].finalAnswer;

test('D68 (E) a helper report is kept whole; one an earlier Sonah bounded keeps its marker, and a flag is never unset', () => {
  const lines = Array.from({ length: 1_600 }, (_, i) => `Report line ${String(i).padStart(4, '0')} checked it.`);
  const huge = lines.join('\n');
  assert.ok(points(huge) > 40_000);
  assert.deepEqual(reportAfter(withReport({ text: huge, record: 9, turn: 1 })), { text: huge, record: 9, turn: 1 });
  // A persisted report an earlier bound cut keeps its text and its flag: a second pass changes nothing.
  const persisted = { text: `${'h'.repeat(RETIRED.head)}\n${FINAL_ANSWER_OMISSION}\n${'t'.repeat(RETIRED.tail)}`,
    record: 9, turn: 1, truncated: true };
  assert.deepEqual(reportAfter(withReport(persisted)), persisted);
  assert.deepEqual(reportAfter(withReport(reportAfter(withReport(persisted)))), persisted);
  // A flag is never unset: a short report a ledger marks truncated still declares the cut.
  assert.deepEqual(reportAfter(withReport({ text: 'Done.', record: 9, turn: 1, truncated: true })),
    { text: 'Done.', record: 9, turn: 1, truncated: true });
});

test('M33 F repair 3 redaction rebuilds a report from its allow-list: text, row, turn and two flags, nothing else', () => {
  const kept = reportAfter(withReport({ text: 'Done.', record: 9, turn: 1, note: `the key was ${GHP}`,
    extra: { nested: GHP }, truncated: false, redacted: 'yes', sender: '/root/fix_parser' }));
  assert.deepEqual(kept, { text: 'Done.', record: 9, turn: 1 }, 'no other field passes');
  // A row or turn that is not a count in range places nothing.
  for (const [record, turn] of [[0, -1], [1.5, '1'], ['9', null], [-3, 2.5]])
    assert.deepEqual(reportAfter(withReport({ text: 'Done.', record, turn })), { text: 'Done.' }, JSON.stringify([record, turn]));
  // The flags are only ever true (D90: a token in the text is kept as recorded).
  assert.deepEqual(reportAfter(withReport({ text: `Rotated ${GHP}.`, record: 9, turn: 1, redacted: true })),
    { text: `Rotated ${GHP}.`, record: 9, turn: 1, redacted: true });
  assert.deepEqual(reportAfter(withReport({ text: `Rotated ${GHP}.`, record: 9, turn: 1 })),
    { text: `Rotated ${GHP}.`, record: 9, turn: 1 });
  // The slicer's own shape keeps its bytes: text, record, turn, in that order.
  assert.equal(JSON.stringify(reportAfter(withReport({ text: TEXT.fixReport, record: 9, turn: 1 }))),
    JSON.stringify({ text: TEXT.fixReport, record: 9, turn: 1 }));
  // Not text: fails closed, keeping only where it was received.
  assert.deepEqual(reportAfter(withReport({ text: 42, record: 9, turn: 1, note: GHP })),
    { text: '', record: 9, turn: 1, redacted: true });
});

// ---- a report the recording shows arrived before its hand-off is not that hand-off's ------------------------------

const countsOf = (ledger) => Object.fromEntries(Object.values(INTER_AGENT_COUNTS).map((key) => [key, ledger.capture?.[key] ?? 0]));
const zero = Object.freeze(Object.fromEntries(Object.values(INTER_AGENT_COUNTS).map((key) => [key, 0])));

test('M33 F repair 3 order vetoes a join: a report recorded before its only candidate hand-off is not attached', async (t) => {
  const sliced = async (rows) => sliceLineage([await write(t, rows)]);
  // Same turn, an earlier row.
  const beforeRow = await sliced([rootMeta(), ask(), said(TEXT.plan), finalAnswer('/root/fix_parser', TEXT.fixReport),
    ...spawn('spawn-fix', 'fix_parser', TEXT.fixBrief), said(TEXT.done)]);
  assert.equal(beforeRow.delegations.find((d) => d.callId === 'spawn-fix').finalAnswer, undefined);
  assert.deepEqual(countsOf(beforeRow), { ...zero, interAgentFinalAnswersUnattributed: 1 });
  // An earlier human turn.
  const beforeTurn = await sliced([rootMeta(), ask(), finalAnswer('/root/fix_parser', TEXT.fixReport),
    ask(TEXT.followUp), ...spawn('spawn-fix', 'fix_parser', TEXT.fixBrief), said(TEXT.done)]);
  assert.equal(beforeTurn.delegations.find((d) => d.callId === 'spawn-fix').finalAnswer, undefined);
  assert.deepEqual(countsOf(beforeTurn), { ...zero, interAgentFinalAnswersUnattributed: 1 });
  // A report before the hand-off proves another helper answered to that path: one after it is then not the hand-off's
  // alone either. Order only ever takes a join away, never picks one.
  const both = await sliced([rootMeta(), ask(), finalAnswer('/root/fix_parser', 'An earlier helper reported.'),
    ...spawn('spawn-fix', 'fix_parser', TEXT.fixBrief), finalAnswer('/root/fix_parser', TEXT.fixReport), said(TEXT.done)]);
  assert.equal(both.delegations.find((d) => d.callId === 'spawn-fix').finalAnswer, undefined);
  assert.deepEqual(countsOf(both), { ...zero, interAgentFinalAnswersUnattributed: 1, interAgentFinalAnswersAmbiguous: 1 });
  // Control: a report after its hand-off, even turns later, still attaches.
  const late = await sliced(lateReportRows());
  assert.equal(late.delegations[0].finalAnswer.text, TEXT.fixReport);
  assert.deepEqual(countsOf(late), { ...zero, interAgentFinalAnswersAttributed: 1 });
});
