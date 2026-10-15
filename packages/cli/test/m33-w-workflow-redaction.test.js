// M33 W (Claude Code Workflow agents), privacy. Every channel this change opens — an agent's brief (its recording's
// first user row), its report (the journal's exact recorded result JSON), and its transcript text — is redacted
// BEFORE any cut, cap or hash (C-02 M33 F repair 3 / M33 R order). Synthetic secrets sit across every cap boundary of
// those channels, on one line and across lines, with a key on one side of a cut and its value on the other; no
// fragment of any of them may reach the ledger, the canonical session, a review request or the story.
// Every byte is invented; the secrets are assembled at run time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { redact, sliceHash, ASK_OMISSION, FINAL_ANSWER_OMISSION, STATEMENT_OMISSION as STATEMENT_OMISSION_LINE }
  from '../../redact/index.js';
/** The 8,000 / 6,000 / 2,000 code points an earlier Sonah bounded a statement and a report by (M33 F to D68 E): used
 *  only to place a token where those cuts fell. */
const FINAL_ANSWER_CAP = Object.freeze({ chars: 8000, head: 6000, tail: 2000 });
const STATEMENT_CAP = FINAL_ANSWER_CAP;
import { INSTRUCTION_GAP_NOTES } from '../../evidence/adapters/sonah-ledger.js';
// C-01 event identity: sessions are registered, and their events named by positional labels (stable-ids-fixture.js).
import { adapt, named } from '../../evidence/test/stable-ids-fixture.js';
import { runReview, planWindowRequests } from '../../evidence/src/run-review.js';
import { renderSessionStory } from '../../render/session-story.js';
import { windowNarrative, fixtureJudge } from './m33-fast-profile-fixture.js';
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
/** Every 6-character window of every secret: none may survive anywhere. */
const pieces = [TOKEN, PASS, ...PEM_BODY].flatMap((secret) => Array.from({ length: secret.length - 5 },
  (_, i) => secret.slice(i, i + 6)));
const leaks = (text, extra = []) => [...pieces, ...extra].filter((piece) => text.includes(piece));
const filler = (n, tag = 'line') => Array.from({ length: n }, (_, i) => `filler ${tag} ${String(i).padStart(4, '0')} about the parser.`);

/** Load a run, and every surface a review or a story reads; assert no fragment of any secret reaches one. */
async function surfaces(t, run, { extra = [] } = {}) {
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
  const session = adapt(ledger, { sessionKey: 'm33-w-leak' });
  const plan = planWindowRequests({ session, reviewScope: 'session-only' });
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', concurrency: 1,
    judge: fixtureJudge({ narrativeOf: (r) => windowNarrative(session, r.window) }) });
  const story = renderSessionStory(session, report);
  const shown = { raw: JSON.stringify(raw), ledger: JSON.stringify(ledger), hash: sliceHash(ledger),
    blobs: Object.values(session.blobs).join('\n'), requests: plan.requests.map(({ request }) =>
      `${request.prompt ?? ''}\n${request.evidencePrompt ?? ''}\n${request.system ?? ''}`).join('\n'), story };
  for (const [where, value] of Object.entries(shown)) assert.deepEqual(leaks(value, extra), [], `${where}: no fragment survives`);
  return { raw, ledger, session, plan, story, linked: ledger.delegations.filter((d) => d.kind === 'workflow-agent') };
}
const withReport = (fixerResult) => linkedRun({ journal: [started(AGENTS.fixer), started(AGENTS.tester),
  resulted(AGENTS.fixer, fixerResult), resulted(AGENTS.tester, 'Ran npm test: 12 passed.')] });
const withAgents = (fixer, tester = testerRows()) => linkedRun({ agents: { [AGENTS.fixer]: fixer, [AGENTS.tester]: tester } });

test('M33 W a report over the retired cap: a token across the old head or tail cut withholds it whole; a clean one is kept whole', async (t) => {
  for (const offset of [1, 15, 29, 39]) {
    // In the recorded JSON text the head cut (code point 6000) falls `offset` characters into the token.
    const lead = '{"summary":"';
    const before = `${lead}${filler(150).join(' ')} The deploy key is `;
    const pad = 'x'.repeat(FINAL_ANSWER_CAP.head - [...before].length - offset);
    const value = { summary: `${before.slice(lead.length)}${pad}${TOKEN} and it worked. ${filler(150, 'after').join(' ')}` };
    const text = JSON.stringify(value);
    assert.equal([...text].slice(FINAL_ANSWER_CAP.head - offset, FINAL_ANSWER_CAP.head - offset + 4).join(''), 'ghp_');
    assert.ok([...text].length > FINAL_ANSWER_CAP.chars);
    // M33 W repair: a decoded string of the recorded report holds a secret, so the whole report is withheld before any
    // scrub or cut (no line of it is judged without the lines around it).
    const { linked, session } = await surfaces(t, withReport(value));
    assert.deepEqual(linked[0].finalAnswer, { text: '', redacted: true }, `offset ${offset}`);
    assert.equal(session.observationFor(named(session, 'D1-0')).helperReported, true);
  }
  // The tail cut (the last 2000 code points) falling into the token.
  const value = { summary: `${filler(400).join(' ')} the key ${TOKEN}${'y'.repeat(FINAL_ANSWER_CAP.tail - 30)} end.` };
  const { linked } = await surfaces(t, withReport(value));
  assert.deepEqual(linked[0].finalAnswer, { text: '', redacted: true });
  // D68 (E): a clean report over the retired cap is kept whole: nothing cut, nothing declared clipped.
  const summary = { summary: filler(400).join(' ') };
  const clean = await surfaces(t, withReport(summary));
  const report = clean.linked[0].finalAnswer;
  assert.deepEqual([report.text, report.truncated, report.redacted], [JSON.stringify(summary), undefined, undefined]);
  assert.equal(report.text.includes(FINAL_ANSWER_OMISSION), false);
  assert.equal(clean.session.adapterGaps.some((gap) => gap.code === 'source_clipped'), false);
});

test('M33 W a report whose decoded strings hold a secret is withheld whole; one only its serialized line names is masked', async (t) => {
  // M33 W repair: any decoded string or key of the recorded report (each alone, and joined by line breaks) a scan
  // would change withholds the whole report, before the serialized scrub.
  const value = { summary: `Rotated the deploy key ${TOKEN} and reran the parser tests.`, ok: true };
  assert.deepEqual((await surfaces(t, withReport(value))).linked[0].finalAnswer, { text: '', redacted: true });
  // A value secret only by the key that names it, in another JSON string: every decoded string is clean alone, the
  // serialized line masks it in place, and the decoded strings of what it leaves are clean. (M33 R repair 8: a key of
  // the proximity rule's vocabulary is no longer such a key — the decoded strings joined by line breaks read `password`
  // over its value, a label line and the value below it, so a scan changes them and the report is withheld whole, fail
  // closed. `salt` is a secret name to the key-name rule and no word of that vocabulary: it still shows the masking in
  // place.)
  assert.deepEqual((await surfaces(t, withReport({ password: PASS, ok: true }))).linked[0].finalAnswer, { text: '', redacted: true });
  const { linked, session } = await surfaces(t, withReport({ salt: PASS, ok: true }));
  const report = linked[0].finalAnswer;
  assert.equal(report.redacted, true);
  assert.equal(report.truncated, undefined);
  assert.equal(report.text, '{"salt":"‹redacted:secret-value›","ok":true}');
  assert.ok(session.adapterGaps.some((gap) => gap.note === 'recorded tool output was partly withheld by redaction'
    && gap.eventIds.includes(named(session, 'D1-0-r'))), 'the scrub is declared with tool output\'s');
});

test('M33 W a key block hidden by JSON escapes inside a report withholds the whole report', async (t) => {
  for (const value of [
    { config: `db:\n  password: |\n    ${PASS}\n    second line` },
    { key: `${BEGIN}\n${PEM_BODY.join('\n')}\n${END}` },
    { env: `PORT=8080\nAPI_TOKEN=${PASS}` },
  ]) {
    const { linked, session } = await surfaces(t, withReport(value));
    assert.deepEqual(linked[0].finalAnswer, { text: '', redacted: true }, JSON.stringify(value).slice(0, 40));
    assert.equal(session.observationFor(named(session, 'D1-0')).helperReported, true, 'still the hand-off\'s result, with no text');
  }
  // M33 W repair: a secret-named value on one line of one string is a decoded string a scan changes: withheld whole.
  const { linked } = await surfaces(t, withReport({ lines: ['line one', `password: ${PASS}`] }));
  assert.deepEqual(linked[0].finalAnswer, { text: '', redacted: true });
});

test('M33 W, M35: a long brief is redacted whole and kept in full: a secret where the old ask cuts fell leaves no fragment', async (t) => {
  const HEAD = 14_000, BUDGET = 20_000;
  const lead = `${TEXT.fixerBrief}\n${filler(200).join('\n')}\n`;
  for (const offset of [1, 20, 39]) {
    // Head: the old 14,000-character cut falls `offset` characters into the token.
    const pad = 'p'.repeat(HEAD - lead.length - 'Use key '.length - offset);
    const head = `${lead}${pad}Use key ${TOKEN} for the deploy.\n${filler(260, 'tail').join('\n')}`;
    assert.ok(head.length > BUDGET && head.slice(HEAD - offset, HEAD - offset + 4) === 'ghp_');
    const { session, raw } = await surfaces(t, withAgents(fixerRows({ brief: head })));
    const brief = session.events.find((e) => e.childId === AGENTS.fixer && e.kind === 'instruction');
    const kept = session.textSpansOf(brief, 'text').join('');
    // M33 W repair: a brief takes every ask's path (M33 R): scrubbed whole. M35 (windowing): and kept in full — no cut,
    // no declaration, no gap.
    assert.ok(kept.startsWith(TEXT.fixerBrief) && kept.endsWith('filler tail 0259 about the parser.'), 'kept whole');
    assert.ok(!raw.children[0].ledger.instructions[0].text.includes(ASK_OMISSION), 'nothing is cut');
    assert.equal(raw.children[0].ledger.instructions[0].elided, undefined, 'nothing is declared');
    assert.ok(!session.adapterGaps.some((gap) => gap.note === INSTRUCTION_GAP_NOTES.capped_before_review), 'no gap');
  }
  // A YAML block whose key sits before the old cut and whose value lines sit after it.
  const keyAt = HEAD - 30;
  const yaml = `${lead}${'q'.repeat(keyAt - lead.length)}\ndb:\n  password: |\n    ${PASS}\n    more of it\n${filler(300, 'end').join('\n')}`;
  await surfaces(t, withAgents(fixerRows({ brief: yaml })));
  // A key block whose BEGIN line is before the old cut and whose body is after it.
  const pem = `${lead}${'r'.repeat(HEAD - lead.length - 40)}\n${BEGIN}\n${PEM_BODY.join('\n')}\n`
    + `${END}\n${filler(300, 'end').join('\n')}`;
  await surfaces(t, withAgents(fixerRows({ brief: pem })));
  // A pasted block the old ask strip replaced before redaction: scrubbed in place now.
  const fenced = `${TEXT.fixerBrief}\n\`\`\`\n${filler(40).join('\n')}\nexport TOKEN=${TOKEN}\n\`\`\`\nThen report.`;
  await surfaces(t, withAgents(fixerRows({ brief: fenced })));
});

test('M33 W an agent\'s transcript is redacted before every cut: tool output, statements past the cap, commentary', async (t) => {
  const output = (row) => row('user', [{ type: 'tool_result', tool_use_id: 'toolu_leak_out', content:
    `deploying\nexport GITHUB_TOKEN=${TOKEN}\ndb:\n  password: |\n    ${PASS}\ndone` }], {}, 'leak:r');
  const call = (row) => row('assistant', [{ type: 'tool_use', id: 'toolu_leak_out', name: 'Bash',
    input: { command: 'cat deploy.log', description: 'show the log' } }], {}, 'leak');
  const commentary = (row) => row('assistant', [{ type: 'text', text: `Found the key block:\n${BEGIN}\n`
    + `${PEM_BODY.join('\n')}\n${END}` }], {}, 'leak:said');
  // A closing statement over the statement cap, the token across its head cut.
  const offset = 9;
  const lead = `${filler(100, 'said').join('\n')}\n`;
  const statement = `${lead}${'s'.repeat(STATEMENT_CAP.head - lead.length - 'key '.length - offset)}key ${TOKEN} used.\n`
    + filler(120, 'more').join('\n');
  assert.equal([...statement].slice(STATEMENT_CAP.head - offset, STATEMENT_CAP.head - offset + 4).join(''), 'ghp_');
  const rows = fixerRows({ extra: [call, output, commentary] });
  const last = rows[rows.length - 1];
  rows[rows.length - 1] = { ...last, message: { role: 'assistant', content: [{ type: 'text', text: statement }] } };
  const { session, ledger } = await surfaces(t, withAgents(rows));
  // D68 (E): the statement is kept whole and scrubbed whole; no marker is written.
  assert.equal(ledger.children[0].ledger.sayings.some((s) => s.text.includes(STATEMENT_OMISSION_LINE)), false);
  assert.ok(ledger.children[0].ledger.sayings.some((s) => s.text.includes('key ‹redacted:github-token› used.')), 'scrubbed whole');
  assert.equal(JSON.stringify(ledger).includes(TOKEN), false);
  assert.ok(session.events.some((e) => e.childId === AGENTS.fixer && e.kind === 'observation'
    && session.textSpansOf(e, 'output').join('').includes('deploying')), 'the output is kept, scrubbed');
});

// ---- M33 W repair: a workflow agent's file bodies and write arguments take M33 R's order ----------------------------

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

test('M33 W a workflow agent\'s Write and Edit bodies and arguments are redacted before Sonah\'s 20,000 and 2,000 cuts', async (t) => {
  const BODY = 20_000, ARGS = 2_000;
  for (const offset of [1, 20, 39]) {
    // The token starts `offset` characters before each cut: the cut falls `offset` characters into it.
    const path = (name) => `/repo/src/${name}.txt`;
    const argsAt = (prefix) => ARGS - prefix.length - offset;
    const calls = [
      // A file body over 20,000 characters (the written content, each Edit side): Sonah's body cap.
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
    const { ledger } = await surfaces(t, withAgents(fixerRows({ extra: calls })));
    const written = ledger.children[0].ledger.ledger.filter((event) => ['edit', 'create'].includes(event.kind));
    assert.equal(written.length, 6, `offset ${offset}: the agent's own Edit and the five writes are its events`);
  }
  // Across lines: the line that makes the lines after it secret stands before the cut, they stand after it.
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
  await surfaces(t, withAgents(fixerRows({ extra: lines })));
});

test('M33 W a key block header the serialized scrub masks still withholds the whole report (no body line survives)', async (t) => {
  // Low-entropy body lines: no rule but the key block's own knows them. The scan of the serialized line masks the
  // BEGIN header; without it, the decoded string's body no longer reads as a key block.
  const BODY = ['plainbodylineoneofthesynthetickey', 'plainbodylinetwoofthesynthetickey'];
  const extra = BODY.flatMap((line) => Array.from({ length: line.length - 9 }, (_, i) => line.slice(i, i + 10)));
  for (const value of [
    { key: `${BEGIN}\n${BODY.join('\n')}\n${END}` },
    { key: `${BEGIN}\n${BODY.join('\n')}` },
    { note: 'rotated', parts: [BEGIN, ...BODY, END] },
    `${BEGIN}\n${BODY.join('\n')}\n${END}`,
  ]) {
    const { linked } = await surfaces(t, withReport(value), { extra });
    assert.deepEqual(linked[0].finalAnswer, { text: '', redacted: true }, JSON.stringify(value).slice(0, 60));
  }
});
