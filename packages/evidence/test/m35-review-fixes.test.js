// M35 windowing review (2026-10-07, of 644792d–06e3523; C-07 "M35 windowing", D67): each confirmed finding, read on what
// a window or a judge actually receives. A request is read byte for byte — never through `readingStableIds`
// (m35-windows-fixture.js), which writes every alias back as a stable id and so cannot see an id a request names that
// its evidence never showed by that name.
//
// Synthetic recordings (the repository's own forbidden-edit rows, read through the real slicer, redactor and adapter)
// and hand-built sessions in the adapter's shape. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { Session } from '../src/session.js';
import { loadSessionEvidence } from '../../cli/src/session-evidence.js';
import { claudeTree, claudeParentRows, claudeAgentRows, claudeRow } from '../../cli/test/m33-p-placement-fixture.js';
import { runReview, planWindowRequests } from '../src/run-review.js';
import { shownFields, bytesOfTokens, WINDOW_SETTINGS, COMBINED_WINDOW_SETTINGS } from '../src/windows.js';
import { MAX_REVIEW_INPUT_BYTES } from '../src/challenge.js';
import * as R from './m33-n-forbidden-edit-rows.js';
import * as X from './m33-n-forbidden-edit-repair-rows.js';

const PROFILES = [null, 'm33-fast', 'm33-lean'];

async function sessionOfRows(t, rows, name) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m35-review-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, name);
  await writeFile(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return sessionFromLedger(redact(await sliceLineage([path], { cwd: '/repo' })).ledger, { sessionKey: 'm35-review' });
}
const textOf = (session, event) => session.textSpansOf(event, 'text').join('');
const idOf = (session, test) => session.events.find(test)?.id;
const instructionWith = (session, words) => idOf(session, (e) => e.kind === 'instruction' && textOf(session, e).includes(words));
const writeOf = (session) => idOf(session, (e) => e.kind === 'invocation' && e.operation === 'write');
const receipt = (eventId, role, quote) => ({ eventId, role, quote });

const CANDIDATES = '\n# Candidates to challenge\n';
/** A challenge request as its judge reads it: the evidence it was shown, and the candidates parsed from its own JSON. */
function shownOf(request) {
  const at = request.prompt.lastIndexOf(CANDIDATES);
  assert.ok(at > 0, 'the request carries its candidates');
  // D71 (S2): a session-only batch gives its candidates one per line.
  const tail = request.prompt.slice(at + CANDIDATES.length);
  return { evidence: request.prompt.slice(0, at), candidates: tail.startsWith('[') ? JSON.parse(tail)
    : tail.split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
}
/** Every event id a shown value names: each `eventId`, and each entry of any list of strings (an id list). */
function idsNamed(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) if (typeof item === 'string') out.push(item); else idsNamed(item, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'eventId' && typeof item === 'string') out.push(item);
      else idsNamed(item, out);
    }
  }
  return out;
}

// ---- R1: a forbidden edit's candidate names every event by the window's aliases ------------------------------------------

test('M35 review R1: a forbidden edit\'s candidate names every event it lists by the window\'s aliases, as its evidence does', async (t) => {
  const cases = [
    // A later human instruction that lifted the constraint (`humanInstructionsBetween`), shown in the inventory.
    { session: await sessionOfRows(t, R.claudeRows({ between: 'lift' }), `${R.SESSION}.jsonl`), list: 'humanInstructionsBetween',
      instruction: R.WORDS.constraint, origin: R.WORDS.origin, words: R.WORDS.lift, heading: 'HUMAN INSTRUCTION' },
    // A plan the human approved between them (`humanChoicesBetween`), shown whole with its result.
    { session: await sessionOfRows(t, X.claudeRows('plan'), `${X.SESSION}.jsonl`), list: 'humanChoicesBetween',
      instruction: X.WORDS.human, origin: X.WORDS.origin, words: X.WORDS.approved, heading: 'ACTION' },
  ];
  for (const { session, list, instruction, origin, words, heading } of cases) {
    const edit = { text: 'The agent wrote what the human ruled out.',
      instruction: receipt(instructionWith(session, instruction), 'instruction', instruction),
      violation: receipt(writeOf(session), 'code', origin) };
    const stable = new Set(session.events.map((event) => event.id));
    for (const profile of PROFILES) {
      const label = `${list}, ${profile}`;
      const sent = [];
      // The judge reads the request it is handed, byte for byte. Its narrative cites stable ids (an id the alias table
      // does not hold passes back unchanged); its votes are uncertain, so nothing here depends on how they are read.
      await runReview({ session, pr: null, reviewScope: 'session-only', ...(profile ? { speedProfile: profile } : {}),
        judge: async (request) => {
          sent.push(request);
          if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'uncertain',
            explanation: 'Synthetic.', receipts: [] })) };
          const asked = `${request.system}${request.prompt}`.includes('"forbiddenEdits"') && request.window?.index === 0;
          return { decisions: [], pivots: [], claims: [], requirements: [], ...(asked ? { forbiddenEdits: [edit] } : {}) };
        } });
      const forbidden = sent.filter((request) => request.challenge && request.label.includes(':forbidden'));
      assert.ok(forbidden.length >= 1, `${label}: the edit was put to the challengers`);
      for (const request of forbidden) {
        const { evidence, candidates } = shownOf(request);
        const [shown] = candidates;
        assert.equal(shown.candidate[list].length, 1, `${label}: premise, one event between them`);
        const named = idsNamed(shown.candidate);
        for (const id of named) {
          assert.match(id, /^E\d+$/, `${label}: an alias, never a stable id`);
          assert.ok(evidence.includes(`[${id}] `), `${label}: ${id} is an event the same request's evidence shows`);
        }
        assert.ok(!named.some((id) => stable.has(id)), `${label}: no stable id reaches the challenger`);
        // The listed event is the one holding the words that may have lifted the constraint, shown under that alias: in
        // its own block, or in the block of its result (`RESULT of <alias>`).
        const [listed] = shown.candidate[list];
        const blocks = evidence.split('\n[').map((block) => `[${block}`);
        assert.ok(blocks.some((block) => block.startsWith(`[${listed}] ${heading}`)), `${label}: shown as ${heading}`);
        const its = blocks.filter((block) => block.startsWith(`[${listed}] `)
          || new RegExp(`^\\[E\\d+\\] [^\\n]* of ${listed} ·`).test(block));
        assert.ok(its.some((block) => block.includes(words)), `${label}: the lifting words, under its alias`);
      }
    }
  }
});

// ---- R5: an edit's removed side is shown in full -----------------------------------------------------------------------

const EDIT_SESSION = 'c0ffee00-0000-4000-8000-00000000b035';
let uuid = 0;
const row = (extra) => ({ cwd: '/repo', entrypoint: 'claude-desktop', gitBranch: 'main', isSidechain: false,
  parentUuid: null, sessionId: EDIT_SESSION, timestamp: '2026-10-07T00:00:00Z', userType: 'external',
  uuid: `m35-r5-${++uuid}`, version: '2.1.284', ...extra });
const human = (text) => row({ type: 'user', origin: { kind: 'human' }, promptSource: 'sdk', message: { role: 'user', content: text } });
const agentSaid = (text) => row({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolCall = (id, name, input) => row({ type: 'assistant', message: { role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content, sidecar) => row({ type: 'user', toolUseResult: sidecar,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });

test('M35 review R5 (M36 H): an Edit whose first part carries the file as found shows its own replaced text whole — never the file', async (t) => {
  // A Claude Code Edit of one line in the middle of a file far over the trim (2k tokens): the recorder keeps the file as
  // found (`originalFile`), and the adapter puts it in place of the edit's own replaced text on its first change.
  uuid = 0;
  const FILE = '/repo/src/config.js';
  const filler = (tag) => Array.from({ length: 300 }, (_, i) => `// ${tag} filler line ${i} of the synthetic config.`).join('\n');
  const replaced = "export const retries = 3; // SYNTHETIC_M35_R5_REPLACED";
  const written = "export const retries = 5;";
  const original = `${filler('head')}\n${replaced}\n${filler('tail')}\n`;
  assert.ok(Buffer.byteLength(original) > bytesOfTokens(WINDOW_SETTINGS.trimTokens), 'premise: over the trim');
  const session = await sessionOfRows(t, [human('Raise the retries in src/config.js.'),
    toolCall('e1', 'Edit', { file_path: FILE, old_string: replaced, new_string: written }),
    toolResult('e1', `The file ${FILE} has been updated successfully.`, { filePath: FILE, oldString: replaced,
      newString: written, originalFile: original, replaceAll: false, structuredPatch: [], userModified: false }),
    agentSaid('Raised the retries.')], `${EDIT_SESSION}.jsonl`);
  const edit = session.events.find((e) => e.kind === 'invocation' && e.operation === 'edit');
  assert.equal(edit.changes[0].extent.priorState, 'first-write', 'premise: the file as found stands in for the replaced text');
  assert.ok(session.textSpansOf(edit.changes[0], 'before').join('').includes(replaced), 'premise: and holds it');
  // M36 phase 2 (D68 H; C-07 "M36 window format"): the adapter keeps the Edit's own replaced text beside the file state
  // (`replaced`), and a window shows that — whole — and never inlines the file as found (it says it exists, and how to
  // ask for a line range of it).
  assert.equal(session.textSpansOf(edit.changes[0], 'replaced').join(''), replaced, 'the Edit\'s own replaced text');
  const fields = shownFields(session, edit);
  const removed = fields.find((field) => field.holder === edit.changes[0] && field.field === 'replaced');
  assert.equal(removed.omittedBytes, 0, 'the removed side is never trimmed');
  assert.equal(fields.some((field) => field.field === 'before'), false, 'the file as found is not inlined');
  for (const reviewScope of ['session-only', 'combined']) {
    const [built] = planWindowRequests({ session, reviewScope }).requests;
    assert.ok(built.request.prompt.includes(replaced), `${reviewScope}: the replaced line is shown`);
    assert.ok(!built.request.prompt.includes('head filler line 150'), `${reviewScope}: the file as found is not`);
    assert.match(built.request.prompt, /config\.js as recorded before \[[^\]]+\] \(601 line\(s\), [\d,]+ bytes\) is not shown/);
    assert.ok(built.sourceMap[edit.id].some((source) => source.role === 'code' && source.text.includes(replaced)),
      `${reviewScope}: and quotable as code`);
    assert.ok(!built.sourceMap[edit.id].some((source) => source.text.includes('head filler line 150')));
  }
  // A whole-file write's prior state is the file as a Read found it: not inlined either.
  const write = { ...edit, operation: 'write', changes: edit.changes.map(({ replaced: _, replacedExtent: __, ...change }) => change) };
  assert.equal(shownFields(session, write).some((field) => field.field === 'before'), false);
});

// ---- R4: what a session that grows moves --------------------------------------------------------------------------------

/** A hand-built session in the adapter's shape: the root asks three things and delegates once; the helper (`h`) is
 *  recorded after every root event (`grownHelper`: the parent continues it, recorded last), and `grownRoot` records a
 *  fourth root task after everything else — a live session recorded on. */
function growing({ grownHelper = false, grownRoot = false } = {}) {
  const blobs = {};
  let n = 0;
  const ref = (text) => { const key = `g${++n}`; blobs[key] = text; return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text) }]; };
  const tokens = (k, fill) => fill.repeat(bytesOfTokens(k));
  const ask = (id, text, over = {}) => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(text), ...over });
  const said = (id, text, over = {}) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null, text: ref(text), ...over });
  const H = { childId: 'h' };
  const events = [ask('I1', 'Do task one.'), { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Agent', operation: 'delegate',
    paths: [], command: [], input: ref('Helper: survey the repo.'), changes: [] },
  ask('I2', 'Do task two.'), said('C2', tokens(150_000, 'x')), ask('I3', 'Do task three.'), said('C3', tokens(150_000, 'y')),
  ask('child:h:I1', 'Helper: survey the repo.', { authority: 'agent', ...H }), said('child:h:C1', tokens(100_000, 'h'), H),
  ...(grownHelper ? [ask('child:h:I2', 'Helper: now survey the tests.', { authority: 'agent', ...H }),
    said('child:h:C2', tokens(150_000, 'k'), H)] : []),
  ...(grownRoot ? [ask('I4', 'Do task four.'), said('C4', tokens(150_000, 'z'))] : [])];
  return new Session({ sessionKey: 'm35-growth', adapter: 'claude', blobs,
    events: events.map((event, sequence) => ({ ...event, sequence })),
    children: [{ childId: 'h', state: 'verified', assignmentEvent: 'D1', relation: 'spawn' }] });
}
const planned = (session) => planWindowRequests({ session, reviewScope: 'session-only' }).requests
  .map((built) => ({ events: built.window.events.map((event) => event.id).join(','), helper: built.window.session.helper,
    prompt: built.request.prompt }));

test('M35 review R4: a root session that grows at its end never moves an earlier window, its helpers\' windows included', () => {
  const before = planned(growing()), after = planned(growing({ grownRoot: true }));
  assert.deepEqual(before.map((w) => [w.helper, w.events]), [[false, 'I1,D1,I2,C2'], [true, 'child:h:I1,child:h:C1'],
    [false, 'I3,C3']]);
  assert.equal(after.length, before.length + 1, 'its new segment is a window after every earlier one');
  for (const [at, window] of before.entries()) assert.equal(after[at].prompt, window.prompt, `window ${at + 1}: the same request`);
});

test('M35 review R4 (C-07 (4), (8) as amended): a helper that grows renumbers every window after its own in review order', async (t) => {
  // Planner order: a helper's windows follow the root window that launched it, so one more helper window moves the index
  // — and the request's `window N` line — of every later window, a root window recorded before the growth included.
  const before = planned(growing()), after = planned(growing({ grownHelper: true }));
  assert.deepEqual(after.map((w) => [w.helper, w.events]), [[false, 'I1,D1,I2,C2'], [true, 'child:h:I1,child:h:C1'],
    [true, 'child:h:I2,child:h:C2'], [false, 'I3,C3']]);
  for (const at of [0, 1]) assert.equal(after[at].prompt, before[at].prompt, `window ${at + 1}, before the growth in review order`);
  assert.notEqual(after[3].prompt, before[2].prompt, 'the later root window is asked again');
  assert.equal(after[3].prompt.replace('window 4', 'window 3'), before[2].prompt, 'by its window number alone, here');
  // And on a real recording the adapter places a helper's history at its hand-off in the parent's timeline (C-03): one
  // more helper row renumbers the sequence of every later parent event, so a parent window that names one — even the
  // window that launched the helper, before the helper's own in review order — is asked again whatever its number.
  const load = async (agentRows) => {
    const later = [claudeRow('assistant', [{ type: 'tool_use', id: 'toolu_01SyntheticBashM35R4', name: 'Bash',
      input: { command: 'npm test' } }], {}, 'm35-r4-call'),
    claudeRow('user', [{ type: 'tool_result', tool_use_id: 'toolu_01SyntheticBashM35R4', content: 'ok' }], {}, 'm35-r4-result')];
    const tree = await claudeTree([...claudeParentRows({ background: true }), ...later], agentRows);
    t.after(() => rm(tree.dir, { recursive: true, force: true }));
    await mkdir(join(tree.dir, 'codex'), { recursive: true });
    return sessionFromLedger(redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
      recordingRoots: { claude: tree.projects, codex: join(tree.dir, 'codex') } })).ledger, { sessionKey: 'm35-r4' });
  };
  const rows = claudeAgentRows();
  const small = await load(rows);
  const grown = await load([...rows, { ...rows.at(-1), uuid: 'm35-r4-grown', message: { role: 'assistant',
    content: [{ type: 'text', text: 'One more helper note.' }] } }]);
  assert.equal(grown.events.filter((e) => e.childId).length, small.events.filter((e) => e.childId).length + 1, 'premise');
  const sequence = (session) => new Map(session.events.filter((e) => !e.childId).map((e) => [e.id, e.sequence]));
  const was = sequence(small), now = sequence(grown);
  assert.deepEqual([...now.keys()], [...was.keys()], 'the parent\'s events keep their ids');
  assert.ok([...was].some(([id, at]) => now.get(id) !== at), 'and a later one its sequence');
  const [first] = planWindowRequests({ session: small, reviewScope: 'session-only' }).requests;
  const [again] = planWindowRequests({ session: grown, reviewScope: 'session-only' }).requests;
  assert.equal(first.window.session.helper, false);
  assert.notEqual(again.request.prompt, first.request.prompt, 'the parent window that launched the helper moves');
});

// ---- R3: the combined route's inventory is not in its work budget (a stated loss, C-07 (6)) -------------------------------

test('M35 review R3 (C-07 (6), D67 (4)): a combined window\'s work budget does not count its inventory; one that cannot fit is declared', async () => {
  // Two long human messages, each in full in every later window's inventory, then a task whose work nearly fills the
  // combined budget: that window is packed by its work alone and its request passes the 512 KiB bound.
  const blobs = {};
  let n = 0;
  const ref = (text) => { const key = `r3-${++n}`; blobs[key] = text; return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text) }]; };
  const ask = (id, text) => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(text) });
  const said = (id, text) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null, text: ref(text) });
  const session = new Session({ sessionKey: 'm35-r3', adapter: 'claude', blobs, events: [
    ask('I1', `Spec one:\n${'a'.repeat(160_000)}`), said('C1', 'Read it.'),
    ask('I2', `Spec two:\n${'b'.repeat(160_000)}`), said('C2', 'Read that too.'),
    ask('I3', 'Now build it.'), said('C3', 'c'.repeat(195_000))].map((event, sequence) => ({ ...event, sequence })) });
  const plan = planWindowRequests({ session, reviewScope: 'combined' });
  const budget = bytesOfTokens(COMBINED_WINDOW_SETTINGS.workTokens);
  assert.deepEqual(plan.windows.map((w) => w.segments.map((segment) => segment.start)), [['I1'], ['I2'], ['I3']]);
  const last = plan.requests.at(-1);
  assert.ok(last.window.workBytes <= budget && !last.window.oversize, 'its work fits the budget');
  assert.ok(Buffer.byteLength(last.request.prompt) > MAX_REVIEW_INPUT_BYTES, 'its request, with the inventory, does not');
  const report = await runReview({ session, pr: null, reviewScope: 'combined', plan,
    judge: async (request) => (request.challenge ? { votes: [] } : { decisions: [], pivots: [], claims: [], requirements: [] }) });
  assert.deepEqual(report.windowFailures, [{ window: 3, reason: 'unreviewed_scope' }], 'declared, never clipped');
  assert.notEqual(report.sessionStatus, 'CLEAN');
});
