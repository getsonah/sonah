// M33 W (Claude Code Workflow agents): every channel this change opens — an agent's brief (its recording's first user
// row), its report (the journal's exact recorded result JSON), and its transcript text — reaches the ledger, the
// canonical session and a review request. D90 (owner decision 2026-10-15, privacy is not a design constraint): as
// recorded. Before, each channel was redacted before any cut, cap or hash and these tests proved no fragment of a
// planted secret survived; now nothing is masked or withheld for what it says, and these tests prove each planted
// FAKE value is carried whole, wherever the cuts an earlier Sonah made fell. Every byte is invented; the FAKE values are
// assembled at run time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { redact, sliceHash, ASK_OMISSION, FINAL_ANSWER_OMISSION, STATEMENT_OMISSION as STATEMENT_OMISSION_LINE }
  from '../../redact/index.js';
/** The 8,000 / 6,000 / 2,000 code points an earlier Sonah bounded a statement and a report by (M33 F to D68 E): used
 *  only to place a value where those cuts fell. */
const FINAL_ANSWER_CAP = Object.freeze({ chars: 8000, head: 6000, tail: 2000 });
const STATEMENT_CAP = FINAL_ANSWER_CAP;
import { INSTRUCTION_GAP_NOTES } from '../../evidence/adapters/sonah-ledger.js';
// C-01 event identity: sessions are registered, and their events named by positional labels (stable-ids-fixture.js).
import { adapt, named } from '../../evidence/test/stable-ids-fixture.js';
import { planWindowRequests } from '../../evidence/src/run-review.js';
import { ARG_SEP } from '../../slicer/src/events.js';
import { AGENTS, SLUG, SID, RUN, TEXT, fixerRows, linkedRun, mkdir, parentRows, resulted, rm, scratch, started,
  testerRows, workflowRows, writeTree } from './m33-w-workflow-fixture.js';

const TOKEN = `ghp_${'Zk3Qw8Rt'.repeat(4)}Ab9x`;
const PASS = ['Qv7mr', 'lxTzp', 'qw33k'].join('-');
/** A key block's armour, assembled at run time (a secret scan flags the literal in a source). */
const ARMOUR = ['RSA', 'PRIVATE', 'KEY'].join(' ');
const BEGIN = `-----BEGIN ${ARMOUR}-----`, END = `-----END ${ARMOUR}-----`;
/** A key block body: base64 lines derived from a fixed seed (no word of any other text in these sessions). */
const PEM_BODY = [0, 1, 2].map((i) => createHash('sha512').update(`m33-w synthetic key line ${i}`).digest('base64').slice(0, 64));
const filler = (n, tag = 'line') => Array.from({ length: n }, (_, i) => `filler ${tag} ${String(i).padStart(4, '0')} about the parser.`);
const MARK = /‹(?:redacted|dropped)/;

/** Load a run as a review does; every value in `shown` must reach the ledger, the session's text and the requests
 *  whole, and nothing is marked redacted. */
async function surfaces(t, run, { shown = [] } = {}) {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(dir, 'sonah-home');
  t.after(() => { if (previous === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previous; });
  const transcriptDir = join(dir, 'projects', SLUG, SID, 'subagents', 'workflows', RUN);
  const tree = await writeTree(dir, { parent: parentRows({ workflows: [workflowRows({ transcriptDir })] }), run });
  await mkdir(join(dir, 'codex'), { recursive: true });
  const raw = await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex: join(dir, 'codex') } });
  const ledger = redact(raw).ledger;
  const session = adapt(ledger, { sessionKey: 'm33-w-as-recorded' });
  const plan = planWindowRequests({ session, reviewScope: 'session-only' });
  const surface = { ledger: JSON.stringify(ledger), blobs: Object.values(session.blobs).join('\n'),
    requests: plan.requests.map(({ request }) => `${request.prompt ?? ''}\n${request.system ?? ''}`).join('\n') };
  for (const [where, value] of Object.entries(surface)) {
    for (const text of shown) assert.ok(value.includes(text), `${where}: ${text.slice(0, 12)}… is carried whole`);
    assert.doesNotMatch(value, MARK, `${where}: nothing is marked redacted`);
  }
  assert.equal(typeof sliceHash(ledger), 'string');
  return { raw, ledger, session, plan, linked: ledger.delegations.filter((d) => d.kind === 'workflow-agent') };
}
/** `text` as a JSON string's body: what the ledger and a request hold of it inside a serialized report. */
const inJson = (text) => JSON.stringify(text).slice(1, -1);
const withReport = (fixerResult) => linkedRun({ journal: [started(AGENTS.fixer), started(AGENTS.tester),
  resulted(AGENTS.fixer, fixerResult), resulted(AGENTS.tester, 'Ran npm test: 12 passed.')] });
const withAgents = (fixer, tester = testerRows()) => linkedRun({ agents: { [AGENTS.fixer]: fixer, [AGENTS.tester]: tester } });

test('M33 W, D90: a report over the retired cap is kept whole as recorded, a value where the old cuts fell included', async (t) => {
  for (const offset of [1, 15, 29, 39]) {
    // In the recorded JSON text the old head cut (code point 6000) falls `offset` characters into the value.
    const lead = '{"summary":"';
    const before = `${lead}${filler(150).join(' ')} The deploy key is `;
    const pad = 'x'.repeat(FINAL_ANSWER_CAP.head - [...before].length - offset);
    const value = { summary: `${before.slice(lead.length)}${pad}${TOKEN} and it worked. ${filler(150, 'after').join(' ')}` };
    const text = JSON.stringify(value);
    assert.equal([...text].slice(FINAL_ANSWER_CAP.head - offset, FINAL_ANSWER_CAP.head - offset + 4).join(''), 'ghp_');
    assert.ok([...text].length > FINAL_ANSWER_CAP.chars);
    const { linked, session } = await surfaces(t, withReport(value), { shown: [TOKEN] });
    assert.deepEqual(linked[0].finalAnswer, { text }, `offset ${offset}`);
    assert.equal(session.observationFor(named(session, 'D1-0')).helperReported, true);
  }
  // The old tail cut (the last 2000 code points) falling into the value.
  const value = { summary: `${filler(400).join(' ')} the key ${TOKEN}${'y'.repeat(FINAL_ANSWER_CAP.tail - 30)} end.` };
  assert.deepEqual((await surfaces(t, withReport(value), { shown: [TOKEN] })).linked[0].finalAnswer,
    { text: JSON.stringify(value) });
  // D68 (E): a report over the retired cap is kept whole: nothing cut, nothing declared clipped.
  const summary = { summary: filler(400).join(' ') };
  const clean = await surfaces(t, withReport(summary));
  const report = clean.linked[0].finalAnswer;
  assert.deepEqual([report.text, report.truncated, report.redacted], [JSON.stringify(summary), undefined, undefined]);
  assert.equal(report.text.includes(FINAL_ANSWER_OMISSION), false);
  assert.equal(clean.session.adapterGaps.some((gap) => gap.code === 'source_clipped'), false);
});

test('M33 W, D90: a report holding a key-shaped value, a secret-named one or a key block is kept whole as recorded', async (t) => {
  for (const value of [
    { summary: `Rotated the deploy key ${TOKEN} and reran the parser tests.`, ok: true },
    { password: PASS, ok: true },
    { salt: PASS, ok: true },
    { config: `db:\n  password: |\n    ${PASS}\n    second line` },
    { key: `${BEGIN}\n${PEM_BODY.join('\n')}\n${END}` },
    { env: `PORT=8080\nAPI_TOKEN=${PASS}` },
    { lines: ['line one', `password: ${PASS}`] },
    { note: 'rotated', parts: [BEGIN, ...PEM_BODY, END] },
    `${BEGIN}\n${PEM_BODY.join('\n')}\n${END}`,
  ]) {
    const text = JSON.stringify(value);
    const shown = text.includes(TOKEN) ? [TOKEN] : text.includes(PASS) ? [PASS] : PEM_BODY.map(inJson);
    const { linked, session } = await surfaces(t, withReport(value), { shown });
    assert.deepEqual(linked[0].finalAnswer, { text }, text.slice(0, 40));
    assert.equal(session.observationFor(named(session, 'D1-0')).helperReported, true, 'the hand-off\'s result');
    assert.ok(!session.adapterGaps.some((gap) => /withheld by redaction/.test(gap.note ?? '')), 'no redaction gap');
  }
});

test('M33 W, M35, D90: a long brief is kept in full and as recorded, a value where the old ask cuts fell included', async (t) => {
  const HEAD = 14_000, BUDGET = 20_000;
  const lead = `${TEXT.fixerBrief}\n${filler(200).join('\n')}\n`;
  for (const offset of [1, 20, 39]) {
    // Head: the old 14,000-character cut falls `offset` characters into the value.
    const pad = 'p'.repeat(HEAD - lead.length - 'Use key '.length - offset);
    const head = `${lead}${pad}Use key ${TOKEN} for the deploy.\n${filler(260, 'tail').join('\n')}`;
    assert.ok(head.length > BUDGET && head.slice(HEAD - offset, HEAD - offset + 4) === 'ghp_');
    const { session, raw } = await surfaces(t, withAgents(fixerRows({ brief: head })), { shown: [TOKEN] });
    const brief = session.events.find((e) => e.childId === AGENTS.fixer && e.kind === 'instruction');
    // M33 W repair: a brief takes every ask's path (M33 R). M35 (windowing): kept in full — no cut, no declaration, no
    // gap. D90: as recorded.
    assert.equal(session.textSpansOf(brief, 'text').join(''), head, 'kept whole, as recorded');
    assert.ok(!raw.children[0].ledger.instructions[0].text.includes(ASK_OMISSION), 'nothing is cut');
    assert.equal(raw.children[0].ledger.instructions[0].elided, undefined, 'nothing is declared');
    assert.ok(!session.adapterGaps.some((gap) => gap.note === INSTRUCTION_GAP_NOTES.capped_before_review), 'no gap');
  }
  // A YAML block whose key sits before the old cut and whose value lines sit after it; a key block across it; a block
  // the old ask strip replaced.
  const keyAt = HEAD - 30;
  for (const [brief, shown] of [
    [`${lead}${'q'.repeat(keyAt - lead.length)}\ndb:\n  password: |\n    ${PASS}\n    more of it\n${filler(300, 'end').join('\n')}`,
      [PASS]],
    [`${lead}${'r'.repeat(HEAD - lead.length - 40)}\n${BEGIN}\n${PEM_BODY.join('\n')}\n${END}\n${filler(300, 'end').join('\n')}`,
      PEM_BODY],
    [`${TEXT.fixerBrief}\n\`\`\`\n${filler(40).join('\n')}\nexport TOKEN=${TOKEN}\n\`\`\`\nThen report.`, [TOKEN]],
  ]) await surfaces(t, withAgents(fixerRows({ brief })), { shown });
});

test('M33 W, D90: an agent\'s transcript is kept as recorded: tool output, a statement past the retired cap, commentary', async (t) => {
  const output = (row) => row('user', [{ type: 'tool_result', tool_use_id: 'toolu_leak_out', content:
    `deploying\nexport GITHUB_TOKEN=${TOKEN}\ndb:\n  password: |\n    ${PASS}\ndone` }], {}, 'leak:r');
  const call = (row) => row('assistant', [{ type: 'tool_use', id: 'toolu_leak_out', name: 'Bash',
    input: { command: 'cat deploy.log', description: 'show the log' } }], {}, 'leak');
  const commentary = (row) => row('assistant', [{ type: 'text', text: `Found the key block:\n${BEGIN}\n`
    + `${PEM_BODY.join('\n')}\n${END}` }], {}, 'leak:said');
  // A closing statement over the retired statement cap, the value across its old head cut.
  const offset = 9;
  const lead = `${filler(100, 'said').join('\n')}\n`;
  const statement = `${lead}${'s'.repeat(STATEMENT_CAP.head - lead.length - 'key '.length - offset)}key ${TOKEN} used.\n`
    + filler(120, 'more').join('\n');
  assert.equal([...statement].slice(STATEMENT_CAP.head - offset, STATEMENT_CAP.head - offset + 4).join(''), 'ghp_');
  const rows = fixerRows({ extra: [call, output, commentary] });
  const last = rows[rows.length - 1];
  rows[rows.length - 1] = { ...last, message: { role: 'assistant', content: [{ type: 'text', text: statement }] } };
  const { session, ledger } = await surfaces(t, withAgents(rows), { shown: [TOKEN, PASS, ...PEM_BODY] });
  // D68 (E): the statement is kept whole; no marker is written. D90: as recorded.
  assert.equal(ledger.children[0].ledger.sayings.some((s) => s.text.includes(STATEMENT_OMISSION_LINE)), false);
  assert.ok(ledger.children[0].ledger.sayings.some((s) => s.text === statement), 'the statement as recorded');
  assert.ok(session.events.some((e) => e.childId === AGENTS.fixer && e.kind === 'observation'
    && session.textSpansOf(e, 'output').join('').includes(`export GITHUB_TOKEN=${TOKEN}`)), 'the output as recorded');
});

// ---- M33 W repair: a workflow agent's file bodies and write arguments, past Sonah's retired cuts ---------------------

const PROSE_LINE = 'checked the parser module and left it as it was';
/** Exactly `n` characters of prose: whole lines, then a partial line of `y`. */
const prose = (n) => {
  let out = '';
  while (out.length + PROSE_LINE.length + 1 <= n) out += `${PROSE_LINE}\n`;
  return out + 'y'.repeat(Math.max(0, n - out.length));
};
/** `total` characters of text holding TOKEN from character `at` (a word of its own). */
const placed = (at, total) => {
  const rest = ' is the key\n';
  return `${prose(at - 1)} ${TOKEN}${rest}${prose(Math.max(0, total - at - TOKEN.length - rest.length))}`;
};
/** One recorded write call of a workflow agent and its result row. */
const writeCall = (id, name, input) => [
  (row) => row('assistant', [{ type: 'tool_use', id, name, input }], {}, id),
  (row) => row('user', [{ type: 'tool_result', tool_use_id: id, content: name === 'Write'
    ? `File created successfully at: ${input.file_path}` : `The file ${input.file_path} has been updated.` }], {}, `${id}:r`),
];

test('M33 W, D90: a workflow agent\'s Write and Edit bodies and arguments are kept as recorded past the old 20,000 and 2,000 cuts', async (t) => {
  const BODY = 20_000, ARGS = 2_000;
  for (const offset of [1, 20, 39]) {
    // The value starts `offset` characters before each old cut: the cut fell `offset` characters into it.
    const path = (name) => `/repo/src/${name}.txt`;
    const argsAt = (prefix) => ARGS - prefix.length - offset;
    const calls = [
      // A file body over 20,000 characters (the written content, each Edit side): Sonah's old body cap.
      ...writeCall('toolu_w_body', 'Write', { file_path: path('w-body'), content: placed(BODY - offset, 25_000) }),
      ...writeCall('toolu_e_body', 'Edit', { file_path: path('e-body'), old_string: 'x',
        new_string: placed(BODY - offset, 25_000) }),
      // A write's own arguments over 2,000 characters (`argsExcerpt`: the path, then each written field).
      ...writeCall('toolu_w_args', 'Write', { file_path: path('w-args'),
        content: placed(argsAt(`${path('w-args')}${ARG_SEP}`), 3_000) }),
      ...writeCall('toolu_e_new', 'Edit', { file_path: path('e-new'), old_string: 'x',
        new_string: placed(argsAt(`${path('e-new')}${ARG_SEP}x${ARG_SEP}`), 3_000) }),
      ...writeCall('toolu_e_old', 'Edit', { file_path: path('e-old'),
        old_string: placed(argsAt(`${path('e-old')}${ARG_SEP}`), 3_000), new_string: 'y' }),
    ];
    const { ledger } = await surfaces(t, withAgents(fixerRows({ extra: calls })), { shown: [TOKEN] });
    const written = ledger.children[0].ledger.ledger.filter((event) => ['edit', 'create'].includes(event.kind));
    assert.equal(written.length, 6, `offset ${offset}: the agent's own Edit and the five writes are its events`);
    for (const event of written.slice(1))
      assert.ok(JSON.stringify(event).includes(` ${TOKEN} is the key`), `offset ${offset}: ${event.path} as recorded`);
  }
  // Across lines: the line that once made the lines after it secret stands before the old cut, they stand after it.
  const yamlAt = (cut) => {
    const head = `${prose(cut - 40)}\ndb:\n  password: |\n`;
    return `${head}${' '.repeat(Math.max(0, cut - head.length))}    ${PASS}\n    second line\n${prose(3_000)}`;
  };
  const pemAt = (cut) => `${prose(cut - 60)}\n${BEGIN}\n${PEM_BODY.join('\n')}\n${END}\n${prose(3_000)}`;
  const lines = [
    ...writeCall('toolu_w_yaml', 'Write', { file_path: '/repo/conf/a.yml', content: yamlAt(BODY) }),
    ...writeCall('toolu_w_pem', 'Write', { file_path: '/repo/conf/b.pem', content: pemAt(BODY) }),
    ...writeCall('toolu_e_yaml', 'Edit', { file_path: '/repo/conf/c.yml', old_string: 'x', new_string: yamlAt(ARGS) }),
    ...writeCall('toolu_e_pem', 'Edit', { file_path: '/repo/conf/d.pem', old_string: pemAt(ARGS), new_string: 'y' }),
  ];
  await surfaces(t, withAgents(fixerRows({ extra: lines })), { shown: [PASS, ...PEM_BODY] });
});
