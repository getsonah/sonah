// D142 (the owner, 2026-10-23): Sonah's own turn is left out. When the person types
// `/sonah`, Claude Code records a prompt command whose `command-name` element is Sonah's own skill name (labels.js
// `SONAH_SKILL_NAMES`, a name Sonah owns), then the skill's expansion, and the agent's one-line reply. That turn, from the
// command up to the first row that starts other work (a turn that `opensTurn` opens, a queued prompt, a background task's
// notification, another agent's message), is harness (`sonah_turn`) and is not read: the command is no ask, and nothing
// the agent says or does in it is a claim, an action or an observation. Read from the recorded command element and the
// labels' structure, never from the words, and never from where the recording ends: what comes after the turn is read as
// before. The rows follow Claude Code 2.1.308's shapes as a live Claude Code session recorded them. Every fixture is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { labelClaudeRows, readSession } from '../src/records.js';
import { buildEvents } from '../src/events.js';
import { LABEL_BASIS, LABELS, MARKERS, SONAH_SKILL_NAMES } from '../src/labels.js';

const base = { sessionId: 'sess-d142', cwd: '/repo', version: '2.1.308', gitBranch: 'main', isSidechain: false,
  userType: 'external', entrypoint: 'cli' };
let n = 0;
function chain(...specs) {
  let parent = null;
  return specs.map((spec) => {
    const uuid = `d142-${String(++n).padStart(4, '0')}`;
    const row = { ...base, parentUuid: parent, uuid, timestamp: `2026-10-23T12:${String(Math.floor(n / 60) % 60)
      .padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`, ...spec };
    parent = uuid;
    return row;
  });
}
const ask = (text) => ({ type: 'user', origin: { kind: 'human' }, promptSource: 'typed', message: { role: 'user',
  content: text } });
const said = (text) => ({ type: 'assistant', message: { role: 'assistant', model: 'claude-x', content: [{ type: 'text',
  text }], stop_reason: 'end_turn' } });
const call = (id, name, input) => ({ type: 'assistant', message: { role: 'assistant', model: 'claude-x',
  content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result',
  tool_use_id: id, content }] } });
/** The typed `/name` row, as 2.1.308 records a skill's command: the message element, then the name element. */
const command = (name) => ({ type: 'user', origin: { kind: 'human' }, message: { role: 'user',
  content: `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>` } });
/** The same command as 2.1.255 and later record it on an `isMeta` row: only the recorder's command elements. */
const metaCommand = (name) => ({ type: 'user', isMeta: true, message: { role: 'user',
  content: `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n<skill-format>true</skill-format>` } });
const LINE = 'Sonah started a review of this session in the background. When it ends, Sonah opens /s/review.html.';
const expansion = () => ({ type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text',
  text: `Base directory for this skill: /c/skills/sonah\n\n${LINE}\n\nReply with the line above only, word for word.\n` }] } });
const permissions = () => ({ type: 'attachment', attachment: { type: 'command_permissions', allowedTools: ['Bash(sonah review *)'] } });
const turnEnd = () => ({ type: 'system', subtype: 'turn_duration', durationMs: 1000, isMeta: false });
/** One `/sonah` turn as a live session recorded it: the command, the expansion, its attachment, the reply, the turn's end. */
const sonahTurn = (name = 'sonah', form = command) => [form(name), expansion(), permissions(), said(LINE), turnEnd()];

async function slice(rows) {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-d142-'));
  try {
    const file = join(dir, 'session.jsonl');
    await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const ledger = await sliceLineage([file]);
    const read = await readSession(file);
    return { ledger, read };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const asks = (ledger) => ledger.ask.map((a) => [a.turn, a.text]);
const said_ = (ledger) => (ledger.commentary ?? []).map((c) => c.text);
const leftOut = (read) => (read.meta.labelled ?? []).filter((x) => x.value?.basis === LABEL_BASIS.sonahTurn).length;

test('D142: Sonah\'s skill names are Sonah\'s own, and the turn\'s basis is in the closed set', () => {
  assert.deepEqual(SONAH_SKILL_NAMES, ['sonah']);
  assert.equal(LABEL_BASIS.sonahTurn, 'sonah_turn');
});

test('D142: a /sonah turn mid-session and at the end is not read; the asks before and after it are', async () => {
  const rows = chain(ask('Add a negate function to math.js.'), call('t1', 'Edit', { file_path: '/repo/math.js',
    old_string: 'a', new_string: 'b' }), result('t1', 'ok'), said('Done: negate is in math.js.'),
  ...sonahTurn(),
  ask('Now add a test for negate.'), call('t2', 'Write', { file_path: '/repo/math.test.js', content: 'x' }),
  result('t2', 'ok'), said('Added the test.'),
  ...sonahTurn());
  const { ledger, read } = await slice(rows);
  // The golden: two asks, in turns 1 and 2 (no turn for either /sonah); the agent's own words of those turns only; the
  // two actions; the two /sonah turns' rows counted as harness and kept as no record.
  assert.deepEqual(asks(ledger), [[1, 'Add a negate function to math.js.'], [2, 'Now add a test for negate.']]);
  assert.deepEqual(said_(ledger), ['Done: negate is in math.js.', 'Added the test.']);
  assert.deepEqual(ledger.ledger.map((e) => e.path), ['math.js', 'math.test.js']);
  assert.equal(leftOut(read), 10, 'five rows of each /sonah turn');
  assert.equal(read.records.some((r) => r.basis === LABEL_BASIS.sonahTurn), false);
  assert.equal(ledger.capture.labels.human, 2);
  assert.equal(JSON.stringify(ledger).includes('Sonah started a review'), false, 'nothing of the turn is read');
});

test('D142: the turn ends at the next human prompt, never at the end of the recording; a refusal stays inside it',
  async () => {
    const rows = chain(ask('Fix the parser.'), said('Fixed.'), ...sonahTurn(),
      // A person's message after /sonah, the last human prompt of the recording: it is read.
      ask('One more thing: rename parse to parseInput.'), call('t3', 'Edit', { file_path: '/repo/p.js', old_string: 'a',
        new_string: 'b' }), result('t3', 'ok'), said('Renamed.'));
    const { ledger } = await slice(rows);
    assert.deepEqual(asks(ledger), [[1, 'Fix the parser.'], [2, 'One more thing: rename parse to parseInput.']]);
    assert.deepEqual(said_(ledger), ['Fixed.', 'Renamed.']);
    // A refusal the person gives inside the /sonah turn is that turn's, and is not read either.
    const refused = chain(ask('Fix the parser.'), said('Fixed.'), command('sonah'), expansion(),
      call('t4', 'Bash', { command: 'sonah review' }),
      { type: 'user', toolDenialKind: 'user-rejected', message: { role: 'user', content: [{ type: 'tool_result',
        tool_use_id: 't4', is_error: true, content: 'The user rejected this.' }] } }, said(LINE));
    const second = await slice(refused);
    assert.deepEqual(asks(second.ledger), [[1, 'Fix the parser.']]);
    assert.deepEqual(said_(second.ledger), ['Fixed.'], 'the reply after the refusal is still the turn\'s');
    assert.deepEqual(second.ledger.ledger, [], 'no action of the turn');
    assert.equal(second.ledger.interjections?.length ?? 0, 0);
  });

test('D142: by the recorded command name only: another command stays an ask, and so does a name that only looks alike',
  async () => {
    for (const name of ['review', 'sonah-notes', 'my-sonah', 'Sonah']) {
      const { ledger } = await slice(chain(ask('Fix the parser.'), said('Fixed.'), ...sonahTurn(name)));
      assert.deepEqual(asks(ledger).map(([, text]) => text), ['Fix the parser.', `/${name}`], name);
    }
    // The words "/sonah" typed as plain text are a message like any other: no recorded command element names a skill.
    const typed = await slice(chain(ask('Fix the parser.'), said('Fixed.'), ask('/sonah please'), said('ok')));
    assert.deepEqual(asks(typed.ledger).map(([, text]) => text), ['Fix the parser.', '/sonah please']);
  });

test('D142: the isMeta form of the command (Claude Code 2.1.255 and later) is left out the same way', async () => {
  const { ledger, read } = await slice(chain(ask('Fix the parser.'), said('Fixed.'), ...sonahTurn('sonah', metaCommand)));
  assert.deepEqual(asks(ledger), [[1, 'Fix the parser.']]);
  assert.deepEqual(said_(ledger), ['Fixed.']);
  assert.equal(leftOut(read), 5);
});

test('D142: from the frozen bytes: a recording that ends at the /sonah row leaves that row out, and nothing before it',
  async () => {
    const rows = chain(ask('Fix the parser.'), said('Fixed.'), command('sonah'));
    const { ledger, read } = await slice(rows);
    assert.deepEqual(asks(ledger), [[1, 'Fix the parser.']]);
    assert.deepEqual(said_(ledger), ['Fixed.']);
    assert.equal(leftOut(read), 1);
  });

test('D142: the labels: harness, `sonah_turn`, each row whole; a helper\'s rows and a compaction keep their own', () => {
  const rows = chain(ask('Fix it.'), ...sonahTurn(),
    { type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', compactMetadata: { trigger: 'manual' } },
    { ...said('a helper talks'), isSidechain: true }, ask('Next.'));
  const labelled = labelClaudeRows(rows);
  assert.deepEqual(labelled.map((rec) => [rec.label, rec.basis]), [
    [LABELS.human, LABEL_BASIS.originHuman],
    ...Array(5).fill([LABELS.harness, LABEL_BASIS.sonahTurn]),
    [LABELS.harness, LABEL_BASIS.compactBoundary],
    [LABELS.thought, LABEL_BASIS.assistantText],
    [LABELS.human, LABEL_BASIS.originHuman]]);
  assert.equal(labelled[1].markers, undefined, 'the command carries no human marker any more');
  assert.ok(!labelled.slice(1, 6).some((rec) => (rec.markers ?? []).includes(MARKERS.command)));
});

test('D142: records labelled outside the reader are not read either, whoever builds the events', () => {
  const records = labelClaudeRows(chain(ask('Fix it.'), said('Fixed.'), ...sonahTurn()));
  const built = buildEvents(records, { cwd: '/repo' });
  assert.deepEqual(built.ask.map((a) => a.text), ['Fix it.']);
  assert.deepEqual(built.commentary.map((c) => c.text), ['Fixed.']);
});

const notification = (callId) => ({ type: 'user', isMeta: false, origin: { kind: 'task-notification' }, message: {
  role: 'user', content: `<task-notification>\n<task-id>bg1</task-id>\n<tool-use-id>${callId}</tool-use-id>\n`
    + '<status>completed</status>\n<summary>Background command "npm test" finished</summary>\n</task-notification>' } });
const edit = (id, path) => call(id, 'Edit', { file_path: path, old_string: 'a', new_string: 'b' });

test('D142: work that something other than Sonah starts after the turn is read: a notification, a peer, a queued prompt',
  async () => {
    // A background run that ends after /sonah: Claude Code wakes the agent with its notification, and the agent's edit and
    // claim then are its own work, read as before.
    const rows = chain(ask('Run the tests in the background.'), call('bg', 'Bash', { command: 'npm test',
      run_in_background: true }), result('bg', 'Command running in background with ID: bg1'), said('Started.'),
    ...sonahTurn(), notification('bg'), edit('e1', '/repo/x.js'), result('e1', 'ok'),
    said('Tests failed; I fixed x.js and all tests pass now.'), turnEnd());
    const { ledger, read } = await slice(rows);
    assert.deepEqual(ledger.ledger.map((e) => [e.kind, e.path ?? '']), [['bash', ''], ['edit', 'x.js']]);
    assert.deepEqual(said_(ledger), ['Started.', 'Tests failed; I fixed x.js and all tests pass now.']);
    assert.equal(leftOut(read), 5, 'only the /sonah turn');
    // Another agent's message.
    const peer = await slice(chain(ask('Fix it.'), said('Fixed.'), ...sonahTurn(), { type: 'user', origin: { kind: 'peer' },
      message: { role: 'user', content: 'From the reviewer agent: please also fix y.js.' } }, edit('e2', '/repo/y.js'),
    result('e2', 'ok'), said('Fixed y.js.')));
    assert.deepEqual(peer.ledger.ledger.map((e) => e.path), ['y.js']);
    assert.deepEqual(said_(peer.ledger), ['Fixed.', 'Fixed y.js.']);
    // A message the person queued while the turn ran.
    const queued = await slice(chain(ask('Fix it.'), said('Fixed.'), command('sonah'), expansion(), { type: 'attachment',
      attachment: { type: 'queued_command', commandMode: 'prompt', prompt: 'Also rename x.', origin: { kind: 'human' } } },
    edit('e3', '/repo/x.js'), result('e3', 'ok'), said('Renamed x.')));
    assert.deepEqual(queued.ledger.ledger.map((e) => e.path), ['x.js']);
    assert.deepEqual(said_(queued.ledger), ['Fixed.', 'Renamed x.']);
    assert.equal(leftOut(queued.read), 2, 'the command and its expansion');
  });

test('D142: another prompt command after the turn, and a message beside a tool result, open their own turns', async () => {
  const other = await slice(chain(ask('Fix it.'), said('Fixed.'), ...sonahTurn(), command('review'), said('Reviewed.')));
  assert.deepEqual(asks(other.ledger), [[1, 'Fix it.'], [2, '/review']]);
  assert.deepEqual(said_(other.ledger), ['Fixed.', 'Reviewed.']);
  // A user row with a tool result and the person's own words: `opensTurn` opens a turn on it, so it ends Sonah's.
  const mixed = await slice(chain(ask('Fix it.'), said('Fixed.'), command('sonah'), expansion(),
    call('m1', 'Bash', { command: 'ls' }), { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'm1', content: 'a.js' }, { type: 'text', text: 'Please also add a README.' }] } },
    call('w9', 'Write', { file_path: '/repo/README.md', content: 'x' }), result('w9', 'ok'), said('Added.')));
  assert.deepEqual(asks(mixed.ledger), [[1, 'Fix it.'], [2, 'Please also add a README.']]);
  assert.deepEqual(mixed.ledger.ledger.map((e) => e.path), ['README.md']);
});

test('D142: inside the turn, a call and its result, and the person\'s answer to a question, are not read', async () => {
  const rows = chain(ask('Fix it.'), call('f1', 'Edit', { file_path: '/repo/a.js', old_string: 'a', new_string: 'b' }),
    result('f1', 'ok'), said('Fixed.'), command('sonah'), expansion(),
    call('b1', 'Bash', { command: 'sonah review' }), result('b1', 'started'),
    call('q1', 'AskUserQuestion', { questions: [{ question: 'Open the page?' }] }),
    { type: 'user', toolUseResult: { questions: [{ question: 'Open the page?' }], answers: { 'Open the page?': 'Yes' } },
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q1', content: 'User answered: Yes' }] } },
    said(LINE), turnEnd());
  const { ledger } = await slice(rows);
  assert.deepEqual(asks(ledger), [[1, 'Fix it.']]);
  assert.deepEqual(said_(ledger), ['Fixed.']);
  assert.deepEqual(ledger.ledger.map((e) => e.path), ['a.js']);
  assert.equal(ledger.capture.labels.observation, 1, 'only the edit\'s result is an observation');
  assert.equal(ledger.interjections?.length ?? 0, 0, 'the answer is not read');
});

test('D142: the turn does not end at its own end row: rows after it that start no work stay in it', async () => {
  const caveat = { type: 'user', isMeta: true, message: { role: 'user', content:
    '<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>' } };
  // A local command the person runs after /sonah (D120: harness, also in Claude Code 2.1.295's form with `origin: human`)
  // starts no work: it stays in the turn, and so does what follows it until something does.
  for (const origin of [{}, { origin: { kind: 'human' } }]) {
    const rows = chain(ask('Fix it.'), said('Fixed.'), ...sonahTurn(), said('A late line with no turn of its own.'),
      caveat, { type: 'user', ...origin, message: { role: 'user', content: '<command-name>/cost</command-name>\n'
        + '<command-message>cost</command-message>\n<command-args></command-args>' } },
      { type: 'system', subtype: 'local_command', level: 'info', isMeta: false, content: '<local-command-stdout>$0.10</local-command-stdout>' },
      said('Another late line.'));
    const { ledger, read } = await slice(rows);
    assert.deepEqual(asks(ledger), [[1, 'Fix it.']], JSON.stringify(origin));
    assert.deepEqual(said_(ledger), ['Fixed.'], JSON.stringify(origin));
    assert.equal(leftOut(read), 10, 'the 5 rows of the turn, the late lines and the 3 rows of /cost');
  }
});

test('D142: a command whose arguments hold Sonah\'s name is not Sonah\'s', async () => {
  const args = { type: 'user', origin: { kind: 'human' }, message: { role: 'user',
    content: '<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>sonah</command-args>' } };
  const { ledger } = await slice(chain(ask('Fix it.'), said('Fixed.'), args, said('Reviewed.')));
  assert.deepEqual(asks(ledger), [[1, 'Fix it.'], [2, '/review sonah']]);
  assert.deepEqual(said_(ledger), ['Fixed.', 'Reviewed.']);
});
