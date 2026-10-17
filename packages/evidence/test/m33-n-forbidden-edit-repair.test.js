// M33 N repair (C-06 "M33 forbidden edits"): the recheck of 1193ac4 refuted it on two false-DECIDE paths code let through,
// and named minor ones. Each test here failed against 1193ac4 and holds after the repair:
//   1. an action whose outcome is not proved `succeeded` (a failed or unrecorded Codex apply_patch, a Claude Write with no
//      result, a command with no result) is withheld `violation_not_landed`, never asked;
//   2. text a harness added to a user row (a loaded skill, a slash command's expansion — Claude Code's meta rows — an IDE
//      selection or opened file, a user `!` command and its output, a prompt-submit hook) is never "You said":
//      `instruction_context`, through the plain slicer path and the CLI loader alike;
//   3. the revert proof fails closed on any later action of the turn whose effect on files it cannot read;
//   4. text an edit kept unchanged (in its before side as well) is not what it wrote;
//   5. a helper's change the parent undid, and a revert by a command, stay DECIDE (declared);
//   6. an action whose result records a human choice (a plan the human approved) between the two is named for the
//      challengers and shown whole in every profile, and the note no longer limits a lift to named instructions;
//   7. `"forbiddenEdits": null` is no proposal, never an unreadable one;
//   8. duplicate proposals are asked once and counted once; a quote cut mid-word is not grounded.
// Synthetic recordings only (m33-n-forbidden-edit-repair-rows.js), read through the real slicer, redactor and adapter,
// and hand-built sessions in the adapter's shape where the slicer keeps no such row. Deterministic judges that do what
// the words they are sent say. No recording, no model call. Nothing prints.
import { readingStableIds } from './m35-windows-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { loadSessionEvidence } from '../../cli/src/session-evidence.js';
import { Session } from '../src/session.js';
import * as ledger from '../src/ledger.js';
import * as reviewRun from '../src/run-review.js';
import * as challenge from '../src/challenge.js';
import * as context from '../../slicer/src/harness-context.js';
import { ownReceipt } from '../../cli/test/m33-fast-profile-fixture.js';
import * as R from './m33-n-forbidden-edit-rows.js';
import * as X from './m33-n-forbidden-edit-repair-rows.js';

const forbidden = await import('../src/forbidden.js').catch(() => ({}));

const PROFILES = [null, 'm33-fast', 'm33-lean'];
const TYPE = 'forbidden-edit';

// ---- recordings ----------------------------------------------------------------------------------------------------

async function file(t, rows, name) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-n-repair-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, name);
  await writeFile(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return { dir, path };
}
async function sliced(t, rows, name = `${X.SESSION}.jsonl`) {
  const { path } = await file(t, rows, name);
  return redact(await sliceLineage([path], { cwd: '/repo' })).ledger;
}
const sessionOf = (ledgerValue, key = 'm33-n-repair') => sessionFromLedger(ledgerValue, { sessionKey: key });
const claude = async (t, shape) => sessionOf(await sliced(t, X.claudeRows(shape)));
const codex = async (t, options) => sessionOf(await sliced(t, X.codexRows(options), X.CODEX_NAME), 'm33-n-repair-codex');
/** The same recording through the CLI loader (`loadSessionEvidence`), as `sonah review` reads it. */
async function loaded(t, rows) {
  const { dir, path } = await file(t, rows, `${X.SESSION}.jsonl`);
  await mkdir(join(dir, 'codex'), { recursive: true });
  return sessionOf(redact(await loadSessionEvidence([path], { outcomes: new Map(),
    recordingRoots: { claude: join(dir, 'projects'), codex: join(dir, 'codex') } })).ledger, 'm33-n-repair-loader');
}

const textOf = (session, event, field = 'text') => session.textSpansOf(event, field).join('');
const idOf = (session, test) => session.events.find(test)?.id;
const instructionWith = (session, words) => idOf(session, (e) => e.kind === 'instruction' && textOf(session, e).includes(words));
const writeOf = (session) => idOf(session, (e) => e.kind === 'invocation' && e.operation === 'write');
const editOf = (session) => idOf(session, (e) => e.kind === 'invocation' && e.operation === 'edit' && !e.shellWriteOf);
const receipt = (eventId, role, quote) => ({ eventId, role, quote });

// ---- the deterministic judges (as m33-n-forbidden-edit.test.js's, and reading named choices too) ---------------------

/** The words of human instruction `id` as a request's evidence shows them (its inventory entry, the last one), or null. */
function instructionText(request, id) {
  const text = request.prompt;
  // D71 (S2): a human message's words are under "What the human asked" (the session points up to them): read the
  // occurrence of its header that is followed by a fence.
  for (let at = text.indexOf(`[${id}] HUMAN INSTRUCTION`); at >= 0; at = text.indexOf(`[${id}] HUMAN INSTRUCTION`, at + 1)) {
    const open = text.indexOf('\n<<<\n', at), close = text.indexOf('\n>>>', open + 5);
    const next = text.indexOf('\n[', at + 1);
    if (open < 0 || close < 0 || (next >= 0 && next < open)) continue;
    return text.slice(open + 5, close);
  }
  return null;
}
/** The rendered block of the event whose header starts `head` (to the blank line that ends it), or null. */
function block(request, head) {
  const at = request.prompt.indexOf(head);
  if (at < 0) return null;
  const end = request.prompt.indexOf('\n\n', at);
  return request.prompt.slice(at, end < 0 ? undefined : end);
}
const LIFTS = /do mention|go ahead|you may/i;

/**
 * A challenger that does what its instructions say. On a forbidden-edit item: every human instruction named between is
 * read (a lift refutes, a missing one is uncertain); every human choice named between is read with its result (missing:
 * uncertain; a plan the human approved that holds what the action did: refuted, citing the approval); otherwise upheld.
 */
function challenger(verdict = null) {
  return (request) => ({ votes: request.challenge.items.flatMap((item) => {
    const chosen = verdict ? verdict(item) : undefined;
    if (chosen === null) return [];
    if (chosen === 'uncertain') return [{ key: item.key, verdict: 'uncertain', explanation: 'Synthetic.', receipts: [] }];
    if (item.type !== TYPE) return [{ key: item.key, verdict: chosen ?? 'not-refuted', explanation: 'Synthetic.',
      receipts: [ownReceipt(item.candidate)] }];
    assert.ok(request.system.includes(challenge.FORBIDDEN_EDIT_NOTE));
    for (const id of item.candidate.humanInstructionsBetween) {
      const words = instructionText(request, id);
      if (words === null) return [{ key: item.key, verdict: 'uncertain', explanation: 'Not shown.', receipts: [] }];
      if (LIFTS.test(words)) return [{ key: item.key, verdict: 'refuted', explanation: 'A later instruction allowed it.',
        receipts: [receipt(id, 'instruction', words)] }];
    }
    for (const id of item.candidate.humanChoicesBetween ?? []) {
      const action = block(request, `[${id}] ACTION`);
      const resultId = new RegExp(`\\[([^\\]\\s]+)\\] RESULT of ${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `)
        .exec(request.prompt)?.[1];
      const result = resultId ? block(request, `[${resultId}] RESULT of ${id}`) : null;
      if (action === null || result === null) return [{ key: item.key, verdict: 'uncertain', explanation: 'Not shown.', receipts: [] }];
      if (result.includes('approved your plan') && action.includes(item.candidate.violation.quote))
        return [{ key: item.key, verdict: 'refuted', explanation: 'The human approved a plan that held it.',
          receipts: [receipt(resultId, 'observation', 'User has approved your plan.')] }];
    }
    return [{ key: item.key, verdict: chosen ?? 'not-refuted', explanation: 'The instruction ruled it out.',
      receipts: [item.candidate.violation] }];
  }) });
}

function judgeOf(edits, { verdict = null, seen = [] } = {}) {
  const vote = challenger(verdict);
  return async (request) => {
    seen.push(request);
    if (request.challenge) return vote(request);
    const asked = `${request.system}${request.prompt}`.includes('"forbiddenEdits"');
    const proposed = typeof edits === 'function' ? edits(request) : request.window?.index === 0 ? edits : [];
    return { decisions: [], pivots: [], claims: [], requirements: [], ...(asked && proposed.length ? { forbiddenEdits: proposed } : {}) };
  };
}
// M35: the judge reads each request with its window's aliases written back as stable ids (m35-windows-fixture.js).
const reviewOf = (session, edits, { profile = null, verdict = null, seen = [] } = {}) => reviewRun.runReview({
  session, pr: null, reviewScope: 'session-only', ...(profile ? { speedProfile: profile } : {}),
  judge: readingStableIds(session, judgeOf(edits, { verdict, seen }), { speedProfile: profile ?? undefined }) });

const findings = (report) => report.findings.filter((f) => f.kind === 'edit_under_negative_requirement');
const statuses = (report) => findings(report).map((f) => [f.status, f.disclosureReason ?? null]);
const forbiddenLabels = (seen) => seen.filter((r) => r.challenge && r.label.includes(':forbidden')).map((r) => r.label);
const withheldBy = (report) => Object.entries(report.counts.forbiddenEdits?.withheld ?? {}).filter(([, n]) => n > 0)
  .map(([reason, n]) => `${reason}:${n}`);

/** Every profile: the proposal is withheld by code for `reason`, never asked, never DECIDE. */
async function assertWithheld(session, edit, reason, label) {
  for (const profile of PROFILES) {
    const seen = [];
    const report = await reviewOf(session, [edit], { profile, seen });
    const at = `${label}, ${profile}`;
    assert.deepEqual(findings(report), [], at);
    assert.deepEqual(forbiddenLabels(seen), [], `${at}: no challenger is asked`);
    assert.deepEqual(withheldBy(report), [`${reason}:1`], at);
    assert.notEqual(report.sessionStatus, 'DECIDE', at);
  }
}

// ---- 1. an action not proved to have landed -------------------------------------------------------------------------

test('M33 N repair 1: an action whose outcome is not proved succeeded is withheld violation_not_landed, never asked', async (t) => {
  const lockEdit = (session) => ({ text: 'The lockfile was ruled out and edited.',
    instruction: receipt(instructionWith(session, X.CODEX_WORDS.lock), 'instruction', X.CODEX_WORDS.lock),
    violation: receipt(editOf(session), 'code', X.CODEX_WORDS.added) });
  // Codex apply_patch: the older JSON's exit_code 1 (or 0: not the native typed status, so not proved), a plain
  // verification failure, a bare word, and no output at all.
  for (const [name, output] of [['json1', X.PATCH_OUTPUTS.json1], ['json0', X.PATCH_OUTPUTS.json0],
    ['failed', X.PATCH_OUTPUTS.failed], ['done', X.PATCH_OUTPUTS.done], ['none', null]]) {
    const session = await codex(t, { output });
    assert.notEqual(session.actionOutcomeOf(editOf(session)), 'succeeded', name);
    await assertWithheld(session, lockEdit(session), 'violation_not_landed', `codex apply_patch ${name}`);
  }
  // A failure in the native header is typed `failed`, and the slicer keeps no body of a patch that did not apply: the
  // quote has nothing to ground in.
  const failed = await codex(t, { output: X.PATCH_OUTPUTS.native1 });
  assert.equal(failed.actionOutcomeOf(editOf(failed)), 'failed');
  await assertWithheld(failed, lockEdit(failed), 'violation_ungrounded', 'codex apply_patch native1');
  // The native header's exit 0 is a typed success: the same proposal is asked and published.
  const landed = await codex(t, { output: X.PATCH_OUTPUTS.native0 });
  assert.equal(landed.actionOutcomeOf(editOf(landed)), 'succeeded');
  for (const profile of PROFILES)
    assert.deepEqual(statuses(await reviewOf(landed, [lockEdit(landed)], { profile })), [['DECIDE', null]], String(profile));
  // A Codex command whose result was never recorded.
  const cmd = await codex(t, { command: true });
  await assertWithheld(cmd, { text: 't', instruction: receipt(instructionWith(cmd, 'Bump'), 'instruction', 'Do not touch package-lock.json'),
    violation: receipt(idOf(cmd, (e) => e.operation === 'command'), 'action', 'npm publish --access public') },
  'violation_not_landed', 'codex command without a result');
  // A Claude Code Write with no tool result: outcome none.
  const write = await claude(t, 'noResult');
  assert.equal(write.actionOutcomeOf(writeOf(write)), 'none');
  await assertWithheld(write, { text: 't', instruction: receipt(instructionWith(write, X.WORDS.human), 'instruction', X.WORDS.human),
    violation: receipt(writeOf(write), 'code', X.WORDS.origin) }, 'violation_not_landed', 'claude write without a result');
});

// ---- 2. text a harness added to a user row ----------------------------------------------------------------------------

test('M33 N repair 2 (H2): a Claude Code meta row makes no ask at all; no ask or event carries a mark', async (t) => {
  // H2 (C-02 "H2 actor provenance"): the recorder's mark decides the actor for every route,
  // not only this one. A loaded skill's text, a slash command's expansion (and the command's row, which records no typed
  // arguments) are no ask, so no instruction event holds the skill's rule.
  for (const shape of ['skill', 'skillMeta', 'skillSource', 'slash']) {
    const value = await sliced(t, X.claudeRows(shape));
    assert.ok(value.ask.every((a) => !a.text.includes(X.WORDS.rule)), shape);
    assert.ok(value.ask.every((a) => !Object.hasOwn(a, 'meta')), shape);
    const session = sessionOf(value);
    assert.equal(instructionWith(session, X.WORDS.rule), undefined, shape);
    assert.ok(session.events.every((e) => !Object.hasOwn(e, 'meta')), shape);
  }
  // A recording with no meta row: no ask, no event carries the member (its ledger bytes are unchanged).
  for (const rows of [R.claudeRows(), R.claudeRows({ between: 'queuedLift' }), X.claudeRows('selection'), X.claudeRows('shell')]) {
    const value = await sliced(t, rows);
    assert.ok(value.ask.every((a) => !Object.hasOwn(a, 'meta')));
    assert.ok(!JSON.stringify(value).includes('"meta":'));
  }
});

test('M34 labels: the route reads the slicer\'s labels, never tag names; the context tag lists are deleted', () => {
  // M34 labels (C-02 "Slice-time labels"; owner decision 2026-10-06): no reader decides from a list of tag names which
  // text of a record is a harness's. The tag lists and their span reader are gone; the element-shape helpers that remain
  // serve only the recorder's own element formats (a prompt command's elements, the legacy fallback's opening element,
  // and — M34 labels review, F5 — the call id a task notification carries). D98 (F1): and the one carrier rule of a task
  // notification, which reads the recorder's kind field and never a tag name. D99 (F1 guard): and the origin keys a
  // known recorder writes beside that kind, which the recorder census reads to log any other one.
  for (const name of ['EMBEDDED_CONTEXT_TAGS', 'contextElementSpans', 'SLASH_COMMAND_TAGS', 'slashCommandArgs',
    'LOCAL_COMMAND_OUTPUT_TAGS', 'isLocalCommandOutput', 'META_OPENINGS', 'CONTEXT_TAGS', 'HUMAN_REPLY_TAGS',
    'isHarnessContext', 'isHarnessContextSpans', 'humanReplyText']) assert.equal(context[name], undefined, name);
  assert.deepEqual(Object.keys(context).sort(), ['NOTIFICATION_ORIGIN_KEYS', 'RECORDER_COMMAND_ELEMENTS',
    'TASK_NOTIFICATION_KIND', 'claudeNotificationCarrier', 'isWhollyElements', 'notificationOriginOf', 'recorderCommand',
    'recorderNotificationCallId', 'startsWithElement']);
});

test('M33 N repair 2; M34 labels: a harness row is never "You said"; a human row is read whole, an attached file never', async (t) => {
  const edit = (session, quote = X.WORDS.rule) => ({ text: 'Ruled out by text a harness added.',
    instruction: receipt(instructionWith(session, quote), 'instruction', quote),
    violation: receipt(writeOf(session), 'code', X.WORDS.origin) });
  // A row the recorder marks as its own (a skill's text) is no instruction event at all, so the rule's words can be
  // cited from no instruction: cited from the human's own ask they are not that ask's words.
  for (const shape of ['skill', 'skillMeta', 'skillSource']) {
    const session = await claude(t, shape);
    assert.equal(instructionWith(session, X.WORDS.rule), undefined, shape);
    await assertWithheld(session, { ...edit(session, X.WORDS.ask), instruction: receipt(instructionWith(session, X.WORDS.ask),
      'instruction', X.WORDS.rule) }, 'instruction_ungrounded', shape);
  }
  // A local command's own row (no origin: harness) holds no instruction event; neither do a user `!` command's rows,
  // which carry no origin here.
  const slash = await claude(t, 'slash');
  assert.deepEqual(slash.events.filter((e) => e.kind === 'instruction'), []);
  const shell = await claude(t, 'shell');
  assert.equal(instructionWith(shell, X.WORDS.rule), undefined);
  await assertWithheld(shell, { ...edit(shell, X.WORDS.ask), instruction: receipt(instructionWith(shell, X.WORDS.ask),
    'instruction', X.WORDS.rule) }, 'instruction_ungrounded', 'shell');
  // M34 labels (owner decision 2026-10-06): a row the host typed the human's is the human's, every block of it whole —
  // an IDE selection or opened file sent with the ask, a hook's output inline — so the route no longer sets its words
  // aside by their tags: the edit is read.
  for (const shape of ['selection', 'opened', 'hook']) {
    const session = await claude(t, shape);
    const cited = session.event(instructionWith(session, X.WORDS.rule));
    assert.equal(cited.authority, 'human', shape);
    const sourceMap = Object.fromEntries(session.events.map((e) => [e.id, session.sourcesFor(e)]));
    const read = forbidden.readForbiddenEdit(edit(session), { session, sourceMap });
    assert.equal(read.withheld, undefined, shape);
    assert.equal(read.edit?.breach, 'wrote', shape);
  }
  // A file the human attached (an @-mention, labelled `human` + `attached`) is material the human supplied, never words
  // the human said: a quote from it is withheld by its label.
  const attached = new Session({ sessionKey: 'm34-attached', blobs: { file: `# Notes\n${X.WORDS.rule}\n`, ask: X.WORDS.ask,
    body: X.BODY }, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], turn: 'T1',
      text: [{ sourceKey: 'ask', fromByte: 0, untilByte: Buffer.byteLength(X.WORDS.ask) }] },
    { id: 'I1-1', kind: 'instruction', authority: 'human', supersedes: [], turn: 'T1', markers: ['attached'],
      text: [{ sourceKey: 'file', fromByte: 0, untilByte: Buffer.byteLength(`# Notes\n${X.WORDS.rule}\n`) }] },
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'create', operation: 'write', paths: [{ path: X.PATH }], command: [],
      input: [], turn: 'T1', changes: [{ path: X.PATH, before: [], diff: [],
        after: [{ sourceKey: 'body', fromByte: 0, untilByte: Buffer.byteLength(X.BODY) }],
        extent: { chars: X.BODY.length, lines: 5, truncated: false, cap: null, recorded: true, redactedLines: 0, priorState: 'none' } }] },
    { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result: 'succeeded', turn: 'T1',
      terminalStatusProven: true, exitCode: null, output: [], sourceOfResult: 'native' },
  ].map((event, sequence) => ({ ...event, sequence })) });
  const attachedMap = Object.fromEntries(attached.events.map((e) => [e.id, attached.sourcesFor(e)]));
  assert.equal(forbidden.readForbiddenEdit({ text: 't', instruction: receipt('I1-1', 'instruction', X.WORDS.rule),
    violation: receipt('A1', 'code', X.WORDS.origin) }, { session: attached, sourceMap: attachedMap }).withheld,
  'instruction_context');
  // The CLI loader reads the same rows the same way.
  for (const shape of ['skill', 'slash']) {
    const session = await loaded(t, X.claudeRows(shape));
    assert.equal(instructionWith(session, X.WORDS.rule), undefined, `${shape} (loader)`);
  }
  // M33 brittleness H2 (META_OPENINGS deleted): a row that opens as a skill's text but carries no mark is read as the
  // recorder kept it, a human's, so the edit is read.
  const unmarked = new Session({ sessionKey: 'm33-n-unmarked', blobs: { skill: X.SKILL_TEXT, body: X.BODY }, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], turn: 'T1',
      text: [{ sourceKey: 'skill', fromByte: 0, untilByte: Buffer.byteLength(X.SKILL_TEXT) }] },
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'create', operation: 'write', paths: [{ path: X.PATH }], command: [],
      input: [], turn: 'T1', changes: [{ path: X.PATH, before: [], diff: [],
        after: [{ sourceKey: 'body', fromByte: 0, untilByte: Buffer.byteLength(X.BODY) }],
        extent: { chars: X.BODY.length, lines: 5, truncated: false, cap: null, recorded: true, redactedLines: 0, priorState: 'none' } }] },
    { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result: 'succeeded', turn: 'T1',
      terminalStatusProven: true, exitCode: null, output: [], sourceOfResult: 'native' },
  ].map((event, sequence) => ({ ...event, sequence })) });
  const sourceMap = Object.fromEntries(unmarked.events.map((e) => [e.id, unmarked.sourcesFor(e)]));
  const read = forbidden.readForbiddenEdit({ text: 't', instruction: receipt('I1', 'instruction', X.WORDS.rule),
    violation: receipt('A1', 'code', X.WORDS.origin) }, { session: unmarked, sourceMap });
  assert.equal(read.withheld, undefined);
  assert.equal(read.edit?.breach, 'wrote');
});

test('M33 N repair 2 controls: the human\'s own words beside a harness block still publish DECIDE', async (t) => {
  for (const load of [(t2) => claude(t2, 'beside'), (t2) => loaded(t2, X.claudeRows('beside'))]) {
    const session = await load(t);
    const edit = { text: 'The human ruled the coincidence out.',
      instruction: receipt(instructionWith(session, X.WORDS.human), 'instruction', X.WORDS.human),
      violation: receipt(writeOf(session), 'code', X.WORDS.origin) };
    for (const profile of PROFILES)
      assert.deepEqual(statuses(await reviewOf(session, [edit], { profile })), [['DECIDE', null]], String(profile));
  }
});

test('M33 N repair 2 bytes (H2): an ask a persisted M33 N ledger marks `meta` moves no request byte of any route', async (t) => {
  const value = await sliced(t, X.claudeRows('skill'));
  // The shape an M33 N slicer persisted: the skill's text as an ask of its own turn, marked.
  const persisted = structuredClone(value);
  persisted.ask.push({ turn: persisted.ask.at(-1).turn, text: X.SKILL_TEXT, meta: true });
  assert.notDeepEqual(persisted, value);
  const requests = (ledgerValue, reviewScope, profile) => reviewRun.planWindowRequests({ session: sessionOf(ledgerValue),
    reviewScope, ...(profile ? { speedProfile: profile } : {}) }).requests
    .map(({ request }) => [request.system, request.prompt, request.evidencePrompt]);
  for (const [reviewScope, profiles] of [['session-only', PROFILES], ['combined', [null]]])
    for (const profile of profiles)
      assert.deepEqual(requests(persisted, reviewScope, profile), requests(value, reviewScope, profile), `${reviewScope}, ${profile}`);
});

// ---- 3. the revert proof fails closed -----------------------------------------------------------------------------------

test('M33 N repair 3: a later action of the turn whose effect on files cannot be read voids the revert proof', async (t) => {
  const edit = (session) => ({ text: 'The human ruled the coincidence out.',
    instruction: receipt(instructionWith(session, X.WORDS.human), 'instruction', X.WORDS.human),
    violation: receipt(writeOf(session), 'code', X.WORDS.origin) });
  // Undone by an Edit, then the line appended again by a command; then a command that names no path; a command before
  // the undo: never "undone", so DECIDE, and an unsettled check is never CLEAN.
  for (const shape of ['undoAppend', 'undoStash', 'commandBetween']) {
    const session = await claude(t, shape);
    for (const profile of PROFILES) {
      const report = await reviewOf(session, [edit(session)], { profile });
      assert.deepEqual(statuses(report), [['DECIDE', null]], `${shape}, ${profile}`);
      assert.equal(Object.hasOwn(findings(report)[0], 'revertedBy'), false, `${shape}, ${profile}`);
      assert.equal(report.counts.forbiddenEdits.reverted, 0, `${shape}, ${profile}`);
      const unsettled = await reviewOf(session, [edit(session)], { profile,
        verdict: (item) => (item.type === TYPE ? 'uncertain' : 'not-refuted') });
      assert.equal(unsettled.sessionStatus, 'NO_FINDINGS', `${shape}, ${profile}: never CLEAN`);
      const result = unsettled.windowResults[0].challenge.results.find((r) => r.type === TYPE);
      assert.equal(Object.hasOwn(result, ledger.FORBIDDEN_EDIT_REVERTED_MARK), false, `${shape}, ${profile}`);
    }
    assert.equal(forbidden.forbiddenRevert(session, session.event(writeOf(session)), edit(session).violation, 'wrote'), null, shape);
  }
  // A read after the undo reads nothing into the file: still FYI self_corrected.
  const readAfter = await claude(t, 'undoRead');
  for (const profile of PROFILES)
    assert.deepEqual(statuses(await reviewOf(readAfter, [edit(readAfter)], { profile })), [['FYI', 'self_corrected']], String(profile));
});

// ---- 4. text an edit kept unchanged -----------------------------------------------------------------------------------

test('M33 N repair 4: text an edit kept unchanged is not what it wrote; a copy it added is', async (t) => {
  const kept = await claude(t, 'kept');
  const edit = (session, quote) => ({ text: 't', instruction: receipt(instructionWith(session, X.WORDS.human), 'instruction',
    X.WORDS.human), violation: receipt(editOf(session), 'code', quote) });
  await assertWithheld(kept, edit(kept, X.WORDS.origin), 'violation_not_written', 'claude edit kept the line');
  // The line it did write in that edit is written.
  assert.equal(forbidden.readForbiddenEdit(edit(kept, X.WORDS.added), { session: kept,
    sourceMap: Object.fromEntries(kept.events.map((e) => [e.id, kept.sourcesFor(e)])) }).edit.breach, 'wrote');
  // A second copy of a line the file already held is written.
  const copied = await claude(t, 'copied');
  assert.deepEqual(statuses(await reviewOf(copied, [edit(copied, X.WORDS.origin)])), [['DECIDE', null]]);
  // A Codex patch's context line is kept, never written; its changed line is.
  const name = await codex(t, { patch: 'name' });
  const ask = instructionWith(name, X.CODEX_WORDS.name);
  const patch = (quote) => ({ text: 't', instruction: receipt(ask, 'instruction', X.CODEX_WORDS.name),
    violation: receipt(editOf(name), 'code', quote) });
  await assertWithheld(name, patch(X.CODEX_WORDS.context), 'violation_not_written', 'codex context line');
  assert.deepEqual(statuses(await reviewOf(name, [patch(X.CODEX_WORDS.version)])), [['DECIDE', null]]);
  // A before side not recorded whole that holds the quote: what the edit kept cannot be told apart — withheld.
  const TEXT = { ask: `${X.WORDS.ask} ${X.WORDS.human}`, before: `${X.WORDS.origin}\n`, after: `${X.WORDS.origin}\nMore.\n` };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key]) }];
  const extent = (truncated) => ({ chars: 80, lines: 2, truncated, cap: truncated ? 10 : null, recorded: true, redactedLines: 0,
    priorState: 'edit-text' });
  const session = (truncated) => new Session({ sessionKey: 'm33-n-before-cut', blobs: { ...TEXT }, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), turn: 'T1' },
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'edit', operation: 'edit', paths: [{ path: X.PATH }], command: [], input: [],
      changes: [{ path: X.PATH, before: whole('before'), after: whole('after'), diff: [], extent: extent(false),
        beforeExtent: extent(truncated) }], turn: 'T1' },
    { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result: 'succeeded',
      terminalStatusProven: true, exitCode: null, output: [], sourceOfResult: 'native', turn: 'T1' },
  ].map((event, sequence) => ({ ...event, sequence })) });
  const read = (s, quote) => forbidden.readForbiddenEdit({ text: 't', instruction: receipt('I1', 'instruction', X.WORDS.human),
    violation: receipt('A1', 'code', quote) }, { session: s, sourceMap: Object.fromEntries(s.events.map((e) => [e.id, s.sourcesFor(e)])) });
  assert.deepEqual(read(session(false), X.WORDS.origin), { withheld: 'violation_not_written' });
  assert.deepEqual(read(session(true), X.WORDS.origin), { withheld: 'violation_not_written' });
  assert.equal(read(session(false), 'More.').edit.breach, 'wrote');
  assert.deepEqual(read(session(true), 'More.'), { withheld: 'violation_not_written' }, 'what the cut hid may hold it');
});

// ---- 5. the declared narrowings -----------------------------------------------------------------------------------------

test('M33 N repair 5 (declared): a helper\'s change the parent undid, and a revert by a command, stay DECIDE', async (t) => {
  const checkout = await claude(t, 'checkout');
  const edit = { text: 't', instruction: receipt(instructionWith(checkout, X.WORDS.human), 'instruction', X.WORDS.human),
    violation: receipt(writeOf(checkout), 'code', X.WORDS.origin) };
  for (const profile of PROFILES)
    assert.deepEqual(statuses(await reviewOf(checkout, [edit], { profile })), [['DECIDE', null]], String(profile));
  // A linked helper wrote the line; the parent's own Edit removed it later in the same turn.
  const TEXT = { ask: `${X.WORDS.ask} ${X.WORDS.human}`, brief: 'SYNTHETIC_N_BRIEF: draft it.', body: X.BODY,
    line: `${X.WORDS.origin}\n`, none: '', report: 'SYNTHETIC_N_REPORT: drafted.', said: 'SYNTHETIC_N_SAID: done.' };
  const whole = (key) => (TEXT[key] ? [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key]) }] : []);
  const extent = (key, priorState = 'none') => ({ chars: TEXT[key].length, lines: 1, truncated: false, cap: null, recorded: true,
    redactedLines: 0, priorState });
  const ok = (id, extra) => ({ id: `${id}-r`, kind: 'observation', invocation: id, callKey: id, phase: 'terminal', result: 'succeeded',
    terminalStatusProven: true, exitCode: null, output: [], sourceOfResult: 'native', ...extra });
  const T1 = { turn: 'T1' }, H = { childId: 'w', turn: 'T1' };
  const session = new Session({ sessionKey: 'm33-n-helper-undo', adapter: 'claude', blobs: { ...TEXT }, children: [
    { assignmentEvent: 'D1', childId: 'w', childSession: 'm33-n-helper-undo/child:w', sessionKey: 'm33-n-helper-undo/child:w',
      relation: 'spawn', state: 'verified', historyStart: null }], events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
    { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Agent', operation: 'delegate', paths: [], command: [], input: whole('brief'),
      changes: [], ...T1 },
    { id: 'child:w:I1', kind: 'instruction', authority: 'agent', supersedes: [], text: whole('brief'), ...H },
    { id: 'child:w:A1', kind: 'invocation', callKey: 'child:w:A1', tool: 'create', operation: 'write', paths: [{ path: X.PATH }],
      command: [], input: [], changes: [{ path: X.PATH, before: [], after: whole('body'), diff: [], extent: extent('body') }], ...H },
    ok('child:w:A1', H),
    { id: 'D1-r', kind: 'observation', invocation: 'D1', callKey: 'D1', phase: 'terminal', result: 'succeeded',
      terminalStatusProven: true, exitCode: null, output: whole('report'), sourceOfResult: 'native', ...T1 },
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'edit', operation: 'edit', paths: [{ path: X.PATH }], command: [], input: [],
      changes: [{ path: X.PATH, before: whole('line'), after: [], diff: [], extent: { ...extent('line', 'edit-text'), chars: 0 },
        beforeExtent: extent('line') }], ...T1 },
    ok('A1', T1),
    { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('said'), ...T1 },
  ].map((event, sequence) => ({ ...event, sequence })) });
  const helper = { text: 't', instruction: receipt('I1', 'instruction', X.WORDS.human), violation: receipt('child:w:A1', 'code', X.WORDS.origin) };
  // M35: a helper is a session of its own; its edit is proposed in the window that holds its session (M36 phase 3, D68 K:
  // small, it shares its parent's window, under its own heading).
  const inHelper = (request) => ((request.window?.parts ?? [request.window]).some((part) => part?.session?.childId === 'w')
    ? [helper] : []);
  // M36 phase 3 review (D68 K, c6): sharing one window, the helper's written line and the parent's removal of it are both
  // shown as code; the violation's quote grounds in the event it cites (the helper's write), which names its session, so
  // packing changes nothing: the helper's change the parent undid stays DECIDE, as reviewed apart (the declared narrowing).
  for (const profile of PROFILES) {
    const report = await reviewOf(session, inHelper, { profile });
    assert.deepEqual(statuses(report), [['DECIDE', null]], String(profile));
    assert.equal(Object.hasOwn(report.counts, 'ambiguousQuotes'), false, String(profile));
  }
});

// ---- 6. a human choice between them -------------------------------------------------------------------------------------

test('M33 N repair 6: a plan the human approved between them is named, shown whole in every profile, and refutes', async (t) => {
  // M33 brittleness L3: no tool-name list in evidence code; the recorder adapter's flag (`humanChoice`) decides.
  assert.equal(ledger.HUMAN_CHOICE_TOOLS, undefined);
  assert.equal(ledger.humanChoice({ kind: 'invocation', humanChoice: true }), true);
  assert.equal(ledger.humanChoice({ kind: 'invocation', tool: 'ExitPlanMode' }), false);
  // The note no longer limits a lift to the named instructions, and names the choices and an action that did not apply.
  assert.ok(challenge.FORBIDDEN_EDIT_NOTE.includes('humanChoicesBetween'));
  assert.ok(!challenge.FORBIDDEN_EDIT_NOTE.includes('no instruction named in humanInstructionsBetween allowed it'));
  assert.match(challenge.FORBIDDEN_EDIT_NOTE, /approved/);
  assert.match(challenge.FORBIDDEN_EDIT_NOTE, /did not apply/);
  const session = await claude(t, 'plan');
  const plan = idOf(session, (e) => e.kind === 'invocation' && e.tool === 'ExitPlanMode');
  assert.equal(session.event(plan).humanChoice, true, 'the Claude adapter flags its plan approval');
  const edit = { text: 'The human ruled the coincidence out.',
    instruction: receipt(instructionWith(session, X.WORDS.human), 'instruction', X.WORDS.human),
    violation: receipt(writeOf(session), 'code', X.WORDS.origin) };
  for (const profile of PROFILES) {
    const seen = [];
    const report = await reviewOf(session, [edit], { profile, seen });
    const sent = seen.filter((r) => r.challenge && r.label.includes(':forbidden'));
    assert.ok(sent.length >= 3, String(profile));
    for (const request of sent) {
      assert.deepEqual(request.challenge.items[0].candidate.humanChoicesBetween, [plan], String(profile));
      assert.ok(request.prompt.includes(X.WORDS.approved), `${profile}: the approval is shown`);
    }
    assert.deepEqual(findings(report), [], String(profile));
    assert.equal(report.sessionStatus, 'CLEAN', `${profile}: a refutation is a completed check`);
    assert.equal(report.counts.forbiddenEdits.challenged.refuted, 1, String(profile));
  }
  // With nothing between, no choice is named and the candidate keeps its shape.
  const motivating = await sessionOf(await sliced(t, R.claudeRows()));
  const item = (report) => report.windowResults[0].challenge.results.find((r) => r.type === TYPE).candidate;
  const plain = await reviewOf(motivating, [{ text: 't',
    instruction: receipt(instructionWith(motivating, R.WORDS.constraint), 'instruction', R.WORDS.constraint),
    violation: receipt(writeOf(motivating), 'code', R.WORDS.origin) }]);
  assert.equal(Object.hasOwn(item(plain), 'humanChoicesBetween'), false);
  // A named choice the window was not shown (here: dropped from its source map) withholds the edit: the lift could be in it.
  const sourceMap = Object.fromEntries(session.events.filter((e) => e.id !== session.observationFor(plan).id).map((e) => [e.id, session.sourcesFor(e)]));
  assert.deepEqual(forbidden.readForbiddenEdit(edit, { session, sourceMap }), { withheld: 'history_partial' });
});

// ---- 7. a null member ------------------------------------------------------------------------------------------------

test('M33 N repair 7: "forbiddenEdits": null proposes nothing, is never re-asked, and leaves the window complete', async (t) => {
  const session = await sessionOf(await sliced(t, R.claudeRows()));
  for (const profile of PROFILES) {
    let asked = 0;
    const report = await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only', ...(profile ? { speedProfile: profile } : {}),
      judge: async (request) => {
        if (request.challenge) return challenger()(request);
        asked++;
        return { decisions: [], pivots: [], claims: [], requirements: [], forbiddenEdits: null };
      } });
    assert.equal(asked, report.windowResults.length, `${profile}: never asked again`);
    assert.equal(report.counts.proposalReasks.asked, 0, String(profile));
    assert.equal(Object.hasOwn(report.counts, 'forbiddenEdits'), false, String(profile));
    assert.equal(report.sessionReview, 'complete', String(profile));
    assert.equal(report.sessionStatus, 'CLEAN', String(profile));
  }
  assert.deepEqual(forbidden.forbiddenListOf({ forbiddenEdits: null }), []);
  assert.deepEqual(forbidden.forbiddenListOf({ forbiddenEdits: 'x' }), [null], 'any other non-list is still one unreadable proposal');
});

// ---- 8. duplicates and words cut mid-word ---------------------------------------------------------------------------------

test('M33 N repair 8: the same edit proposed twice is asked once, published once and counted once', async (t) => {
  const session = await sessionOf(await sliced(t, R.claudeRows()));
  const one = { text: 'The human ruled it out.',
    instruction: receipt(instructionWith(session, R.WORDS.constraint), 'instruction', R.WORDS.constraint),
    violation: receipt(writeOf(session), 'code', R.WORDS.origin) };
  for (const profile of PROFILES) {
    const seen = [];
    const report = await reviewOf(session, [one, { ...one, text: 'Said again in other words.' }], { profile, seen });
    assert.equal(findings(report).length, 1, String(profile));
    assert.deepEqual(forbiddenLabels(seen), ['challenge:w1:forbidden:b1:p1', 'challenge:w1:forbidden:b1:p2',
      'challenge:w1:forbidden:b1:p3'], String(profile));
    assert.equal(report.counts.forbiddenEdits.proposed, 2, String(profile));
    assert.equal(report.counts.forbiddenEdits.merged, 1, String(profile));
    assert.deepEqual(report.counts.forbiddenEdits.challenged, { upheld: 1, refuted: 0, unsettled: 0, unexecuted: 0 }, String(profile));
    assert.equal(report.windowResults[0].forbiddenEdits.merged, 1, String(profile));
  }
});

test('M33 N repair 8: a quote that starts or ends inside a word is not grounded', async (t) => {
  const session = await sessionOf(await sliced(t, R.claudeRows()));
  const write = writeOf(session);
  // C-01 event identity: the ask's event, found by its words, never by a positional id.
  const ask = instructionWith(session, R.WORDS.constraint);
  const base = { text: 't', instruction: receipt(ask, 'instruction', R.WORDS.constraint), violation: receipt(write, 'code', R.WORDS.origin) };
  const cases = [
    [{ instruction: receipt(ask, 'instruction', R.WORDS.constraint.slice(1)) }, 'instruction_ungrounded'],
    [{ instruction: receipt(ask, 'instruction', 'Ignore the naming coincidence with the old proj') }, 'instruction_ungrounded'],
    [{ violation: receipt(write, 'code', R.WORDS.origin.slice(1)) }, 'violation_ungrounded'],
    [{ violation: receipt(write, 'code', 'Sonah grew out of my old project Sona') }, 'violation_ungrounded'],
  ];
  for (const [over, reason] of cases) await assertWithheld(session, { ...base, ...over }, reason, JSON.stringify(over));
  // A reportedBy cut mid-word is never asked as a disclosure (ungrounded: the one disclosure check of both routes keeps
  // this rule, M33 brittleness M4 session route); the edit goes on.
  const said = idOf(session, (e) => e.kind === 'commentary' && textOf(session, e).includes(R.WORDS.strength));
  const report = await reviewOf(session, [{ ...base, reportedBy: receipt(said, 'commentary', R.WORDS.strength.slice(3)) }]);
  assert.deepEqual(statuses(report), [['DECIDE', null]]);
  assert.equal(report.counts.disclosures.rejected.ungrounded, 1);
  // Whole words, punctuation at either end, and a quote of text with no spaces between its words are grounded.
  const cjk = new Session({ sessionKey: 'm33-n-cjk', blobs: { ask: '请不要提及旧项目的名字。', body: '名字来自旧项目。\n' }, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], turn: 'T1',
      text: [{ sourceKey: 'ask', fromByte: 0, untilByte: Buffer.byteLength('请不要提及旧项目的名字。') }] },
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'create', operation: 'write', paths: [{ path: X.PATH }], command: [],
      input: [], turn: 'T1', changes: [{ path: X.PATH, before: [], diff: [],
        after: [{ sourceKey: 'body', fromByte: 0, untilByte: Buffer.byteLength('名字来自旧项目。\n') }],
        extent: { chars: 9, lines: 1, truncated: false, cap: null, recorded: true, redactedLines: 0, priorState: 'none' } }] },
    { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result: 'succeeded', turn: 'T1',
      terminalStatusProven: true, exitCode: null, output: [], sourceOfResult: 'native' },
  ].map((event, sequence) => ({ ...event, sequence })) });
  const read = forbidden.readForbiddenEdit({ text: 't', instruction: receipt('I1', 'instruction', '不要提及旧项目'),
    violation: receipt('A1', 'code', '来自旧项目') }, { session: cjk,
    sourceMap: Object.fromEntries(cjk.events.map((e) => [e.id, cjk.sourcesFor(e)])) });
  assert.equal(read.edit?.breach, 'wrote');
});
