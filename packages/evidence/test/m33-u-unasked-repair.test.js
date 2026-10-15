// M33 U repair (OWNER DECISION B, 2026-10-01). The recheck of 8cd731c refuted it twice; both are "decided without
// asking you" (the `unasked` column) certified over the human's own words. Fixed in code, the model deciding none of it:
//
//   Major 1 (introduced). Per-decision completeness was bounded just BEFORE the earliest cited action, so a decision
//   citing an AskUserQuestion call and the edit after it was certified although the human's answer lay between them
//   (P8), and a located unresolved-answer loss at that very call was ignored (P9). Now the decision's own span counts: a
//   loss at or before any cited action, a human instruction after its earliest action and at or before its latest one,
//   a cited question call, or an instruction answering a cited action each leave it `instructions_partial`.
//   Major 2 (left, newly exposed). The human's words inside a Claude tool result were neither read nor declared: the
//   feedback given with a rejected call ("…the user said:"), on any tool (P1, P6, P7); an AskUserQuestion declined with
//   feedback (P2); one outside the known input schema (P3). None is read as an instruction (tool-result text never
//   is); each is now declared, at the call where it is a ledger action, else session-wide (unlocated). L1: a call is the human's refusal by the recorder's typed `toolDenialKind: "user-rejected"`, whatever
//   its words — with or without "…the user said:" — and only then; an error with no such kind declares nothing.
//   Minor. A queued prompt that is wholly elements of a tag the closed context list does not name (a teammate, agent or
//   hook message) was read as the human's instruction. It is no longer read; its row stays a counted loss.
//
// Every row is synthetic (m33-u-unasked-fixture.js). The judge is a table, never a model.
import { beforeRecordedFacts } from './stable-ids-fixture.js';
import { readingStableIds } from './m35-windows-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { beforeForbiddenEdit as beforeForbiddenEditOnly } from './m33-n-forbidden-edit-fixture.js';
import { beforeStatusFact } from './status-fact-fixture.js';
import { beforeHedgedClaims } from './h3-hedged-claims-fixture.js';
import { runReview } from '../src/run-review.js';
import { instructionReviewScope } from '../src/ledger.js';
import { UNREAD_ANSWER_NOTE } from '../adapters/sonah-ledger.js';
import { load, user as recordedUser, said, call, result, queued, compact, QUESTION, answeredText, codexRows, CODEX_NAME,
  sessionDigest, beforeHumanInteractionFlags, named, labelOf, sessionBeforeStableIds,
  promptDigestsBeforeStableIds, promptDigests } from './m33-u-unasked-fixture.js';
import { beforeM36Labels, beforeM36Conversation, textBeforeD71Fix, textBeforeS7 } from './m33-integration-fixture.js';

/** L1 session-type review: every prompt here is a human's, typed at the interactive terminal (`promptSource: 'typed'`),
 *  so a refusal is a human's (C-02 "L1 refused calls"). The same rows with no typed prompt are a session whose type
 *  the recorder did not record, declared under their own reason (packages/slicer/test/l1-session-type.test.js). */
const user = (text, extra = {}) => recordedUser(text, { promptSource: 'typed', ...extra });
// H3 (`sonah.narrative/16`) moved every narrative request by its claims definition alone: its texts are
// rendered back first (/16 → /14), then M33 N's (/14 → /13), so every value pinned here still holds.
const beforeForbiddenEdit = (text) => beforeForbiddenEditOnly(beforeHedgedClaims(text));

const SUCCESS = Object.freeze({ stdout: 'ok', stderr: '', interrupted: false, isImage: false, noOutputExpected: false });
const REJECTED = 'The user doesn\'t want to proceed with this tool use. The tool use was rejected (eg. if it was a file '
  + 'edit, the new_string was NOT written to the file).';
/** Claude Code's native result for a call the human rejected, saying why. */
const rejectedSaying = (words) => `${REJECTED} To tell you how to proceed, the user said:\n${words}`;
const REJECTED_PLAIN = `${REJECTED} STOP what you are doing and wait for the user to tell you how to proceed.`;
const INTERRUPTED = '[Request interrupted by user for tool use]';
const edit = (id, from, to) => call(id, 'Edit', { file_path: '/repo/src/cli.js', old_string: from, new_string: to });
const edited = (id) => result(id, 'The file /repo/src/cli.js has been updated successfully.');
/** A call the human refused, as Claude Code records it at a permission prompt: the `is_error` block, the `Error: …`
 *  sidecar and the typed denial kind (L1). */
const refusal = (id, text) => ({ ...result(id, text, `Error: ${text}`, true), toolDenialKind: 'user-rejected' });
const rejected = (id, words) => refusal(id, rejectedSaying(words));
const bash = (id, command) => call(id, 'Bash', { command, description: 'Run it' });
const ran = (id) => result(id, 'ok', SUCCESS, false);

/** Instruction-history lines as a request shows them: [{ id, sequence, text }] (whole-fence entries). */
function inventoryOf(prompt) {
  const out = [];
  // D71 (S2): a session-only request's human block is "What the human asked", at its top, before the window's facts and
  // the session; a combined one keeps its inventory at the end.
  const top = prompt.indexOf('## What the human asked');
  const body = top >= 0 ? prompt.slice(top, prompt.indexOf('\n## ', top + 1) < 0 ? undefined : prompt.indexOf('\n## ', top + 1))
    : prompt.slice(prompt.indexOf('## Human instructions recorded up to the end of this window'));
  const re = /^\[([^\]]+)\] HUMAN INSTRUCTION · authority=human · sequence=(\d+) · role=instruction[^\n]*\n<<<\n([\s\S]*?)\n>>>/gm;
  for (let m; (m = re.exec(body));) out.push({ id: m[1], sequence: Number(m[2]), text: m[3] });
  return out;
}

/** A table judge: one `unasked` decision citing `actions`, checking every listed instruction before the earliest one. */
function judgeOf(actions) {
  const dimension = 'SYNTHETIC_U_DIMENSION: which flag name the CLI uses';
  return async (request) => {
    if (request.challenge) {
      const [first] = inventoryOf(request.prompt ?? request.challenge.evidencePrompt ?? '');
      return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
        explanation: 'SYNTHETIC: the record shows it.',
        receipts: first ? [{ eventId: first.id, role: 'instruction', quote: first.text.slice(0, 100) }] : [] })) };
    }
    const empty = { decisions: [], pivots: [], claims: [], requirements: [] };
    const prompt = request.prompt ?? '';
    if (!actions.every((action) => prompt.includes(`[${action}]`))) return empty;
    const scopeDigest = /^scopeDigest: (\S+)$/m.exec(prompt)?.[1] ?? null;
    const escaped = (id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const sequenceOf = (action) => Number(new RegExp(`^\\[${escaped(action)}\\][^\\n]*sequence=(\\d+)`, 'm').exec(prompt)?.[1]);
    const before = Math.min(...actions.map(sequenceOf));
    const last = actions[actions.length - 1];
    return { ...empty, decisions: [{ dimension, chosen: 'Edit src/cli.js', actions, value: 'src/cli.js',
      valueReceipt: { eventId: last, role: 'action', field: 'path', quote: 'src/cli.js' }, stated: null, constrainedBy: null,
      instructionReview: { dimension, scopeDigest, noRelevantInstruction: true,
        checks: inventoryOf(prompt).filter((i) => i.sequence < before).map((i) => ({
          instruction: { eventId: i.id, role: 'instruction', quote: i.text.slice(0, 400) }, relevant: false,
          explanation: 'SYNTHETIC: it does not name a flag.' })) } }] };
  };
}

/** The column of the one decision citing `labelled` (C-01 event identity: the actions' positional labels, `named`), as
 *  `column/state/reason[,reason]`. */
async function columnOf(session, labelled) {
  const actions = labelled.map((label) => named(session, label));
  // M35: the judge reads the request with its window's aliases written back as stable ids.
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: readingStableIds(session, judgeOf(actions)) });
  const decision = report.decisions.find((d) => d.actions?.join() === actions.join());
  assert.ok(decision, `a decision citing ${labelled}`);
  assert.deepEqual(report.findings.filter((f) => /unasked|instruction/.test(f.kind ?? '')), [], 'the column is neutral');
  return [decision.column, decision.columnState, (decision.reasons ?? []).filter((r) => r === 'instructions_partial')];
}
const UNASKED = ['unasked', 'grounded', []];
const PARTIAL = [null, 'unchecked', ['instructions_partial']];
// C-01 event identity: events are shown by their positional labels (`labelOf`), never by parsing an id.
const instructionGaps = (session) => session.adapterGaps.filter((gap) => gap.channel === 'instructions')
  .map((gap) => [gap.code, gap.count, gap.eventIds?.map((id) => labelOf(session, id)) ?? null, gap.note]);
const instructionIds = (session) => session.events.filter((e) => e.kind === 'instruction').map((e) => labelOf(session, e.id));

// ---- Major 1: the decision's own span ------------------------------------------------------------------------------

const asked = (sidecar) => [user('Add a CLI flag.'),
  call('q1', 'AskUserQuestion', { questions: [QUESTION] }, 'One question first.'),
  result('q1', answeredText([[QUESTION.question, '--strict']]), sidecar),
  edit('e1', 'const flags = [];', 'const flags = [\'--strict\'];'), edited('e1'), said('Added --strict.')];

test('U repair P8: a decision citing the question call and the edit after its answer is never unasked', async (t) => {
  const { session } = await load(t, asked({ questions: [QUESTION], answers: { [QUESTION.question]: '--strict' } }));
  assert.deepEqual(instructionIds(session), ['I1', 'I1-1'], 'premise: the answer was read, between the two actions');
  assert.equal(session.event(named(session, 'I1-1')).answerTo, named(session, 'A1-0'));
  assert.deepEqual(await columnOf(session, ['A1-0', 'A1-1']), PARTIAL, 'the answer lies within the decision');
  assert.deepEqual(await columnOf(session, ['A1-0']), PARTIAL, 'the decision asked the human');
  assert.deepEqual(await columnOf(session, ['A1-1']), UNASKED, 'the edit alone is checked against the answer, as any ask');
});

test('U repair P9: an unresolved answer located at the decision\'s own question call blocks it', async (t) => {
  const { session } = await load(t, asked({ questions: [QUESTION], answers: { [QUESTION.question]: '--strict' }, annotations: {} }));
  assert.deepEqual(instructionGaps(session), [['incomplete_inventory', 1, ['A1-0'], UNREAD_ANSWER_NOTE]]);
  for (const actions of [['A1-0', 'A1-1'], ['A1-0'], ['A1-1']])
    assert.deepEqual(await columnOf(session, actions), PARTIAL, `${actions}`);
});

test('U repair: a question call whose result was never recorded is a declared, unread answer', async (t) => {
  const { raw, session } = await load(t, [user('Add a CLI flag.'),
    call('q1', 'AskUserQuestion', { questions: [QUESTION] }, 'One question first.'),
    edit('e1', 'const flags = [];', 'const flags = [\'--strict\'];'), edited('e1'), said('Added --strict.')]);
  assert.equal(raw.ledger[0].humanAnswerUnresolved, true);
  assert.deepEqual(instructionGaps(session), [['incomplete_inventory', 1, ['A1-0'], UNREAD_ANSWER_NOTE]]);
  assert.deepEqual(await columnOf(session, ['A1-1']), PARTIAL);
});

test('U repair, L1: an interrupted question, or an error the recorder types as no refusal, declares nothing', async (t) => {
  for (const content of [INTERRUPTED, REJECTED_PLAIN]) {
    const { raw, session } = await load(t, [user('Add a CLI flag.'),
      call('q1', 'AskUserQuestion', { questions: [QUESTION] }, 'One question first.'), result('q1', content, undefined, true),
      user('Just pick one.'), edit('e1', 'const flags = [];', 'const flags = [\'--strict\'];'), edited('e1'), said('Done.')]);
    assert.equal(raw.ledger[0].humanAnswerUnresolved, undefined, content);
    assert.deepEqual(instructionGaps(session), [], content);
    assert.deepEqual(await columnOf(session, ['A2-0']), UNASKED, `${content}: the edit follows a complete history`);
    assert.deepEqual(await columnOf(session, ['A1-0']), PARTIAL, `${content}: the question call itself asked`);
  }
});

test('U repair: a queued prompt recorded between two cited actions leaves the decision unchecked', async (t) => {
  const { session } = await load(t, [user('Add a CLI flag.'), edit('e1', 'const flags = [];', 'const flags = [\'--strict\'];'),
    edited('e1'), queued('Use --safe instead.', { origin: { kind: 'human' } }),
    edit('e2', 'const flags = [\'--strict\'];', 'const flags = [\'--strict\', \'--x\'];'), edited('e2'), said('Done.')]);
  assert.deepEqual(instructionIds(session), ['I1', 'I1-1']);
  assert.deepEqual(await columnOf(session, ['A1-0', 'A1-1']), PARTIAL, '8cd731c certified it; 269cf6d did not');
  assert.deepEqual(await columnOf(session, ['A1-0']), UNASKED);
  assert.deepEqual(await columnOf(session, ['A1-1']), UNASKED, 'checked against the queued prompt, before it');
});

test('U repair: a Codex decision spanning a later ask leaves it unchecked; each action alone keeps its history', async (t) => {
  const { session } = await load(t, codexRows(), { name: CODEX_NAME });
  assert.deepEqual(instructionIds(session), ['I1', 'I2']);
  assert.deepEqual(await columnOf(session, ['A1-0', 'A2-0']), PARTIAL, 'I2 was recorded within the decision');
  assert.deepEqual(await columnOf(session, ['A1-0']), UNASKED);
  assert.deepEqual(await columnOf(session, ['A2-0']), UNASKED);
});

// ---- Major 2: the human's words inside a tool result, declared -----------------------------------------------------

const WORDS = 'Do not change the flags list; add the flag in src/flags.js instead.';

// M34 labels review (F3): the refusal is labelled the human's (`human` + `refusal`, linked to the refused call), but its
// result's text is never read as an instruction: Claude Code writes its own rejection words into every refusal's result
// and records no separate field for the human's feedback. L1's declaration at the call stands, as on M33 human-words repair.
test('U repair P1: feedback given with a rejected call is declared at that call, never read as an instruction', async (t) => {
  const { raw, session } = await load(t, [user('Add a flag to the CLI.'),
    bash('b0', 'node --test'), ran('b0'),
    edit('e1', 'const flags = [];', 'const flags = [\'--strict\'];'), rejected('e1', WORDS),
    edit('e2', 'const flags = [];', 'const flags = [\'--other\'];'), edited('e2'), said('Done.')]);
  assert.equal(raw.interjections, undefined, 'tool-result text is never an instruction');
  assert.deepEqual(instructionIds(session), ['I1']);
  assert.deepEqual(instructionGaps(session), [['incomplete_inventory', 1, ['A1-1'], UNREAD_ANSWER_NOTE]]);
  assert.deepEqual(await columnOf(session, ['A1-2']), PARTIAL, 'after the human\'s words');
  assert.deepEqual(await columnOf(session, ['A1-1']), PARTIAL, 'the rejected call itself');
  assert.deepEqual(await columnOf(session, ['A1-0']), UNASKED, 'before them: unaffected');
});

test('U repair P2/P3: a question declined with feedback, or outside the known schema, is declared at the call', async (t) => {
  const declined = await load(t, [user('Add a flag to the CLI.'),
    call('q1', 'AskUserQuestion', { questions: [QUESTION] }, 'One question first.'), rejected('q1', 'Neither. Use --compat.'),
    edit('e1', 'const flags = [];', 'const flags = [\'--strict\'];'), edited('e1'), said('Done.')]);
  assert.equal(declined.raw.interjections, undefined);
  assert.deepEqual(instructionGaps(declined.session), [['incomplete_inventory', 1, ['A1-0'], UNREAD_ANSWER_NOTE]]);
  assert.deepEqual(await columnOf(declined.session, ['A1-1']), PARTIAL);
  const drifted = { ...QUESTION, extraField: 'drift' };
  const generic = await load(t, [user('Add a flag to the CLI.'),
    call('q1', 'AskUserQuestion', { questions: [drifted] }, 'One question first.'),
    result('q1', answeredText([[QUESTION.question, '--safe']]), { questions: [drifted], answers: { [QUESTION.question]: '--safe' } }),
    edit('e1', 'const flags = [];', 'const flags = [\'--strict\'];'), edited('e1'), said('Done.')]);
  assert.equal(generic.raw.ledger[0].genericTool, true, 'premise: the input is outside the known schema');
  assert.equal(generic.raw.interjections, undefined, 'its answer is not read');
  assert.deepEqual(instructionGaps(generic.session), [['incomplete_inventory', 1, ['A1-0'], UNREAD_ANSWER_NOTE]]);
  assert.deepEqual(await columnOf(generic.session, ['A1-1']), PARTIAL);
});

test('U repair P6/P7: reading a later queued prompt or locating a later capped ask never unblocks an earlier loss', async (t) => {
  const p6 = await load(t, [user('Add a flag to the CLI.'),
    edit('e1', 'const flags = [];', 'const flags = [\'--strict\'];'), rejected('e1', WORDS),
    edit('e2', 'const flags = [];', 'const flags = [\'--other\'];'), edited('e2'),
    queued('Also update the README when you are done.', { origin: { kind: 'human' } }), bash('b1', 'node --test'), ran('b1'),
    said('Done.')]);
  assert.deepEqual(await columnOf(p6.session, ['A1-1']), PARTIAL);
  const p7 = await load(t, [user('Add a flag to the CLI.'),
    edit('e1', 'const flags = [];', 'const flags = [\'--strict\'];'), rejected('e1', 'No. Put the flag in src/flags.js.'),
    edit('e2', 'const flags = [];', 'const flags = [\'--other\'];'), edited('e2'), said('Done.'),
    user(`Now document it.\n${'Keep the docs short. '.repeat(1200)}`), bash('b1', 'node --test'), ran('b1'), said('Done.')]);
  assert.deepEqual(await columnOf(p7.session, ['A1-1']), PARTIAL);
});

test('U repair, L1: an error with no typed refusal is a failed call; a refusal without words still declares its answer', async (t) => {
  const { session } = await load(t, [user('Add a flag to the CLI.'),
    edit('e1', 'const flags = [];', 'const flags = [\'--strict\'];'),
    result('e1', REJECTED_PLAIN, `Error: ${REJECTED_PLAIN}`, true),
    edit('e2', 'const flags = [];', 'const flags = [\'--other\'];'), edited('e2'), said('Done.')]);
  assert.deepEqual(instructionGaps(session), []);
  assert.deepEqual(await columnOf(session, ['A1-1']), UNASKED);
  // L1: the human refused it (typed), with no words: an answer may still exist, unread — whatever the wording.
  const refused = await load(t, [user('Add a flag to the CLI.'),
    edit('e1', 'const flags = [];', 'const flags = [\'--strict\'];'), refusal('e1', REJECTED_PLAIN),
    edit('e2', 'const flags = [];', 'const flags = [\'--other\'];'), edited('e2'), said('Done.')]);
  assert.equal(refused.raw.ledger[0].humanAnswerUnresolved, true);
  assert.deepEqual(instructionGaps(refused.session), [['incomplete_inventory', 1, ['A1-0'], UNREAD_ANSWER_NOTE]]);
  assert.deepEqual(await columnOf(refused.session, ['A1-1']), PARTIAL);
});

test('U repair: a rejected call\'s words stay declared when a conflicting result row retracts its result', async (t) => {
  const { raw, session } = await load(t, [user('Add a flag to the CLI.'),
    edit('e1', 'const flags = [];', 'const flags = [\'--strict\'];'), rejected('e1', WORDS), edited('e1'),
    edit('e2', 'const flags = [];', 'const flags = [\'--other\'];'), edited('e2'), said('Done.')]);
  assert.equal(raw.ledger[0].humanAnswerUnresolved, true);
  assert.deepEqual(instructionGaps(session), [['incomplete_inventory', 1, ['A1-0'], UNREAD_ANSWER_NOTE]]);
});

test('U repair: words given with a rejected hand-off (no ledger action) are declared session-wide', async (t) => {
  const { session } = await load(t, [user('Add a flag to the CLI.'),
    call('t1', 'Agent', { description: 'Add the flag', prompt: 'Add the flag.', subagent_type: 'general-purpose' }),
    rejected('t1', 'No helpers. Name it --safe.'),
    edit('e1', 'const flags = [];', 'const flags = [\'--other\'];'), edited('e1'), said('Done.')]);
  assert.deepEqual(instructionGaps(session), [['incomplete_inventory', 1, null, UNREAD_ANSWER_NOTE]],
    'its place cannot be located by an action: unlocated, a loss at every bound');
  assert.equal(instructionReviewScope(session, { upTo: 0 }).complete, false);
  assert.deepEqual(await columnOf(session, ['A1-0']), PARTIAL);
});

// ---- Minor: a queued prompt that is wholly an unlisted element ----------------------------------------------------

// Release fix 3b (2026-10-12): such a row, with no origin on a typed recorder, is the harness's by its label: harness
// context, no declared loss (it was one before).
test('U repair: a queued prompt wholly made of tag elements is never the human\'s (harness context)', async (t) => {
  for (const prompt of ['<teammate-message teammate_id="researcher">Use the v2 API.</teammate-message>',
    '<agent-message from="planner">Ship it.</agent-message>',
    '<user-prompt-submit-hook>Run the linter.</user-prompt-submit-hook>',
    '<command-name>/fix</command-name>\n<command-args>name it --safe</command-args>']) {
    const { raw, session } = await load(t, [user('Add a CLI flag.'), edit('e1', 'const flags = [];', 'const flags = [1];'),
      edited('e1'), queued(prompt), edit('e2', 'const flags = [1];', 'const flags = [2];'), edited('e2'), said('Done.')]);
    assert.equal(raw.interjections, undefined, prompt);
    assert.deepEqual(instructionGaps(session).map((g) => [g[0], g[1], g[2]]), [], prompt);
  }
  // Prose around or beside an element is the human's: still read.
  const prose = 'Please keep <b>bold</b> headings.';
  const { raw } = await load(t, [user('Add a CLI flag.'), edit('e1', 'const flags = [];', 'const flags = [1];'), edited('e1'),
    queued(prose, { origin: { kind: 'human' } }), said('Done.')]);
  assert.deepEqual(raw.interjections.map((i) => i.text), [prose]);
});

// ---- Bytes: a recording with none of these shapes ------------------------------------------------------------------

// Pinned on 269cf6d: a plain rejection, and a question interrupted then answered by a new ask, adapt and ask byte for
// byte as before (no new declaration, no `completeFor`).
const PINNED = {
  plainRejection: { session: '17bcf17d09474069166fe1a3d506b6bb19418c133600e2da318505ac7675b428',
    prompts: ['f865663b0605dbd28339d17970c985e693cc9377c995c521c7ce19af4e1a38e5'] },
  interrupted: { session: 'a1fc41ead303157ce43733569e8e16505383334dce0970e6a54208e713452d0d',
    prompts: ['a8843932ecba270cf06999d9c3273cacaf517d5b17aebb1ad04fdf476016c969',
      'bad95aaeb8ea631df5a02f7836a1c5623e651e4b573fc836c7a782f518fecdd2'] },
};

// M33 H's repair (merged beside OWNER DECISION B; the relay rule in the narrative task text, still `sonah.narrative/13`)
// moved the task text of EVERY narrative request: the prompts above are this repair's history on its own branch. The
// session bytes hold; these are the same requests on the merged tree, moved only by M33 H's relay-rule text.
const MOVED_BY_M33_H = {
  plainRejection: { prompts: ['10d3b9c9e99e91aa0d25843035a3c217b82066a7863e08b038014c87a6a61391'] },
  interrupted: { prompts: ['d1d014fe30472273d2a911658ff2cddd1adc3805da7e37c061a3feab1b224e8d',
    '4416c9d77e469704a1c1aa749a5d0d2b834106f9dd8d2f5208c4d252405c898f'] },
};

const backToH = (text) => beforeForbiddenEdit(beforeStatusFact(text));
// M33 brittleness L3: the adapter flags a question call from the recorder's schema (`asksHuman`); the interrupted
// question's session moves by exactly that flag (rendered back, `beforeHumanInteractionFlags`, it is the pin above), and
// no request byte moves.
const MOVED_BY_L3 = { interrupted: { session: '4adfe6b3dcb346b51916bd175563eed8afec2f2a808f8e3dfd97b0108aace309' } };

/** MOVED_BY_WINDOWING (M35, C-07 "M35 windowing"): each recording's narrative requests — one window each now (a
 *  compaction no longer splits one), named by the window's aliases — so the render-back to M33 H's no longer applies. No
 *  session byte moved. */
const MOVED_BY_WINDOWING = { plainRejection: { prompts: ['1a502df6aba4ffa85707fb3d400c902dfd9465abf8bdb1a0f5171ba255303db0'] },
  interrupted: { prompts: ['6fa7b9a5a652462afcd780147877c362cf932da2aa178c37f8f0f958ecd42499'] } };

/** D68 (C-02 "M36 recorded facts"): each invocation carries the recorder's typed facts (`recorded`); each session moves
 *  by those alone (rendered back, `beforeRecordedFacts`, it is the pin before them). No request moved. */
const MOVED_BY_RECORDED_FACTS = Object.freeze({ plainRejection: '107bae77537c48b2175c79ae16f5aa7dccd8c038cb573dde3cd46e6589361186', interrupted: '25e859d88835c7f8b8cbf8889bcddafbaeeec5bbdfb3095fd8251d40a514e24c' });

/** M36 phase 2, the window format (D68 L, H; C-07 "M36 window format"): each recording's narrative request
 *  moved by its labels alone — each RESULT's `recorded: …` line and an edit's replaced text headed as such: rendered back
 *  (`beforeM36Labels`) it is MOVED_BY_WINDOWING's. No session byte moved. */
const MOVED_BY_M36_FORMAT = { plainRejection: { prompts: ['87b0571759ff24b346a717b8d4c9fb5633ebfc0c025136fdbcdebaf5e8c7866f'] },
  interrupted: { prompts: ['9f63525832153ab12b478e830e75138ca7e6a29dcdd7917f2f70be9ec92507e1'] } };

/** M36 phase 3 (D68 K, Q, F): each recording's narrative request moved by item 1's actor sentence and the
 *  session-only contract's `evidenceRequests` member and rules alone: rendered back (`beforeM36Conversation`) it is
 *  MOVED_BY_M36_FORMAT's. No session byte moved. */
const MOVED_BY_M36_CONVERSATION = { plainRejection: { prompts: ['75abcbcb1a9c08ae98beb7c8f5a302f00094765034f4d8ce7ff16e32c8069373'] }, interrupted: { prompts: ['1e01d7746b808d4518a7eec6de12f52e94e6c2610b134b72be7e23a1c2b1a29e'] } };

/** D71 (S2, the reviewer brief as the checklist): each recording's narrative request — the window in the checklist's
 *  reading order, its RESULTs' typed outcomes, its numbered agent messages — and its brief as the system prompt. No session
 *  byte moved. */
const MOVED_BY_D71_BRIEF = { plainRejection: { prompts: ['c4746e4ce6cbf37edc3ae69c54979378b1436f5ca06658df5dc298d00e815827'] }, interrupted: { prompts: ['0c6c72e3bfbfa9572057cc53c3de09bbfccd11f10ffe54044a8346e1b8477642'] } };
/** D71 (S3, the new channels): each fixture's request moved again ("About this window" lists the RESULTs step 4 answers
 *  for; the brief's last step is step 6). */
const MOVED_BY_D71_CHANNELS = { plainRejection: { prompts: ['2c13d5bcfd94dcc7ed8584e12cbb658469e3ad18ccea0e530c915609e0f3e631'] }, interrupted: { prompts: ['610bd601d088d989feb12c0ea7bfb5088c70900c004cbeff64c4888786846dee'] } };
/** S6 (S5 review L5): a request moved by a RESULT's output-no-status words alone: rendered back (`textBeforeD71Fix`), it
 *  is S3's above, byte for byte. */
const MOVED_BY_D71_FIX = { plainRejection: { prompts: ['7e6162808b58b2285016405d3ee28e3ec4b74dd1b1dac3648cf72bb823d2a54e'] },
  interrupted: { prompts: ['645f41980ca0900703208784a62975241a5786a09ba4c4e469af37387e48ffd7'] } };

/** S7: a request moved by S7's fixed texts alone: rendered back (`textBeforeS7`), it is
 *  S6's above, byte for byte. */
const MOVED_BY_S7 = { plainRejection: { prompts: ['3e7c6d7fbcd5f4344a75eae3aee01f3e47ef21bfaba377e6e332342baf6b09e4'] }, interrupted: { prompts: ['66466b60f7cc503cc734c4360fb29fb797b12b1fd8fcaa2346fe7fd945f6e980'] } };

test('U repair: recordings with none of the repaired shapes keep their session and request bytes', async (t) => {
  const plainRejection = await load(t, [user('Add a flag to the CLI.'),
    edit('e1', 'const flags = [];', 'const flags = [\'--strict\'];'), result('e1', REJECTED_PLAIN, `Error: ${REJECTED_PLAIN}`, true),
    edit('e2', 'const flags = [];', 'const flags = [\'--other\'];'), edited('e2'), said('Done.')]);
  // C-01 event identity (stable event ids): the events are named by their rows now; rendered back to the positional ids
  // (`beforeStableIds`), the session and every request are the pinned bytes: only the ids moved.
  assert.equal(sessionDigest(sessionBeforeStableIds(plainRejection.session)), MOVED_BY_RECORDED_FACTS.plainRejection);
  assert.equal(sessionDigest(beforeRecordedFacts(sessionBeforeStableIds(plainRejection.session))),
    PINNED.plainRejection.session);
  // M33 N (`sonah.narrative/14`): rendered back (`beforeForbiddenEdit`), every request is M33 H's above, byte for byte.
  // Status fact (`sonah.narrative/15`): its three task lines come out first (`beforeStatusFact`); the session holds no
  // command, so its bytes did not move.
  // M35: the requests are pinned by MOVED_BY_WINDOWING; M36 phase 2 by MOVED_BY_M36_FORMAT, its labels alone.
  // D71 (S2): a session-only request carries only the window in the checklist's reading order (MOVED_BY_D71_BRIEF); nothing
  // renders it back to M36 phase 3's (MOVED_BY_M36_CONVERSATION, kept as the pins these replace).
  // D71 (S3): and moved once more by the new channels (MOVED_BY_D71_CHANNELS). S6: and by the output-no-status words
  // alone (MOVED_BY_D71_FIX; rendered back, S3's).
  // S7: and by its fixed texts alone (MOVED_BY_S7; rendered back, S6's).
  assert.deepEqual(promptDigests(plainRejection.session), MOVED_BY_S7.plainRejection.prompts);
  assert.deepEqual(promptDigests(plainRejection.session, textBeforeS7), MOVED_BY_D71_FIX.plainRejection.prompts);
  assert.deepEqual(promptDigests(plainRejection.session, textBeforeD71Fix), MOVED_BY_D71_CHANNELS.plainRejection.prompts);
  assert.notDeepEqual(MOVED_BY_D71_CHANNELS.plainRejection.prompts, MOVED_BY_D71_BRIEF.plainRejection.prompts);
  assert.notDeepEqual(MOVED_BY_D71_BRIEF.plainRejection.prompts, MOVED_BY_M36_CONVERSATION.plainRejection.prompts);
  const interrupted = await load(t, [user('Add a CLI flag.'),
    call('q1', 'AskUserQuestion', { questions: [QUESTION] }, 'One question first.'), result('q1', INTERRUPTED, undefined, true),
    compact(), user('Just pick one.'), edit('e1', 'const flags = [];', 'const flags = [\'--strict\'];'), edited('e1'), said('Done.')]);
  // M33 brittleness L3: its question call carries the adapter's `asksHuman` flag, and nothing else of it moved.
  const interruptedNow = sessionBeforeStableIds(interrupted.session);
  assert.equal(sessionDigest(interruptedNow), MOVED_BY_RECORDED_FACTS.interrupted);
  assert.equal(sessionDigest(beforeRecordedFacts(interruptedNow)), MOVED_BY_L3.interrupted.session);
  assert.equal(sessionDigest(beforeHumanInteractionFlags(beforeRecordedFacts(interruptedNow))),
    PINNED.interrupted.session);
  // D71 (S2): a session-only request carries only the window in the checklist's reading order (MOVED_BY_D71_BRIEF); nothing
  // renders it back to M36 phase 3's (MOVED_BY_M36_CONVERSATION, kept as the pins these replace).
  // D71 (S3): and moved once more by the new channels (MOVED_BY_D71_CHANNELS). S6: and by the output-no-status words
  // alone (MOVED_BY_D71_FIX; rendered back, S3's).
  // S7: and by its fixed texts alone (MOVED_BY_S7; rendered back, S6's).
  assert.deepEqual(promptDigests(interrupted.session), MOVED_BY_S7.interrupted.prompts);
  assert.deepEqual(promptDigests(interrupted.session, textBeforeS7), MOVED_BY_D71_FIX.interrupted.prompts);
  assert.deepEqual(promptDigests(interrupted.session, textBeforeD71Fix), MOVED_BY_D71_CHANNELS.interrupted.prompts);
  assert.notDeepEqual(MOVED_BY_D71_CHANNELS.interrupted.prompts, MOVED_BY_D71_BRIEF.interrupted.prompts);
  assert.notDeepEqual(MOVED_BY_D71_BRIEF.interrupted.prompts, MOVED_BY_M36_CONVERSATION.interrupted.prompts);
});
