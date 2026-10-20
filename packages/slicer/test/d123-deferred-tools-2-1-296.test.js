// D123 (2026-10-19, the beta.5 end-to-end smoke): Claude Code writes its `deferred_tools_delta` attachment with the
// payload key `surfacedDefinitions` (beside `surfacedNames`: one `{ name, listing, definition }` per tool it names; seen
// in the owner's recordings of recorder 2.1.295, 2.1.296 and 2.1.299), which the reader's shape for that attachment did
// not list. Every such row was unclassified, so a report on such a recording said that the session evidence was
// incomplete and that a record had a form Sonah cannot read, and a decision could not be checked against your messages.
// The key is now listed as data (records.js CLAUDE_ATTACHMENTS): the row is harness context, counted, with no gap. Its
// value is never read for a class or a label, and a key the reader does not list still leaves the row unclassified and
// declared (fail closed).
// D123's review: the release note says which row is read, never that a recorder version is read whole. The same recorder
// writes other rows that the reader does not list (a `budget_usd` attachment, for one), and those still leave a
// recording incomplete.
//
// Every row here is synthetic and mirrors only the recorder's key sets as it writes them; no real recording is read and
// nothing here holds a secret.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage, hasCaptureGaps } from '../index.js';
import { readSession, claudeRowClass, CLAUDE_ROW_CLASSES } from '../src/records.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

const SESSION = 'd123d123-0000-4000-8000-000000002296';
let seq = 0;
const uid = () => `d123-${String(++seq).padStart(6, '0')}`;
// The row keys 2.1.296 writes on this attachment, `rendered` and `renderedRole` among them.
const row = (extra) => ({ cwd: '/repo', entrypoint: 'sdk-cli', gitBranch: 'HEAD', isSidechain: false, parentUuid: null,
  sessionId: SESSION, timestamp: '2026-10-19T17:37:27.000Z', userType: 'external', uuid: uid(), version: '2.1.296',
  ...extra });
const RENDERED = [{ content: 'Synthetic rendered tool listing.' }];
const tool = (name) => ({ name, listing: `${name}: a synthetic tool.`, definition: { name, description: 'Synthetic.',
  input_schema: { type: 'object', properties: {} } } });
/** The `deferred_tools_delta` payload in the shape 2.1.296 writes it: every key it carries, `surfacedDefinitions` too. */
const delta = (extra = {}) => ({ type: 'deferred_tools_delta', addedNames: ['ToolA', 'ToolB'],
  addedLines: ['ToolA', 'ToolB'], removedNames: [], wireHiddenNames: [], readdedNames: [], pendingMcpServers: [],
  needsAuthMcpServers: [], failedMcpServers: [], surfacedNames: ['ToolA', 'ToolB'],
  surfacedDefinitions: [tool('ToolA'), tool('ToolB')], ...extra });
const attachment = (payload) => row({ type: 'attachment', attachment: payload, rendered: RENDERED,
  renderedRole: 'system' });
const ask = (text) => row({ type: 'user', origin: { kind: 'human' }, promptSource: 'typed',
  message: { role: 'user', content: text } });
const bash = (id) => row({ type: 'assistant', message: { role: 'assistant', content: [
  { type: 'tool_use', id, name: 'Bash', input: { command: 'node --test' } }] } });
const result = (id) => row({ type: 'user', message: { role: 'user', content: [
  { type: 'tool_result', tool_use_id: id, content: 'pass 1\nfail 0' }] } });

async function recording(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-d123-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${SESSION}.jsonl`);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}
const gapsOf = async (file) => sessionFromLedger(redact(await sliceLineage([file], { cwd: '/repo' })).ledger).adapterGaps;

test('D123: the 2.1.296 deferred_tools_delta row, surfacedDefinitions and all, is harness context with no gap', async (t) => {
  assert.equal(claudeRowClass(attachment(delta()))?.cls, CLAUDE_ROW_CLASSES.harness);
  const file = await recording(t, [ask('Run the tests.'), attachment(delta()), bash('b-1'), result('b-1')]);
  const parsed = await readSession(file);
  assert.equal(parsed.meta.capture.unclassifiedRows, undefined);
  assert.equal(parsed.meta.capture.harnessContextRows, 1);
  assert.equal(parsed.meta.capture.incomplete, false);
  const ledger = await sliceLineage([file], { cwd: '/repo' });
  assert.equal(hasCaptureGaps(ledger), false);
  assert.deepEqual((await gapsOf(file)).filter((gap) => gap.code === 'unsupported_message'), []);
});

test('D123: a payload key that the reader does not list still leaves the row unclassified and declared', async (t) => {
  const drift = attachment(delta({ surfacedSchemas: [] }));
  assert.equal(claudeRowClass(drift), null);
  const file = await recording(t, [ask('Run the tests.'), drift, bash('b-1'), result('b-1')]);
  const parsed = await readSession(file);
  assert.equal(parsed.meta.capture.unclassifiedRows, 1);
  assert.ok((await gapsOf(file)).some((gap) => gap.code === 'unsupported_message' && gap.count === 1));
});

/** The 0.3.0-beta.5 section of the CHANGELOG, the release that D123 ships in: what it says it changes. */
const releaseNote = async () => {
  const text = await readFile(new URL('../../../CHANGELOG.md', import.meta.url), 'utf8');
  const at = text.indexOf('## 0.3.0-beta.5');
  assert.ok(at >= 0, 'the CHANGELOG has a 0.3.0-beta.5 section');
  return text.slice(at, text.indexOf('\n## ', at + 1));
};

test('D123\'s review: the reader takes the row by its keys whatever the recorder version; a budget row of the same '
  + 'recorder is still unread, so the release note names the row it reads, not a version read whole', async (t) => {
  // The row is read by its keys alone: recorder 2.1.295 writes the same key.
  assert.equal(claudeRowClass({ ...attachment(delta()), version: '2.1.295' })?.cls, CLAUDE_ROW_CLASSES.harness);
  // A `budget_usd` attachment, keyed as the recorder writes it, is not a shape the reader lists: unclassified, declared.
  const budget = attachment({ type: 'budget_usd', total: 5, used: 1.25, remaining: 3.75 });
  assert.equal(claudeRowClass(budget), null);
  const file = await recording(t, [ask('Run the tests.'), attachment(delta()), budget, bash('b-1'), result('b-1')]);
  const parsed = await readSession(file);
  assert.deepEqual([parsed.meta.capture.harnessContextRows, parsed.meta.capture.unclassifiedRows,
    parsed.meta.capture.incomplete], [1, 1, true]);
  // So the release note claims the row, and names a row that is still unread; it says no recording is read whole.
  const note = (await releaseNote()).replace(/\s+/g, ' ');
  assert.ok(!/\bare read whole\b/i.test(note), 'the note says that recordings of a version are read whole');
  assert.ok(note.includes('lists its deferred tools with their definitions'), 'the note names the row that is read');
  assert.ok(note.includes('`budget_usd`'), 'the note names a row that is still unread');
});
