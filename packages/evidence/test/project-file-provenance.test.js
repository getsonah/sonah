// The fourth review of the code step (medium): the session review counted a CLAUDE.md the agent wrote in the session as
// the person's words — a decision filed "you settled it" on the agent's own file, a later change filed as an edit
// against what the person said, a claim labelled contradicted by "the project's instruction file". One rule now decides
// whose words a project instruction file is, for the code step and the session review alike (ledger.js
// `personsProjectFile`): given to the main agent, and its path changed by no typed write, edit or delete of the session
// that the record does not prove failed or cancelled. Every recording here is synthetic (invented rules, paths and
// code), read through the real slicer and adapter; no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { row, humanAsk, call, result, said, load } from './m33-u-unasked-fixture.js';
import { personsProjectFile, projectFilesBefore, deriveColumn, groundFinding, contradictionSourceOf,
  FORBIDDEN_EDIT_REJECTIONS, shownProjectInstructions, writtenInSession, groundDecision } from '../src/ledger.js';
import { buildNarrativePrompt, PROJECT_INSTRUCTIONS_HEADER } from '../src/prompt.js';
import { planWindowRequests } from '../src/run-review.js';
import { readForbiddenEdit } from '../src/forbidden.js';
import { actorOf } from '../src/code-context.js';

const ASK = 'Add left-pad support to the formatter.';
const PERSON_RULE = 'Keep every function under twenty lines.';
const AGENT_RULE = 'Never add a runtime dependency.';
const OWN = `# Rules for sub\n${AGENT_RULE}\n`;
const PACKAGE = '{"name":"fmt","dependencies":{"left-pad":"1.3.0"}}\n';
const DEPENDENCY = '"left-pad":"1.3.0"';
const CLAIM = 'The formatter keeps every function under twenty lines.';
const attachment = (value) => row({ type: 'attachment', attachment: value });

/** The ask; the person's CLAUDE.md, given at the start; the agent's own sub/CLAUDE.md, written by a Write (`write`:
 *  'ok', 'failed', or none), then given back to it as a nested project file when it read a file beside it; the write
 *  that added the dependency; the agent's closing words. */
const rows = ({ write = 'ok', writtenAs = '/repo/sub/CLAUDE.md' } = {}) => [
  humanAsk(ASK),
  attachment({ type: 'instructions', files: [{ path: '/repo/CLAUDE.md', type: 'Project',
    content: `# Project rules\n${PERSON_RULE}\n` }] }),
  ...(write === null ? [] : [
    call('own', 'Write', { file_path: writtenAs, content: OWN }, 'Writing the folder\'s rules.'),
    write === 'ok' ? result('own', `File created successfully at: ${writtenAs}`, { type: 'create',
      filePath: writtenAs, content: OWN, structuredPatch: [] })
      : result('own', '<tool_use_error>EACCES: permission denied</tool_use_error>', undefined, true)]),
  call('rd', 'Read', { file_path: '/repo/sub/x.js' }),
  result('rd', '     1\texport const x = 1;\n', { type: 'text', file: { filePath: '/repo/sub/x.js',
    content: 'export const x = 1;\n', numLines: 1, startLine: 1, totalLines: 1 } }),
  attachment({ type: 'nested_memory', path: '/repo/sub/CLAUDE.md', displayPath: 'sub/CLAUDE.md',
    content: { path: '/repo/sub/CLAUDE.md', type: 'Project', content: OWN, contentDiffersFromDisk: false } }),
  call('w1', 'Write', { file_path: '/repo/package.json', content: PACKAGE }, 'Adding the dependency.'),
  result('w1', 'File created successfully at: /repo/package.json', { type: 'create', filePath: '/repo/package.json',
    content: PACKAGE, structuredPatch: [] }),
  said(CLAIM),
].map((r, i) => ({ ...r, uuid: `u-provenance-${i + 1}` }));

async function fixture(t, options) {
  const { session } = await load(t, rows(options));
  const files = Object.fromEntries(session.projectInstructions.map((entry) => [entry.path, entry]));
  const write = session.events.find((e) => e.kind === 'invocation' && e.operation === 'write'
    && e.changes?.some((c) => c.path === 'package.json'));
  const statement = session.events.filter((e) => e.kind === 'commentary').at(-1);
  return { session, person: files['CLAUDE.md'], own: files['sub/CLAUDE.md'], write, statement };
}
const quote = (eventId, role, text) => ({ eventId, role, quote: text });
const REPO = { host: 'github.com', id: '0' };

test('fourth review of the code step: one rule decides whose words a project file is, for the code step and the session review', async (t) => {
  const n = await fixture(t);
  assert.ok(n.person && n.own && n.write && n.statement, 'the harness gave the main agent both files');
  // The session holds a typed write of sub/CLAUDE.md that ran: the file is the agent's. The person's stays theirs.
  assert.equal(personsProjectFile(n.session, n.person), true);
  assert.equal(personsProjectFile(n.session, n.own), false);
  // The code step reads the same rule.
  assert.equal(actorOf(n.session, n.person.id), 'person');
  assert.equal(actorOf(n.session, n.own.id), 'agent');
  // A write the record proves failed left nothing behind: the file is the person's again; with no write, too.
  for (const write of ['failed', null]) {
    const other = await fixture(t, { write });
    assert.equal(personsProjectFile(other.session, other.own), true, String(write));
    assert.equal(actorOf(other.session, other.own.id), 'person', String(write));
  }
  // A file given to a helper, or with no path, is never the person's.
  assert.equal(personsProjectFile(n.session, { ...n.person, childId: 'agent-x' }), false);
  assert.equal(personsProjectFile(n.session, { ...n.person, path: null }), false);
  // A helper's typed write counts as the agent's does (the review's surviving mutation M6), whatever the path's
  // spelling; an edit and a delete too; one the record proves cancelled does not.
  const entry = { id: 'P1', kind: 'project-instructions', path: 'sub/CLAUDE.md', childId: null };
  // D98 (F9): read by the one effect rule (session.js `effectOf`), from the change's own typed result.
  const sessionOf = (event, outcome = 'succeeded') => ({ events: [event, { id: `${event.id}.r`, kind: 'observation',
    phase: 'terminal', invocation: event.id, result: outcome, terminalStatusProven: true, sourceOfResult: 'native' }] });
  const change = (operation, path, extra = {}) => ({ id: 'W9', kind: 'invocation', operation, changes: [{ path }], ...extra });
  for (const event of [change('write', 'sub/CLAUDE.md', { childId: 'agent-helper' }), change('edit', './sub/../sub/CLAUDE.md'),
    change('delete', 'sub/CLAUDE.md', { childId: 'agent-helper' })])
    assert.equal(personsProjectFile(sessionOf(event), entry), false, `${event.operation} ${event.childId ?? 'main'}`);
  assert.equal(personsProjectFile(sessionOf(change('write', 'sub/CLAUDE.md', { childId: 'agent-helper' }), 'cancelled'),
    entry), true);
  assert.equal(personsProjectFile(sessionOf(change('read', 'sub/CLAUDE.md')), entry), true, 'a read changes nothing');
});

test('fourth review of the code step: the agent\'s own CLAUDE.md never settles a decision\'s column (D83 (2))', async (t) => {
  const n = await fixture(t);
  // Only the person's file is one a decision may cite as what it answers to.
  assert.deepEqual(projectFilesBefore(n.session, [n.write]), [{ eventId: n.person.id, path: 'CLAUDE.md' }]);
  const column = (file, value) => deriveColumn(n.session, { instruction: quote(file.id, 'project-instructions', value),
    settles: true, settledValueQuote: value }, true, [n.write]);
  const own = column(n.own, AGENT_RULE);
  assert.deepEqual([own.column, own.columnState, own.reason], [null, 'unchecked', 'ambiguous_authority']);
  const persons = column(n.person, PERSON_RULE);
  assert.deepEqual([persons.column, persons.columnState, persons.referredFrom], ['asked-settled', 'grounded', 'CLAUDE.md']);
  // With no write of it, the same file settles the column as the person's.
  const unwritten = await fixture(t, { write: null });
  const settled = deriveColumn(unwritten.session, { instruction: quote(unwritten.own.id, 'project-instructions', AGENT_RULE),
    settles: true, settledValueQuote: AGENT_RULE }, true, [unwritten.write]);
  assert.deepEqual([settled.column, settled.referredFrom], ['asked-settled', 'sub/CLAUDE.md']);
});

test('fourth review of the code step: a change against the agent\'s own CLAUDE.md is no edit against what the person said', async (t) => {
  const n = await fixture(t);
  const sourceMap = { [n.own.id]: [{ role: 'project-instructions', text: OWN }],
    [n.write.id]: [{ role: 'code', text: PACKAGE }] };
  const item = (file) => ({ text: 'The project said never to add a runtime dependency; the agent added left-pad.',
    instruction: quote(file.id, 'project-instructions', AGENT_RULE), violation: quote(n.write.id, 'code', DEPENDENCY) });
  // Step 5 reads it as an instruction that is not the person's, as a file given to a helper.
  assert.equal(readForbiddenEdit(item(n.own), { session: n.session, sourceMap }).withheld, FORBIDDEN_EDIT_REJECTIONS[1]);
  assert.equal(FORBIDDEN_EDIT_REJECTIONS[1], 'instruction_not_human');
  // The ledger withholds the finding as a prohibition that is not a human instruction.
  const candidate = (receipts) => ({ origin: 'session-review', kind: 'edit_under_negative_requirement', title: 't',
    explanation: 'e', scope: 'session-effect', anchor: null, forbiddenEdit: {}, receipts });
  const own = groundFinding({ repo: REPO, session: n.session, pr: null, candidate: candidate([
    quote(n.own.id, 'project-instructions', AGENT_RULE), quote(n.write.id, 'code', DEPENDENCY)]) });
  assert.deepEqual([own.ok, own.reason], [false, 'ambiguous_authority']);
  // With no write of the file, the same edit is read and published, as W1 B reads a person's file.
  const unwritten = await fixture(t, { write: null });
  const map = { [unwritten.own.id]: [{ role: 'project-instructions', text: OWN }],
    [unwritten.write.id]: [{ role: 'code', text: PACKAGE }] };
  const read = readForbiddenEdit({ ...item(unwritten.own), violation: quote(unwritten.write.id, 'code', DEPENDENCY) },
    { session: unwritten.session, sourceMap: map });
  assert.ok(read.edit, `withheld ${read.withheld}`);
  const published = groundFinding({ repo: REPO, session: unwritten.session, pr: null, candidate: candidate([
    quote(unwritten.own.id, 'project-instructions', AGENT_RULE), quote(unwritten.write.id, 'code', DEPENDENCY)]) });
  assert.equal(published.ok, true, published.detail);
});

test('fourth review of the code step: the agent\'s own CLAUDE.md is never "the project\'s instruction file" against a claim', async (t) => {
  const n = await fixture(t);
  const statement = quote(n.statement.id, 'commentary', CLAIM);
  const own = contradictionSourceOf(n.session, [statement, quote(n.own.id, 'project-instructions', AGENT_RULE)]);
  assert.deepEqual([own.ok, own.reason, own.cause], [false, 'receipt_rejected', 'source_not_human']);
  const persons = contradictionSourceOf(n.session, [statement, quote(n.person.id, 'project-instructions', PERSON_RULE)]);
  assert.deepEqual([persons.ok, persons.source], [true, 'project_instructions']);
});

test('release review (low): a project file is compared the way a case-insensitive file system names it, failing closed', async (t) => {
  // The reviewer's probe, through the real slicer and adapter: the agent writes /repo/sub/claude.md, which on a
  // case-insensitive volume (macOS's and Windows' default) is the file Claude Code then gives back as
  // /repo/sub/CLAUDE.md. It was counted as the person's words: the agent's own rule settled a decision's column ("you
  // settled it"), and the code step's actor was the person. Now it is the agent's, as a Write of CLAUDE.md is; and a
  // name written in decomposed Unicode is the same file as its composed spelling.
  for (const writtenAs of ['/repo/sub/claude.md', '/repo/SUB/Claude.MD', '/repo/sub/../sub/CLAUDE.md']) {
    const n = await fixture(t, { writtenAs });
    assert.ok(n.own, writtenAs);
    assert.equal(personsProjectFile(n.session, n.own), false, writtenAs);
    assert.equal(actorOf(n.session, n.own.id), 'agent', writtenAs);
    const own = deriveColumn(n.session, { instruction: quote(n.own.id, 'project-instructions', AGENT_RULE),
      settles: true, settledValueQuote: AGENT_RULE }, true, [n.write]);
    assert.deepEqual([own.column, own.columnState, own.reason], [null, 'unchecked', 'ambiguous_authority'], writtenAs);
    // The person's own CLAUDE.md, at another path, stays theirs.
    assert.equal(personsProjectFile(n.session, n.person), true, writtenAs);
  }
  const entry = { id: 'P1', kind: 'project-instructions', path: 'docs/R\u00e9gles/CLAUDE.md', childId: null };
  const decomposed = { events: [{ id: 'W9', kind: 'invocation', operation: 'write',
    changes: [{ path: 'docs/Re\u0301gles/claude.md' }] }], actionOutcomeOf: () => 'succeeded' };
  assert.equal(personsProjectFile(decomposed, entry), false);
  // A write to another file whose name only resembles it changes nothing.
  const other = { events: [{ id: 'W9', kind: 'invocation', operation: 'write', changes: [{ path: 'docs/Regles/claude.md' }] }],
    actionOutcomeOf: () => 'succeeded' };
  assert.equal(personsProjectFile(other, entry), true);
});

test('second release review (low): a path written with the working directory in another case is the same file', async (t) => {
  // The reviewer's probe, through the real slicer and adapter: with the working directory /repo, a Write to
  // /REPO/sub/CLAUDE.md or /Repo/sub/claude.md. The slicer strips the working directory's prefix by its exact spelling,
  // so the write's path stays absolute while the file Claude Code gives back is sub/CLAUDE.md; on a case-insensitive
  // volume they are one file. Both are placed under the working directory the recording states, then compared.
  for (const writtenAs of ['/REPO/sub/CLAUDE.md', '/Repo/sub/claude.md']) {
    const n = await fixture(t, { writtenAs });
    assert.equal(n.session.workingDirectory, '/repo');
    const write = n.session.events.find((e) => e.kind === 'invocation' && e.operation === 'write'
      && e.changes?.some((c) => c.path === writtenAs));
    assert.ok(write, `${writtenAs}: the slicer left the path absolute`);
    assert.equal(writtenInSession(n.session, n.own), true, writtenAs);
    assert.equal(personsProjectFile(n.session, n.own), false, writtenAs);
    assert.equal(actorOf(n.session, n.own.id), 'agent', writtenAs);
    const own = deriveColumn(n.session, { instruction: quote(n.own.id, 'project-instructions', AGENT_RULE),
      settles: true, settledValueQuote: AGENT_RULE }, true, [n.write]);
    assert.deepEqual([own.column, own.columnState, own.reason], [null, 'unchecked', 'ambiguous_authority'], writtenAs);
    assert.deepEqual(shownProjectInstructions(n.session).map(({ entry }) => entry.path), ['CLAUDE.md'], writtenAs);
    assert.equal(personsProjectFile(n.session, n.person), true, writtenAs);
  }
  // A write to the same name in another folder changes nothing; nor does any write when no working directory is known
  // and the paths differ as written.
  const elsewhere = await fixture(t, { writtenAs: '/other/sub/CLAUDE.md' });
  assert.equal(personsProjectFile(elsewhere.session, elsewhere.own), true);
  const entry = { id: 'P1', kind: 'project-instructions', path: 'sub/CLAUDE.md', childId: null };
  const sessionOf = (workingDirectory) => Object.defineProperty({ events: [{ id: 'W9', kind: 'invocation',
    operation: 'write', changes: [{ path: '/REPO/sub/CLAUDE.md' }] }], actionOutcomeOf: () => 'succeeded' },
  'workingDirectory', { value: workingDirectory });
  assert.equal(personsProjectFile(sessionOf('/repo'), entry), false);
  assert.equal(personsProjectFile(sessionOf('C:\\repo'), { ...entry, path: 'sub\\CLAUDE.md' }), true,
    'another drive\'s folder is another file');
  assert.equal(personsProjectFile(Object.defineProperty({ events: [{ id: 'W9', kind: 'invocation', operation: 'write',
    changes: [{ path: 'c:\\REPO\\Sub\\claude.md' }] }], actionOutcomeOf: () => 'succeeded' }, 'workingDirectory',
  { value: 'C:\\repo' }), { ...entry, path: 'sub\\CLAUDE.md' }), false, 'a drive\'s path, in another case');
  for (const unknown of [null, 'repo']) assert.equal(personsProjectFile(sessionOf(unknown), entry), true, String(unknown));
});

test('release review (low): the session model is never shown the agent\'s own CLAUDE.md as a project file the person wrote', async (t) => {
  // The model's window presents its project instruction files as what the person wrote for the agent (the heading, and
  // the brief: their words count as the person's). A CLAUDE.md the session wrote is the agent's: it is left out of that
  // section (the agent's write of it is an action the window shows), and a decision made without asking you is not
  // checked against it — so a decision the agent made under its own rule can read "made without asking you".
  const n = await fixture(t);
  assert.deepEqual([writtenInSession(n.session, n.own), writtenInSession(n.session, n.person)], [true, false]);
  assert.deepEqual(shownProjectInstructions(n.session).map(({ entry }) => entry.path), ['CLAUDE.md']);
  const { prompt } = planWindowRequests({ session: n.session, reviewScope: 'session-only' }).requests[0].request;
  const section = prompt.slice(prompt.indexOf(PROJECT_INSTRUCTIONS_HEADER[0]));
  const files = section.slice(0, section.indexOf('\n## ', PROJECT_INSTRUCTIONS_HEADER[0].length));
  assert.match(files, /PROJECT INSTRUCTIONS · path=CLAUDE\.md · given to the main agent · role=project-instructions/);
  assert.ok(files.includes(PERSON_RULE));
  assert.ok(!files.includes('sub/CLAUDE.md') && !files.includes(AGENT_RULE), 'the agent\'s file is not among them');
  assert.ok(prompt.includes(AGENT_RULE), 'the agent\'s write of it is still shown, as its action');
  // A decision under the agent's own rule, checked against your message and your file alone: made without asking you.
  const window = { index: 0, events: n.session.events };
  const scopeDigest = /^scopeDigest: (\S+)$/m.exec(buildNarrativePrompt({ session: n.session, window,
    reviewScope: 'session-only' }).prompt)?.[1];
  const ask = n.session.events.find((e) => e.kind === 'instruction' && e.authority === 'human');
  const check = (eventId, role, quote) => ({ instruction: { eventId, role, quote }, relevant: false,
    explanation: 'SYNTHETIC: it says nothing about dependencies.' });
  const decision = groundDecision({ repo: REPO, session: n.session, pr: null, instructionHistoryComplete: true,
    projectFilesShown: true, candidate: { actorSession: n.session.sessionKey, dimension: 'which dependency to add',
      chosen: 'add left-pad', value: DEPENDENCY, valueReceipt: { eventId: n.write.id, field: 'added-code', role: 'code',
        quote: DEPENDENCY }, actions: [n.write.id], instructionReview: { dimension: 'which dependency to add',
        scopeDigest, noRelevantInstruction: true, checks: [check(ask.id, 'instruction', ASK),
          check(n.person.id, 'project-instructions', PERSON_RULE)] } } }).decision;
  assert.deepEqual([decision.column, decision.columnState], ['unasked', 'grounded']);
  // With no write of it, the file is the person's: shown, and a check of it is required.
  const unwritten = await fixture(t, { write: null });
  assert.deepEqual(shownProjectInstructions(unwritten.session).map(({ entry }) => entry.path), ['CLAUDE.md', 'sub/CLAUDE.md']);
  const plan = planWindowRequests({ session: unwritten.session, reviewScope: 'session-only' }).requests[0].request.prompt;
  assert.match(plan, /PROJECT INSTRUCTIONS · path=sub\/CLAUDE\.md · given to the main agent · role=project-instructions/);
});

test('second release review (low): a project file loaded before the agent edits it stays in view, in time order', async (t) => {
  // The reviewer's probe, through the real slicer and adapter: the person's CLAUDE.md pins versions and is loaded at the
  // start; the agent pins left-pad; later, at the person's request, the agent edits that same CLAUDE.md. The file the
  // agent worked under is the person's as it was loaded, so every window shows it, before the edit and after, and the
  // decision to pin is checked against it: it never reads "made without asking you" on the ask alone.
  const PIN_RULE = 'Pin every dependency to an exact version.';
  const LATER_ASK = 'Now add a line to CLAUDE.md saying left-pad is pinned.';
  const NOTE = 'left-pad is pinned at 1.3.0.';
  const probe = [
    humanAsk(ASK),
    attachment({ type: 'instructions', files: [{ path: '/repo/CLAUDE.md', type: 'Project',
      content: `# Project rules\n${PIN_RULE}\n` }] }),
    call('w1', 'Write', { file_path: '/repo/package.json', content: PACKAGE }, 'Adding the dependency, pinned.'),
    result('w1', 'File created successfully at: /repo/package.json', { type: 'create', filePath: '/repo/package.json',
      content: PACKAGE, structuredPatch: [] }),
    said('Added left-pad, pinned at 1.3.0.'),
    humanAsk(LATER_ASK),
    call('e1', 'Edit', { file_path: '/repo/CLAUDE.md', old_string: PIN_RULE, new_string: `${PIN_RULE}\n${NOTE}` }),
    result('e1', 'The file /repo/CLAUDE.md has been updated.', { filePath: '/repo/CLAUDE.md', oldString: PIN_RULE,
      newString: `${PIN_RULE}\n${NOTE}`, originalFile: `# Project rules\n${PIN_RULE}\n`,
      structuredPatch: [{ oldStart: 2, oldLines: 1, newStart: 2, newLines: 2, lines: [`-${PIN_RULE}`, `+${PIN_RULE}`,
        `+${NOTE}`] }], userModified: false, replaceAll: false }),
    said('Noted in CLAUDE.md.'),
  ].map((r, i) => ({ ...r, uuid: `u-provenance-order-${i + 1}` }));
  const { session } = await load(t, probe);
  const person = session.projectInstructions.find((entry) => entry.path === 'CLAUDE.md');
  const write = session.events.find((e) => e.kind === 'invocation' && e.operation === 'write'
    && e.changes?.some((c) => c.path === 'package.json'));
  const edit = session.events.find((e) => e.kind === 'invocation' && e.operation === 'edit'
    && e.changes?.some((c) => c.path === 'CLAUDE.md'));
  assert.ok(person && write && edit && person.afterSequence < write.sequence && write.sequence < edit.sequence);
  // The session edited the file: it is not the person's to settle a column with (whole session, fails closed) ...
  assert.equal(writtenInSession(session, person), true);
  assert.equal(personsProjectFile(session, person), false);
  // ... but it was loaded before that edit, so it is shown, in a window before the edit and in the whole session.
  assert.deepEqual(shownProjectInstructions(session, write.sequence + 1).map(({ entry }) => entry.path), ['CLAUDE.md']);
  assert.deepEqual(shownProjectInstructions(session).map(({ entry }) => entry.path), ['CLAUDE.md']);
  const { prompt } = planWindowRequests({ session, reviewScope: 'session-only' }).requests[0].request;
  const section = prompt.slice(prompt.indexOf(PROJECT_INSTRUCTIONS_HEADER[0]));
  assert.ok(section.slice(0, section.indexOf('\n## ', PROJECT_INSTRUCTIONS_HEADER[0].length)).includes(PIN_RULE));
  // The decision to pin, checked against the ask alone: the shown file was not checked, so it is not "made without
  // asking you".
  const window = { index: 0, events: session.events };
  const scopeDigest = /^scopeDigest: (\S+)$/m.exec(buildNarrativePrompt({ session, window,
    reviewScope: 'session-only' }).prompt)?.[1];
  const ask = session.events.find((e) => e.kind === 'instruction' && e.authority === 'human');
  const decide = (extra) => groundDecision({ repo: REPO, session, pr: null, instructionHistoryComplete: true,
    projectFilesShown: true, candidate: { actorSession: session.sessionKey, dimension: 'how to pin left-pad',
      chosen: 'pin left-pad exactly', value: DEPENDENCY, valueReceipt: { eventId: write.id, field: 'added-code',
        role: 'code', quote: DEPENDENCY }, actions: [write.id], ...extra } }).decision;
  const askOnly = decide({ instructionReview: { dimension: 'how to pin left-pad', scopeDigest,
    noRelevantInstruction: true, checks: [{ instruction: { eventId: ask.id, role: 'instruction', quote: ASK },
      relevant: false, explanation: 'SYNTHETIC: it names no version policy.' }] } });
  assert.deepEqual([askOnly.column, askOnly.columnState], [null, 'unchecked']);
  // Cited as what the decision answers to, the file the agent later edited is not the person's to settle it: not
  // checked, never "made without asking you".
  const cited = decide({ constrainedBy: { instruction: { eventId: person.id, role: 'project-instructions',
    quote: PIN_RULE }, settles: false, settledValueQuote: null } });
  assert.deepEqual([cited.column, cited.columnState], [null, 'unchecked']);
  assert.ok(cited.reasons.includes('ambiguous_authority'), cited.reasons.join(','));
  // A file loaded only after the agent wrote it stays out of view, as before (the agent's own sub/CLAUDE.md).
  const n = await fixture(t);
  assert.deepEqual(shownProjectInstructions(n.session).map(({ entry }) => entry.path), ['CLAUDE.md']);
});
