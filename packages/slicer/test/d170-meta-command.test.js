// D170 (the owner, 2026-10-28: "the harness companion fix (broad form)"): an `isMeta` row whose text is only the
// recorder's own command elements is the harness's (labels.js `LABEL_BASIS.metaCommand`, `meta_command`), never the
// person's command. Claude Code writes such a row when it loads a skill beside the person's prompt (2.1.255 and later
// add `turnCompanion: true`); the person's own slash command is a row the person's by its `origin: human` or, with no
// origin, by its typed `promptSource`. Read from the recorder's flag and its command elements only: `turnCompanion`,
// the command's name and every other field are not read, so the row is the harness's with or without the companion
// field, on a helper's row too. It reverses M34's rule (an `isMeta` command row was `human` + `command`, its
// arguments declared unrecorded). D142's `/sonah` turn still opens at the person's typed `/sonah`. Every fixture is
// synthetic; the rows follow the keys Claude Code writes (no recorded text).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { labelClaudeRows, readSession } from '../src/records.js';
import { LABELS, LABEL_BASIS, LABEL_GAPS, MARKERS } from '../src/labels.js';

const base = { sessionId: 'sess-d170', cwd: '/repo', version: '2.1.295', gitBranch: 'main', isSidechain: false,
  userType: 'external', entrypoint: 'claude-desktop' };
let n = 0;
function chain(...specs) {
  let parent = null;
  return specs.map((spec) => {
    const uuid = `d170-${String(++n).padStart(4, '0')}`;
    const row = { ...base, parentUuid: parent, uuid, timestamp: `2026-10-28T12:${String(Math.floor(n / 60) % 60)
      .padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`, ...spec };
    parent = uuid;
    return row;
  });
}
const ask = (text, extra = {}) => ({ type: 'user', origin: { kind: 'human' }, promptSource: 'typed', promptId: 'p1',
  message: { role: 'user', content: text }, ...extra });
const said = (text) => ({ type: 'assistant', message: { role: 'assistant', model: 'claude-x', content: [{ type: 'text',
  text }], stop_reason: 'end_turn' } });
const call = (id, name, input) => ({ type: 'assistant', message: { role: 'assistant', model: 'claude-x',
  content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result',
  tool_use_id: id, content }] } });
const elements = (name) => `<command-name>/${name}</command-name>\n<command-message>${name}</command-message>\n`
  + '<skill-format>true</skill-format>';
/** The skill Claude Code loads beside the person's prompt: `isMeta`, `turnCompanion`, only its command elements. */
const companion = (name = 'drafting', extra = {}) => ({ type: 'user', isMeta: true, turnCompanion: true, promptId: 'p1',
  message: { role: 'user', content: elements(name) }, ...extra });
/** The same shape without `turnCompanion` (no recorded row has it; the rule does not read the field). */
const metaOnly = (name = 'drafting') => ({ type: 'user', isMeta: true, message: { role: 'user', content: elements(name) } });
const expansion = () => ({ type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text',
  text: 'Base directory for this skill: /c/skills/drafting\n\nDraft with care.\n' }] } });
/** A slash command the person typed, as 2.1.308 records it: `origin: human`, the message element, then the name. */
const typed = (name, args) => ({ type: 'user', origin: { kind: 'human' }, message: { role: 'user',
  content: `<command-message>${name}</command-message>\n<command-name>/${name}</command-name>`
    + (args === undefined ? '' : `\n<command-args>${args}</command-args>`) } });
const labelOne = (row) => labelClaudeRows(chain(row))[0];

async function slice(rows) {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-d170-'));
  try {
    const file = join(dir, 'session.jsonl');
    await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return { ledger: await sliceLineage([file]), read: await readSession(file) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const asks = (ledger) => ledger.ask.map((a) => [a.turn, a.text]);
const said_ = (ledger) => (ledger.commentary ?? []).map((c) => [c.turn, c.text]);

test('D170: the basis is closed, and M34\'s prompt_command is gone', () => {
  assert.equal(LABEL_BASIS.metaCommand, 'meta_command');
  assert.equal(Object.values(LABEL_BASIS).includes('prompt_command'), false);
  assert.equal(Object.hasOwn(LABEL_BASIS, 'promptCommand'), false);
});

test('D170: an isMeta row of the command elements is the harness\'s, with or without turnCompanion', () => {
  for (const row of [companion(), metaOnly(), companion('sonah'), metaOnly('sonah'),
    // With an arguments element, and with a tool row's field beside the flag: the flag decides first, as before.
    { ...metaOnly(), message: { role: 'user', content: `${elements('drafting')}\n<command-args>x</command-args>` } },
    { ...companion(), sourceToolUseID: 's1' },
    // D170's review (finding 8): on a helper's row too; the rule reads no field but the flag and the elements.
    { ...companion(), isSidechain: true }, { ...metaOnly(), isSidechain: true }]) {
    const value = labelOne(row);
    assert.deepEqual([value.label, value.basis, value.markers, value.gap], [LABELS.harness, LABEL_BASIS.metaCommand,
      undefined, undefined], JSON.stringify(row.message.content));
  }
  // Any other isMeta row is the harness's as before (`recorder_meta`), and so is one that only looks like a command.
  for (const content of ['Draft with care.', '<command-name>/a</command-name>\n<command-name>/b</command-name>',
    '<command-message>x</command-message>']) {
    const value = labelOne({ type: 'user', isMeta: true, message: { role: 'user', content } });
    assert.deepEqual([value.label, value.basis], [LABELS.harness, LABEL_BASIS.recorderMeta], content);
  }
});

test('D170: a slash command the person typed (origin human, or a typed promptSource) is still the person\'s', () => {
  const withArgs = labelOne(typed('review', 'the parser module'));
  assert.deepEqual([withArgs.label, withArgs.basis, withArgs.markers, withArgs.gap], [LABELS.human,
    LABEL_BASIS.originHuman, [MARKERS.command], undefined]);
  // One the recorder wrote with no arguments element keeps its declared gap: the person's row, the person's loss.
  const bare = labelOne(typed('review'));
  assert.deepEqual([bare.label, bare.basis, bare.markers, bare.gap], [LABELS.human, LABEL_BASIS.originHuman,
    [MARKERS.command], LABEL_GAPS.commandArgsUnrecorded]);
  // With no origin, a row the person's by its recorded promptSource is the person's command the same way.
  const noOrigin = { ...typed('review', 'the parser module'), promptSource: 'typed' };
  delete noOrigin.origin;
  const bySource = labelOne(noOrigin);
  assert.deepEqual([bySource.label, bySource.basis, bySource.markers, bySource.gap], [LABELS.human,
    LABEL_BASIS.promptSourceHuman, [MARKERS.command], undefined]);
});

test('D170: the companion after the person\'s prompt is no ask and opens no turn; the work stays in the prompt\'s turn',
  async () => {
    const { ledger } = await slice(chain(ask('Draft the release notes.'), companion(), expansion(),
      call('w1', 'Write', { file_path: '/repo/NOTES.md', content: 'x' }), result('w1', 'ok'), said('Drafted the notes.'),
      ask('Now shorten them.', { promptId: 'p2' }), said('Shortened.')));
    assert.deepEqual(asks(ledger), [[1, 'Draft the release notes.'], [2, 'Now shorten them.']]);
    assert.deepEqual(said_(ledger), [[1, 'Drafted the notes.'], [2, 'Shortened.']]);
    assert.deepEqual(ledger.ledger.map((e) => [e.turn, e.path]), [[1, 'NOTES.md']]);
    // Counted where labels are counted: the person's two prompts are the human rows; no arguments are said lost.
    assert.equal(ledger.capture.labels.human, 2);
    assert.equal(ledger.capture.labelGaps?.command_args_unrecorded ?? 0, 0);
    assert.equal(JSON.stringify(ledger.ask).includes('/drafting'), false);
  });

test('D170 with D142: the person\'s typed /sonah still opens Sonah\'s turn; a companion of that name does not',
  async () => {
    const LINE = 'Sonah started a review of this session in the background.';
    const sonahExpansion = () => ({ type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text',
      text: `Base directory for this skill: /c/skills/sonah\n\n${LINE}\n` }] } });
    const turnEnd = () => ({ type: 'system', subtype: 'turn_duration', durationMs: 1000, isMeta: false });
    // A companion, then the person's typed /sonah turn, then the person's next ask.
    const { ledger, read } = await slice(chain(ask('Draft the release notes.'), companion(), expansion(),
      said('Drafted.'), typed('sonah'), sonahExpansion(), said(LINE), turnEnd(), ask('Thanks. Push it.', { promptId: 'p3' }),
      said('Pushed.')));
    assert.deepEqual(asks(ledger), [[1, 'Draft the release notes.'], [2, 'Thanks. Push it.']]);
    assert.deepEqual(said_(ledger), [[1, 'Drafted.'], [2, 'Pushed.']]);
    const leftOut = (read.meta.labelled ?? []).filter((x) => x.value?.basis === LABEL_BASIS.sonahTurn).length;
    assert.equal(leftOut, 4, 'the typed command, its expansion, the reply and the turn\'s end');
    assert.equal(JSON.stringify(ledger).includes(LINE), false);
    // A companion named sonah beside the person's prompt is the harness's: the agent's work after it is read.
    const named = await slice(chain(ask('Draft the release notes.'), companion('sonah'), said('Drafted.')));
    assert.deepEqual(asks(named.ledger), [[1, 'Draft the release notes.']]);
    assert.deepEqual(said_(named.ledger), [[1, 'Drafted.']]);
    assert.equal((named.read.meta.labelled ?? []).filter((x) => x.value?.basis === LABEL_BASIS.sonahTurn).length, 0);
  });

test('D170 (review): a companion inside the person\'s typed /sonah turn stays in that turn; nothing of the turn is read',
  async () => {
    const LINE = 'Sonah started a review of this session in the background.';
    const sonahExpansion = () => ({ type: 'user', isMeta: true, message: { role: 'user', content: [{ type: 'text',
      text: `Base directory for this skill: /c/skills/sonah\n\n${LINE}\n` }] } });
    const turnEnd = () => ({ type: 'system', subtype: 'turn_duration', durationMs: 1000, isMeta: false });
    // M34's rule made the companion the person's command: it opened a turn of its own and so ended Sonah's, and the
    // skill's expansion and Sonah's reply after it were read. It is the harness's now, so it ends nothing.
    const { ledger, read } = await slice(chain(ask('Fix the parser.'), said('Fixed.'), typed('sonah'),
      companion('drafting'), sonahExpansion(), said(LINE), turnEnd(), ask('Now add a test.', { promptId: 'p2' }),
      said('Added.')));
    assert.deepEqual(asks(ledger), [[1, 'Fix the parser.'], [2, 'Now add a test.']]);
    assert.deepEqual(said_(ledger), [[1, 'Fixed.'], [2, 'Added.']]);
    const leftOut = (read.meta.labelled ?? []).filter((x) => x.value?.basis === LABEL_BASIS.sonahTurn).length;
    assert.equal(leftOut, 5, 'the typed command, the companion, the expansion, the reply and the turn\'s end');
    assert.equal(JSON.stringify(ledger).includes(LINE), false);
    assert.equal(JSON.stringify(ledger.ask).includes('/drafting'), false);
  });
