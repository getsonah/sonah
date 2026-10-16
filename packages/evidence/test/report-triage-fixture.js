// D96, D97: a synthetic session and the reports a review of it writes, shaped like the reports Sonah stores, for the
// report's items and their tiers (triage.js) and for the readers that render them (the report model, the page and the
// .md). Every string, path, command, hash and id here is invented.
//
// The session: one message with seven asks and a later one with an eighth; a plan that names a decision made without
// asking, a decision not to act and a change of approach; a write, a failing test run passed over, a Read call a
// permission rule refused (passed over: a failure of a tool that is not a command), a push auto mode blocked, a removal
// you refused yourself, a check left running in the background, an edit against "Do not touch the CI config", an edit
// against "Do not edit the README" the agent told you about, a docs file with two statements, a test file and a passing
// check; a closing message with claims (one contradicted by a recorded result, one confirmed and later contradicted by
// the code, one not checked, one resting on a check that did not finish, one the agent corrected, one confirmed), what it
// did not do, and a correction.
//
// The reports:
//   (a) `triageReport`      the code step of code-pass/10: published findings of every kind with `anchorSpan`,
//                           `anchorSha256`, `anchorChanged`; a question from the review and one from a finding; a
//                           withheld finding; `files` with `added`, `removed`, `what`, `asks`; `triage` (a kept proposal,
//                           a bounded one each way, the refused-call ceiling for `permission-rule` and `automode-blocked`
//                           and none for `user-rejected`, a listed claim raised and one left listed, an entry for a row
//                           folded into another item); `triageDropped` and `filesDropped`. Every item kind of
//                           ledger.js REPORT_ITEM_KINDS is in it at least once, joined as the CLI joins it
//                           (code-pass.js `withCodePass`, ask-code-links.js `withAskCodeLinks`).
//   (b) `codePass9Report`   the same with the code step of code-pass/9: no triage, no file notes or counts, no anchor
//                           span.
//   (c) `sessionOnlyReport` no code step.
//   (d) `codePass3Report`   the code step of code-pass/3: questions with no `from`, `id` or `check`; `rejected`,
//                           `groups`, `votes`, `codeStatus`; an ask, a claim and a decision checked `shown-in-code`.
//   (e) `codePass8Report`   the code step of code-pass/8: `held`; a withheld entry of `what: 'held'`; a deleted file and
//                           an `outside_root` file with no `sha256`.
//   (f) `codePass1Report`   the code step of code-pass/1: one finding of kind `code_issue`.
// Each call returns a new object, so a test may change what it gets.

import { createHash } from 'node:crypto';
import { Session } from '../src/session.js';
import { withCodePass } from '../src/code-pass.js';
import { withAskCodeLinks } from '../src/ask-code-links.js';
import { codeDossier } from '../src/code-context.js';

export const TRIAGE_KEY = 'triage-fixture';
const sha = (text) => createHash('sha256').update(text).digest('hex');
const idOf = (c) => `sha256:${c.repeat(64).slice(0, 64)}`;

/** The texts of the session and of the files of the change, every one invented. */
export const TRIAGE_TEXT = Object.freeze({
  ask1: 'Add a retry to the client. Send Retry-After in whole seconds. Log every retry. Keep the timeout at 5 seconds. '
    + 'Do not touch the CI config. Do not edit the README. Update the changelog.',
  ask2: 'Also add a test for the wait.',
  plan: 'I will send the wait in milliseconds, since the server already uses them. I will not add jitter, a fixed wait '
    + 'is enough here. Exponential backoff is too slow here, so I am switching to a fixed wait.',
  testRun: 'Tests: 1 failed, 6 passed\ncache kept after retry',
  readDenied: 'Permission to read .env.example was denied.',
  pushDenied: 'Auto mode blocked this command.',
  removeDenied: 'The user rejected this tool use.',
  checkRun: 'wait sent: 2 seconds\nREADME ok',
  final: 'Done. The tests pass. The wait is sent in whole seconds. The retry count is three. The timeout check ran. '
    + 'The cache is cleared on retry. The README describes the retries. I edited the README to describe the retries. '
    + 'I did not add logging. The timeout is not applied to the retry wait. I did not update the changelog. I did not '
    + 'remove the build folder.',
  correction: 'Correction: the cache is not cleared on retry.',
  testDone: 'I added a test for the wait.',
  ciBefore: 'node-version: 18\n',
  ciAfter: 'node-version: 20\n',
  readmeBefore: 'Retries: none.\n',
  readmeAfter: 'Retries: three, with a fixed wait.\n',
  docs: '# Retry\n\nRetries wait 5 seconds.\nThe client retries three times.\n',
  retryBase: 'export async function withRetry(call) {\n  return call();\n}\n',
  retry: [
    'export async function withRetry(call, headers, { tries = 3 } = {}) {',
    '  const timeoutMs = 5000;',
    '  for (let attempt = 1; attempt <= tries; attempt++) {',
    '    try {',
    '      return await call({ timeoutMs });',
    '    } catch (error) {',
    '      const waitMs = 2000;',
    "      headers['Retry-After'] = waitMs;",
    '      if (attempt === tries) throw error;',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n'),
  test: [
    "import { withRetry } from '../src/retry.js';",
    "test('retries', async () => {",
    '  await withRetry(async () => 1, {});',
    '});',
    '',
  ].join('\n'),
});
const T = TRIAGE_TEXT;

/** The files of the change at review time (and src/retry.js at the start commit), with their hashes. */
export const TRIAGE_FILES = Object.freeze({
  'src/retry.js': Object.freeze({ text: T.retry, sha256: sha(T.retry), baseText: T.retryBase, baseSha256: sha(T.retryBase) }),
  'test/retry.test.js': Object.freeze({ text: T.test, sha256: sha(T.test) }),
  '.github/workflows/ci.yml': Object.freeze({ text: T.ciAfter, sha256: sha(T.ciAfter) }),
  'README.md': Object.freeze({ text: T.readmeAfter, sha256: sha(T.readmeAfter) }),
  'docs/retry.md': Object.freeze({ text: T.docs, sha256: sha(T.docs) }),
});

// ---- the session ------------------------------------------------------------------------------------------------------

function builder() {
  const blobs = {};
  const events = [];
  let n = 0;
  const put = (text) => {
    if (!text) return [];
    const key = `b${n++}`;
    blobs[key] = text;
    return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
  };
  const push = (event) => { events.push({ sequence: events.length, ...event }); };
  const result = (id, { result = 'succeeded', exitCode = result === 'succeeded' ? 0 : 1, output = '',
    terminalStatusProven = true } = {}) => push({ id: `${id}-r`, kind: 'observation', invocation: id, callKey: id,
    phase: 'terminal', result, exitCode, terminalStatusProven, output: put(output), sourceOfResult: 'native' });
  return {
    blobs, events,
    ask: (id, text) => push({ id, kind: 'instruction', authority: 'human', supersedes: [], text: put(text) }),
    say: (id, text, phase = 'working') => push({ id, kind: 'commentary', phase, beforeInvocation: null, text: put(text) }),
    run: (id, command, outcome = {}) => {
      push({ id, kind: 'invocation', callKey: id, tool: 'bash', operation: 'command', paths: [], command: put(command),
        input: [], changes: [] });
      result(id, outcome);
    },
    /** A call the recorder typed as refused or left running (`recorded`), with its result. */
    refused: (id, { tool, operation = 'command', command = '', path = null, recorded, output = '' }) => {
      push({ id, kind: 'invocation', callKey: id, tool, operation, paths: path ? [{ path }] : [], command: put(command),
        input: [], changes: [], recorded: { tool, ...recorded } });
      result(id, { result: 'unknown', exitCode: null, terminalStatusProven: false, output });
    },
    change: (id, path, { operation = 'write', before = null, after }) => {
      push({ id, kind: 'invocation', callKey: id, tool: operation === 'write' ? 'create' : operation, operation,
        paths: [{ path }], command: [], input: [], changes: [{ path, before: before === null ? [] : put(before),
          after: put(after), diff: [], extent: { chars: after.length, lines: after.split('\n').length, truncated: false,
            cap: null, recorded: true, redactedLines: 0, priorState: before === null ? 'none' : 'first-write' } }] });
      result(id);
    },
  };
}

/** The recorded session every report of this fixture reviews. */
export function triageSession() {
  const b = builder();
  b.ask('I1', T.ask1);
  b.say('C1', T.plan);
  b.change('W1', 'src/retry.js', { after: T.retry });
  b.run('R1', 'npm test', { result: 'failed', exitCode: 1, output: T.testRun });
  b.refused('X1', { tool: 'Read', operation: 'other', path: '.env.example', recorded: { denial: 'permission-rule' },
    output: T.readDenied });
  b.refused('X2', { tool: 'bash', command: 'git push origin main', recorded: { denial: 'automode-blocked' },
    output: T.pushDenied });
  b.refused('X3', { tool: 'bash', command: 'rm -rf build', recorded: { denial: 'user-rejected' }, output: T.removeDenied });
  b.refused('X4', { tool: 'bash', command: 'npm run check:timeout', recorded: { backgroundTaskId: 'job-1' } });
  b.change('W2', '.github/workflows/ci.yml', { operation: 'edit', before: T.ciBefore, after: T.ciAfter });
  b.change('W3', 'README.md', { operation: 'edit', before: T.readmeBefore, after: T.readmeAfter });
  b.change('W4', 'docs/retry.md', { after: T.docs });
  b.change('W5', 'test/retry.test.js', { after: T.test });
  b.run('R2', 'node scripts/check-wait.js', { output: T.checkRun });
  b.say('C2', T.final, 'final');
  b.say('C3', T.correction, 'final');
  b.ask('I2', T.ask2);
  b.say('C4', T.testDone, 'final');
  return new Session({ sessionKey: TRIAGE_KEY, adapter: 'claude', events: b.events, blobs: b.blobs, children: [] });
}

// ---- the session review's rows ------------------------------------------------------------------------------------------

const R = (role, eventId, quote) => ({ eventId, role, quote, sessionKey: TRIAGE_KEY });
const ask = (quote, status, extra = {}) => ({ text: `SYNTHETIC ask: ${quote}`, instruction: R('instruction', 'I1', quote),
  status, ...extra });
const decision = (fields) => ({ actorSession: TRIAGE_KEY, value: null, valueReceipt: null, valueState: 'unchecked',
  actions: [], stated: null, constrainedBy: null, instructionReview: null, columnState: 'grounded', amends: [],
  materiality: 'material', materialityRule: 'synthetic', relevance: 'unchecked', reasons: [], ...fields });
const promise = (c, quote, status, extra = {}) => ({ id: idOf(c), stated: R('commentary', 'C2', quote),
  text: `SYNTHETIC claim: ${quote}`, status, receipts: [R('commentary', 'C2', quote)], ...extra });

/** Indexes of the rows the code step and the tests name. */
export const ROWS = Object.freeze({
  askAdd: 0, askSeconds: 1, askLog: 2, askTimeout: 3, askCi: 4, askReadme: 5, askChangelog: 6, askTest: 7,
  claimTestsPass: 0, claimSeconds: 1, claimRetries: 2, claimTimeoutRan: 3, claimReadme: 4,
  writtenWait: 0, writtenRetries: 1,
  contradicted: 0, corrected: 1, editCi: 2, editReadme: 3, legacy: 4,
  notActing: 0, unasked: 1, chose: 2, settled: 3, whetherAsked: 4,
  failedTests: 0, refusedRead: 1, blockedPush: 2, rejectedRemove: 3, background: 4,
});

/** A finished session review of `triageSession` (a session-only review's rows, as code published them). `legacy`: and a
 *  finding of the retired combined route's code review (`origin: 'code-review'`), as an older report holds it. */
function sessionRows({ legacy = false } = {}) {
  return {
    repo: { host: 'github.com', id: '0' }, pr: null, reviewScope: 'session-only', hasSessionEvidence: true,
    gaps: [], coverage: 'complete', coverageBeforeUnrecorded: 'complete', sessionReview: 'complete',
    sessionStatus: 'DECIDE', codeCoverage: 'missing', promptVersion: 'sonah.narrative/37',
    requirements: [
      ask('Add a retry to the client', 'done', { deliverable: R('code', 'W1', 'export async function withRetry(') }),
      ask('Send Retry-After in whole seconds', 'done', { deliverable: R('code', 'W1', "headers['Retry-After'] = waitMs;") }),
      ask('Log every retry', 'not-done', { shortfall: R('commentary', 'C2', 'I did not add logging.') }),
      ask('Keep the timeout at 5 seconds', 'partly-done', { deliverable: R('code', 'W1', 'const timeoutMs = 5000;'),
        shortfall: R('commentary', 'C2', 'The timeout is not applied to the retry wait.') }),
      ask('Do not touch the CI config', 'not-checked', { reason: 'deliverable_ungrounded' }),
      ask('Do not edit the README', 'not-checked', { reason: 'challenge_unsettled' }),
      ask('Update the changelog', 'not-done', { shortfall: R('commentary', 'C2', 'I did not update the changelog.') }),
      { text: 'SYNTHETIC ask: Also add a test for the wait.', instruction: R('instruction', 'I2', 'Also add a test for the wait.'),
        status: 'done', deliverable: R('commentary', 'C4', 'I added a test for the wait.') },
    ],
    promises: [
      promise('a', 'The tests pass.', 'open'),
      promise('b', 'The wait is sent in whole seconds.', 'verified', { receipts: [R('commentary', 'C2',
        'The wait is sent in whole seconds.'), R('observation', 'R2-r', 'wait sent: 2 seconds')] }),
      promise('c', 'The retry count is three.', 'open'),
      promise('d', 'The timeout check ran.', 'incomplete', { restsOn: ['X4'] }),
      promise('e', 'The README describes the retries.', 'verified', { receipts: [R('commentary', 'C2',
        'The README describes the retries.'), R('observation', 'R2-r', 'README ok')] }),
    ],
    writtenClaims: [
      { id: idOf('f'), stated: R('code', 'W4', 'Retries wait 5 seconds.'), text: 'SYNTHETIC statement: the docs say '
        + 'retries wait 5 seconds.', label: 'contradicted', receipts: [R('code', 'W4', 'Retries wait 5 seconds.'),
        R('observation', 'R2-r', 'wait sent: 2 seconds')] },
      { id: idOf('g'), stated: R('code', 'W4', 'The client retries three times.'), text: 'SYNTHETIC statement: the docs '
        + 'say the client retries three times.', label: 'unverified', receipts: [R('code', 'W4',
        'The client retries three times.')] },
    ],
    findings: [
      { id: idOf('h'), origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE',
        contradictionSource: 'result', title: 'SYNTHETIC claim contradicted by a recorded result', scope: 'session-effect',
        anchor: null, receipts: [R('commentary', 'C2', 'The tests pass.'), R('observation', 'R1-r', 'Tests: 1 failed')] },
      { id: idOf('i'), origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', disclosureReason: 'self_corrected',
        contradictionSource: 'result', title: 'SYNTHETIC claim the agent corrected', scope: 'session-effect', anchor: null,
        receipts: [R('commentary', 'C2', 'The cache is cleared on retry.'), R('observation', 'R1-r', 'cache kept after retry')],
        resolvedBy: { observation: R('observation', 'R1-r', 'cache kept after retry'),
          statement: R('commentary', 'C3', 'Correction: the cache is not cleared on retry.') } },
      { id: idOf('j'), origin: 'session-review', kind: 'edit_under_negative_requirement', status: 'DECIDE', breach: 'wrote',
        title: 'SYNTHETIC edit against what you said', scope: 'session-effect', anchor: null,
        receipts: [R('instruction', 'I1', 'Do not touch the CI config'), R('code', 'W2', 'node-version: 20')] },
      { id: idOf('k'), origin: 'session-review', kind: 'edit_under_negative_requirement', status: 'FYI', breach: 'wrote',
        disclosureReason: 'disclosed', disclosedBy: R('commentary', 'C2', 'I edited the README to describe the retries.'),
        title: 'SYNTHETIC edit against what you said, told', scope: 'session-effect', anchor: null,
        receipts: [R('instruction', 'I1', 'Do not edit the README'), R('code', 'W3', 'Retries: three, with a fixed wait.')] },
      ...(legacy ? [{ id: idOf('l'), origin: 'code-review', kind: 'code_issue', status: 'DECIDE', scope: 'current-code',
        title: 'SYNTHETIC combined-route code issue: the wait is a fixed number',
        explanation: 'SYNTHETIC the wait does not follow the server.', anchor: { path: 'src/retry.js', startLine: 7, endLine: 7 },
        receipts: [R('code', 'W1', 'const waitMs = 2000;')] }] : []),
    ],
    decisions: [
      decision({ id: idOf('1'), dimension: 'jitter', chosen: 'no jitter', notActing: true, column: 'unasked',
        stated: R('commentary', 'C1', 'I will not add jitter, a fixed wait is enough here') }),
      decision({ id: idOf('2'), dimension: 'wait unit', chosen: 'milliseconds', column: 'unasked', actions: ['W1'],
        stated: R('commentary', 'C1', 'I will send the wait in milliseconds'),
        valueReceipt: R('code', 'W1', 'const waitMs = 2000;'), valueState: 'grounded' }),
      decision({ id: idOf('3'), dimension: 'retry count', chosen: 'three retries', column: 'asked-chose', actions: ['X2'],
        constrainedBy: { instruction: R('instruction', 'I1', 'Add a retry to the client'), settles: false,
          settledValueQuote: null } }),
      decision({ id: idOf('4'), dimension: 'timeout', chosen: '5 seconds', column: 'asked-settled', actions: ['W1'],
        constrainedBy: { instruction: R('instruction', 'I1', 'Keep the timeout at 5 seconds'), settles: true,
          settledValueQuote: '5 seconds' } }),
      decision({ id: idOf('5'), dimension: 'build folder', chosen: 'remove the build folder', column: 'unasked',
        columnState: 'unchecked', actions: ['X3'] }),
    ],
    pivots: [{ abandoned: 'exponential backoff', adopted: 'a fixed wait', whyAbandoned: 'SYNTHETIC it was too slow',
      receipts: [R('commentary', 'C1', 'Exponential backoff is too slow here, so I am switching to a fixed wait')] }],
    failures: [
      { eventId: 'R1-r', outcome: 'ran-failed', form: 'exit', action: 'R1', tool: 'bash', handling: 'passed-over',
        response: R('commentary', 'C2', 'Done.') },
      { eventId: 'X1-r', outcome: 'did-not-run', form: 'denial', action: 'X1', tool: 'Read', handling: 'passed-over',
        response: R('commentary', 'C2', 'Done.') },
      { eventId: 'X2-r', outcome: 'did-not-run', form: 'denial', action: 'X2', tool: 'bash', handling: 'acted-on',
        response: R('action', 'W2', '.github/workflows/ci.yml') },
      { eventId: 'X3-r', outcome: 'did-not-run', form: 'denial', action: 'X3', tool: 'bash', handling: 'told-human',
        response: R('commentary', 'C2', 'I did not remove the build folder.') },
      { eventId: 'X4-r', outcome: 'no-terminal-status', form: 'background', action: 'X4', tool: 'bash',
        handling: 'not-checked', reason: 'response_ungrounded' },
    ],
    counts: { decisions: 5, byColumn: { 'asked-settled': 1, 'asked-chose': 1, unasked: 2 }, uncheckedColumn: 1 },
  };
}

// ---- the code step ------------------------------------------------------------------------------------------------------

const FILE_LINES = Object.fromEntries(Object.entries(TRIAGE_FILES).map(([path, f]) => [path, f.text.split('\n')]));
const BASE_LINES = { 'src/retry.js': T.retryBase.split('\n') };
/** A code receipt as the code step publishes one: the file's content id, the quote, its lines, the file's hash on that
 *  side and the span the quote was grounded in. */
function codeReceipt(path, line, quote, { side = 'new', endLine = line } = {}) {
  const lines = side === 'new' ? FILE_LINES[path] : BASE_LINES[path];
  const file = TRIAGE_FILES[path];
  return { eventId: `${side === 'new' ? 'file' : 'base'}:${sha(`${side}:${path}`).slice(0, 16)}`, role: 'code', side, quote,
    path, startLine: line, endLine, sha256: side === 'new' ? file.sha256 : file.baseSha256,
    span: lines.slice(line - 1, endLine).join('\n') };
}
/** The anchor fields code-pass/10 adds to a published finding: the anchor's lines as read (at most 12 of at most 160
 *  characters, the cut counted), the file's hash on that side, and the anchor's lines the change added or modified. */
function anchorFields(anchor, changed) {
  const lines = FILE_LINES[anchor.path].slice(anchor.startLine - 1, anchor.endLine);
  return { anchorSpan: { startLine: anchor.startLine, lines, linesCut: 0, charsCut: 0 },
    anchorSha256: TRIAGE_FILES[anchor.path].sha256, anchorChanged: changed };
}

/** The dossier the code step builds from the session rows, so each ref names its row as the code step names it. */
function refsOf(report, session) {
  const items = codeDossier({ report, session });
  return (source, index) => {
    const item = items.find((i) => i.source === source && i.index === index);
    if (!item) throw new Error(`no dossier item for ${source}[${index}]`);
    return { key: item.key, kind: item.kind, source: item.source, index: item.index, id: item.id };
  };
}

const FINDING_IDS = Object.freeze({ bug: idOf('m'), ask: idOf('n'), claim: idOf('o'), contract: idOf('p'), test: idOf('q') });
const holds = (explanation) => ({ verdict: 'holds', explanation, receipts: [] });

/** The published findings of the code step of code-pass/9 and later (with `anchorFields` from code-pass/10). */
function codeFindings(ref, { anchors }) {
  const sessionStep = (step, quote) => ({ step, source: 'session', eventId: 'I1', role: 'instruction', quote });
  const fileStep = (step, path, line, quote) => ({ step, source: 'file', ...codeReceipt(path, line, quote) });
  const finding = (fields, anchor, changed) => ({ origin: 'code-review', status: 'DECIDE', scope: 'current-code',
    foundByLenses: [fields.lens], claims: [], input: 'SYNTHETIC a call that fails once', anchor,
    ...fields, ...(anchors ? anchorFields(anchor, changed) : {}) });
  const retry = (startLine, endLine = startLine) => ({ path: 'src/retry.js', side: 'new', startLine, endLine });
  const header = "headers['Retry-After'] = waitMs;";
  return [
    finding({ id: FINDING_IDS.bug, kind: 'bug', lens: 'behaviour', title: 'Retry-After is sent in milliseconds, not seconds',
      claims: [{ text: 'SYNTHETIC the header takes the wait as it is.', verdict: 'holds' }],
      trace: [sessionStep('You asked for whole seconds.', 'Send Retry-After in whole seconds'),
        fileStep('The header is set to the wait in milliseconds.', 'src/retry.js', 8, header)],
      leadsFrom: [ref('requirements', ROWS.askSeconds)], receipts: [codeReceipt('src/retry.js', 8, header)],
      check: holds('SYNTHETIC traced the header to line 8.') }, retry(8), [8]),
    finding({ id: FINDING_IDS.ask, kind: 'ask_not_met', lens: 'ask', title: 'The change adds no changelog entry',
      trace: [sessionStep('You asked for a changelog entry.', 'Update the changelog'),
        fileStep('The retry is new, and no changelog line names it.', 'src/retry.js', 1,
          'export async function withRetry(')],
      leadsFrom: [ref('requirements', ROWS.askChangelog)],
      receipts: [codeReceipt('src/retry.js', 1, 'export async function withRetry(')],
      check: holds('SYNTHETIC no changelog file is in the change.') }, retry(1), [1]),
    finding({ id: FINDING_IDS.claim, kind: 'claim_false', lens: 'claims', title: 'The wait is 2000, so it is not whole seconds',
      trace: [fileStep('The wait is a number of milliseconds.', 'src/retry.js', 7, 'const waitMs = 2000;')],
      leadsFrom: [ref('promises', ROWS.claimSeconds)], receipts: [codeReceipt('src/retry.js', 7, 'const waitMs = 2000;')],
      check: holds('SYNTHETIC the wait is in milliseconds.') }, retry(7), [7]),
    finding({ id: FINDING_IDS.contract, kind: 'contract_break', lens: 'contracts',
      title: 'withRetry now needs a headers argument that callers do not pass',
      trace: [fileStep('The signature gains a headers argument.', 'src/retry.js', 1, 'withRetry(call, headers,')],
      leadsFrom: [ref('decisions', ROWS.unasked)], receipts: [codeReceipt('src/retry.js', 1, 'withRetry(call, headers,')],
      check: holds('SYNTHETIC a caller passes one argument.') }, retry(1), [1]),
    finding({ id: FINDING_IDS.test, kind: 'weak_test', lens: 'tests', title: 'The test passes whether or not a retry happens',
      trace: [fileStep('The call never fails, so no retry runs.', 'test/retry.test.js', 3,
        'await withRetry(async () => 1, {});')],
      leadsFrom: [], receipts: [codeReceipt('test/retry.test.js', 3, 'await withRetry(async () => 1, {});')],
      check: holds('SYNTHETIC the call returns at once.') },
    { path: 'test/retry.test.js', side: 'new', startLine: 3, endLine: 3 }, [3]),
  ];
}

/** The open questions of the code step of code-pass/7 and later: one from the review, one from a finding its check
 *  found real but not against your goal. */
function codeQuestions(ref) {
  return [
    { id: 'Q1', question: 'Should a timeout also count as a retry? The ask names the timeout, not the retry.',
      from: 'review', concerns: ref('requirements', ROWS.askTimeout),
      quote: { source: 'session', eventId: 'I1', role: 'instruction', quote: 'Keep the timeout at 5 seconds' },
      check: { verdict: 'sound', explanation: 'SYNTHETIC the premise holds.' } },
    { id: 'Q2', question: 'The wait is fixed, not read from the server', from: 'finding',
      concerns: ref('decisions', ROWS.unasked), quote: null,
      finding: { title: 'The wait is fixed, not read from the server', kind: 'missed_case',
        anchor: { path: 'src/retry.js', side: 'new', startLine: 7, endLine: 7 } },
      check: { verdict: 'refuted', reason: 'not_against_goal', explanation: 'SYNTHETIC as stated, and no ask covers it.' } },
  ];
}

/** What the code step of code-pass/7 and later withheld: a finding its check refuted, which names an ask. */
const codeWithheld = (ref) => [{ what: 'finding', reason: 'verify_refuted', text: 'SYNTHETIC the CI change breaks the build',
  kind: 'bug', lens: 'behaviour', anchor: { path: '.github/workflows/ci.yml', side: 'new', startLine: 1, endLine: 1 },
  leadsFrom: [ref('requirements', ROWS.askCi)],
  check: { verdict: 'refuted', reason: 'incorrect', explanation: 'SYNTHETIC Node 20 runs the build.' } }];

const fileRow = (path, type, { hunks = 1, counts = null, note = null } = {}) => ({ path, type, state: 'shown',
  sha256: TRIAGE_FILES[path].sha256, hunks, ...(counts ? { added: counts[0], removed: counts[1] } : {}),
  ...(note ? { what: note.what, asks: note.asks } : {}) });

/** The joined report: the session rows with `codePass` beside them and each row the code step named its code check
 *  (`withCodePass`), then each ask's links to what the code step tied to it (`withAskCodeLinks`). */
function joined(rows, codePass, checks, session) {
  return withAskCodeLinks(withCodePass({ ...rows, codeCoverage: codePass.coverage }, { codePass, checks }), session);
}
const claimFalseCheck = (findings) => new Map([[`promises:${ROWS.claimSeconds}`, { outcome: 'contradicted-by-code',
  receipts: findings.find((f) => f.id === FINDING_IDS.claim).receipts, by: 'finding', finding: FINDING_IDS.claim }]]);

/** (a) The code step of code-pass/10, beside a finding of the retired combined route (so every item kind is in it). */
export function triageReport(session = triageSession()) {
  const rows = sessionRows({ legacy: true });
  const ref = refsOf(rows, session);
  const S = (source, index) => { const { source: s, index: i, id } = ref(source, index); return { source: s, index: i, id }; };
  const findings = codeFindings(ref, { anchors: true });
  const asks = (...indexes) => indexes.map((i) => S('requirements', i));
  const entry = (r, level, impact, action, label, where = null) => ({ ref: r, level, impact, action, label, where });
  const codePass = {
    version: { snapshot: 'sonah.code-snapshot/10', pass: 'sonah.code-pass/10', verify: 'sonah.code-verify/2',
      triage: { table: 'sonah.tiers/1' } },
    ran: true, base: { kind: 'git', commit: 'b'.repeat(40), how: 'reflog' }, gaps: [], coverage: 'complete',
    files: [
      fileRow('src/retry.js', 'modified', { counts: [11, 2], note: { what: 'Adds the retry loop and sets Retry-After',
        asks: asks(ROWS.askAdd, ROWS.askSeconds) } }),
      fileRow('.github/workflows/ci.yml', 'modified', { counts: [1, 1], note: { what: 'Moves CI to Node 20', asks: [] } }),
      fileRow('README.md', 'modified', { counts: [1, 1], note: { what: 'Describes the retries', asks: [] } }),
      fileRow('docs/retry.md', 'added', { counts: [4, 0] }),
      fileRow('test/retry.test.js', 'added', { counts: [4, 0], note: { what: 'Adds a test for withRetry',
        asks: asks(ROWS.askTest) } }),
    ],
    agent: { turns: 12, tools: { Read: 8, Grep: 3, Glob: 1 }, reads: 6, terminal: 'answered' },
    calls: { review: 1, repair: 1, verify: 6, verifyRepeat: 0, batch: 1, batchRepeat: 0 },
    findings, questions: codeQuestions(ref), withheld: codeWithheld(ref), footer: [],
    triage: [
      // A proposal kept, its place a range other than the anchor's.
      entry({ finding: FINDING_IDS.bug }, 'high', 'A server that reads seconds waits a thousand times too long.',
        'Send the wait in whole seconds.', 'fix the Retry-After unit', codeReceipt('src/retry.js', 7, 'const waitMs = 2000;')),
      // The primary row of a merged item, and an entry for the ask folded into it (never used).
      entry({ finding: FINDING_IDS.ask }, 'high', 'Your release notes will not mention the retry.',
        'Add a changelog entry for the retry.', 'add the changelog entry'),
      entry(S('requirements', ROWS.askChangelog), 'low', 'SYNTHETIC an entry for a folded row.', 'Read the ask.',
        'folded ask'),
      // Bounded by the kind: a contradicted claim is never Good to know (floor); a corrected one never Must act.
      entry({ finding: FINDING_IDS.claim }, 'low', 'You may tell users the wait is in seconds when it is not.',
        'Change the claim or the code.', 'the wait claim'),
      entry(S('findings', ROWS.corrected), 'high', 'SYNTHETIC you may still read the first claim.', 'Read the correction.',
        'the cache claim'),
      // A move with no bound: a weak test proposed low.
      entry({ finding: FINDING_IDS.test }, 'low', 'A broken retry would still pass the test.',
        'Make the call fail once in the test.', 'tighten the retry test'),
      entry({ question: 'Q1' }, 'medium', 'A slow server may never be retried.', 'Decide whether a timeout retries.',
        'timeout and retry'),
      // A listed claim raised (medium or high makes it an item), and one left listed (low).
      entry(S('promises', ROWS.claimRetries), 'high', 'The retry count may not be three.', 'Run a call that fails three times.',
        'check the retry count'),
      entry(S('promises', ROWS.claimTimeoutRan), 'low', 'SYNTHETIC the timeout check may not have run.',
        'Run the timeout check.', 'the timeout check'),
      // The refused-call ceiling: a permission rule (a failure row's own call) and auto mode (a decision's action) cap
      // high at Must know; your own refusal (`user-rejected`) does not.
      entry(S('failures', ROWS.refusedRead), 'high', 'The agent never read the example settings.',
        'Read the example settings yourself.', 'the refused read'),
      entry(S('decisions', ROWS.chose), 'high', 'The work is not pushed.', 'Push the branch yourself.', 'the blocked push'),
      entry(S('decisions', ROWS.whetherAsked), 'high', 'Old build files may stay in the build folder.',
        'Decide whether to remove the build folder.', 'the build folder'),
    ],
    triageDropped: [{ key: 'S99', index: 12, cause: 'triage_key_unknown' }],
    filesDropped: [{ key: 'vendor/lib.js', index: 5, cause: 'file_not_in_change' }],
  };
  return joined(rows, codePass, claimFalseCheck(findings), session);
}

/** (b) The same review with the code step of code-pass/9: no triage, no file notes or counts, no anchor span. */
export function codePass9Report(session = triageSession()) {
  const rows = sessionRows();
  const ref = refsOf(rows, session);
  const findings = codeFindings(ref, { anchors: false });
  const codePass = {
    version: { snapshot: 'sonah.code-snapshot/10', pass: 'sonah.code-pass/9', verify: 'sonah.code-verify/2' },
    ran: true, base: { kind: 'git', commit: 'b'.repeat(40), how: 'reflog' }, gaps: [], coverage: 'complete',
    files: [fileRow('src/retry.js', 'modified'), fileRow('.github/workflows/ci.yml', 'modified'),
      fileRow('README.md', 'modified'), fileRow('docs/retry.md', 'added'), fileRow('test/retry.test.js', 'added')],
    agent: { turns: 12, tools: { Read: 8, Grep: 3, Glob: 1 }, reads: 6, terminal: 'answered' },
    calls: { review: 1, repair: 0, verify: 6, verifyRepeat: 0, batch: 1, batchRepeat: 0 },
    findings, questions: codeQuestions(ref), withheld: codeWithheld(ref), footer: [],
  };
  return joined(rows, codePass, claimFalseCheck(findings), session);
}

/** (c) The same session reviewed with no code step. */
export function sessionOnlyReport() {
  return sessionRows();
}

/** (d) The code step of code-pass/3: its questions have no `from`, `id` or `check`; it kept `rejected`, `groups`,
 *  `votes` and `codeStatus`; an ask, a claim and a decision carry a code check `shown-in-code` (no reader shows it). */
export function codePass3Report(session = triageSession()) {
  const rows = sessionRows();
  const ref = refsOf(rows, session);
  const shownInCode = { outcome: 'shown-in-code', receipts: [codeReceipt('src/retry.js', 2, 'const timeoutMs = 5000;')] };
  rows.requirements[ROWS.askTimeout] = { ...rows.requirements[ROWS.askTimeout], codeCheck: shownInCode };
  rows.promises[ROWS.claimRetries] = { ...rows.promises[ROWS.claimRetries], codeCheck: shownInCode };
  rows.decisions[ROWS.chose] = { ...rows.decisions[ROWS.chose], codeCheck: shownInCode };
  const finding = { origin: 'code-review', lens: 'behaviour', kind: 'missed_case',
    title: 'SYNTHETIC an empty response is retried forever', explanation: 'SYNTHETIC no stop for an empty response.',
    input: 'SYNTHETIC an empty response', trace: [{ step: 'SYNTHETIC the loop', source: 'file',
      ...codeReceipt('src/retry.js', 3, 'for (let attempt = 1; attempt <= tries; attempt++) {') }],
    anchor: { path: 'src/retry.js', side: 'new', startLine: 3, endLine: 3 }, leadsFrom: [ref('requirements', ROWS.askAdd)],
    votes: [{ verdict: 'upheld' }, { verdict: 'upheld' }, { verdict: 'upheld' }], foundByLenses: ['behaviour'],
    scope: 'current-code', receipts: [codeReceipt('src/retry.js', 3, 'for (let attempt = 1; attempt <= tries; attempt++) {')],
    status: 'DECIDE', id: idOf('r') };
  const codePass = {
    version: { snapshot: 'sonah.code-snapshot/3', check: 'sonah.code-check/3', pass: 'sonah.code-pass/3' },
    ran: true, base: { kind: 'git', commit: 'b'.repeat(40), how: 'reflog' },
    files: [{ path: 'src/retry.js', state: 'shown' }, { path: 'test/retry.test.js', state: 'shown' }], rows: 3,
    checks: { byOutcome: { 'shown-in-code': 3 }, byReason: {} }, groups: 1, findings: [finding],
    questions: [{ question: 'SYNTHETIC should a 429 reset the count?', lens: 'behaviour',
      concerns: { key: 'S2', kind: 'ask', source: 'requirements', index: ROWS.askSeconds, id: null },
      quote: { source: 'session', eventId: 'I1', role: 'instruction', quote: 'Send Retry-After in whole seconds' } }],
    rejected: [{ reason: 'out_of_scope', lens: 'contracts', question: false }],
    footer: { listed_by_name: [], clipped: [], withheld: [], failed: [] }, coverage: 'complete', codeStatus: 'DECIDE',
    gaps: [], calls: { check: 1, checkReask: 0, checkRepair: 0, lens: { behaviour: 1, tests: 1, contracts: 1, ask: 1 },
      lensRepair: 0, challengeCheck: 3, challengeFinding: 3 },
  };
  return joined(rows, codePass, new Map(), session);
}

/** (e) The code step of code-pass/8: `held` (no reader reads it since code-pass/9), a withheld entry of `what: 'held'`,
 *  and a deleted file and an `outside_root` file with no `sha256`. */
export function codePass8Report(session = triageSession()) {
  const rows = sessionRows();
  const ref = refsOf(rows, session);
  const findings = codeFindings(ref, { anchors: false });
  const codePass = {
    version: { snapshot: 'sonah.code-snapshot/10', pass: 'sonah.code-pass/8', verify: 'sonah.code-verify/1' },
    ran: true, base: { kind: 'git', commit: 'b'.repeat(40), how: 'reflog' },
    gaps: [{ code: 'code_unreviewable', channel: 'code', scope: 'repository', count: 1, byState: { outside_root: 1 } }],
    coverage: 'complete',
    files: [fileRow('src/retry.js', 'modified'), fileRow('test/retry.test.js', 'added'),
      { path: 'src/old-retry.js', type: 'deleted', state: 'deleted', hunks: 1 },
      { path: '../scratch/notes.txt', state: 'outside_root' }],
    agent: { turns: 9, tools: { Read: 5, Grep: 2, Glob: 1 }, reads: 4, terminal: 'answered' },
    calls: { review: 1, repair: 0, verify: 5, verifyRepeat: 0, batch: 1, batchRepeat: 0 },
    findings,
    held: [{ id: 'H1', statement: 'SYNTHETIC held: the loop stops after three tries.',
      concerns: ref('decisions', ROWS.chose), receipts: [codeReceipt('src/retry.js', 3,
        'for (let attempt = 1; attempt <= tries; attempt++) {')],
      check: { verdict: 'holds', explanation: 'SYNTHETIC held check.' } }],
    questions: codeQuestions(ref),
    withheld: [...codeWithheld(ref), { what: 'held', reason: 'verify_cannot_tell',
      text: 'SYNTHETIC withheld statement found to hold.', check: { verdict: 'cannot_tell', explanation: 'SYNTHETIC a run.' } }],
    footer: [{ kind: 'outside_root', count: 1 }], required: false,
  };
  return joined(rows, codePass, claimFalseCheck(findings), session);
}

/** (f) The code step of code-pass/1: one finding of kind `code_issue`, its `leadsFrom` one ref (not a list) and its
 *  anchor with no side, as that version wrote it. */
export function codePass1Report(session = triageSession()) {
  const rows = sessionRows();
  const ref = refsOf(rows, session);
  const codePass = {
    version: { snapshot: 'sonah.code-snapshot/1', check: 'sonah.code-check/1', pass: 'sonah.code-pass/1' },
    ran: true, files: [{ path: 'src/retry.js', state: 'shown' }], rows: 4,
    checks: { byOutcome: { 'shown-in-code': 1, 'not-checked-in-code': 3 }, byReason: { no_answer: 3 } },
    findings: [{ origin: 'code-review', kind: 'code_issue', title: 'SYNTHETIC the wait ignores the server',
      explanation: 'SYNTHETIC the wait is fixed.', scope: 'current-code',
      anchor: { path: 'src/retry.js', startLine: 7, endLine: 8 },
      receipts: [codeReceipt('src/retry.js', 7, 'const waitMs = 2000;')], status: 'DECIDE',
      leadsFrom: (({ key: _key, ...rest }) => rest)(ref('decisions', ROWS.unasked)), id: idOf('s') }],
    rejected: [], coverage: 'partial', codeStatus: 'DECIDE', gaps: [],
    calls: { check: 1, checkRepair: 0, pass: 1, passRepair: 0 },
  };
  return joined(rows, codePass, new Map(), session);
}

/** Every report of this fixture by its letter, each built anew. */
export const TRIAGE_REPORTS = Object.freeze({ a: triageReport, b: codePass9Report, c: sessionOnlyReport,
  d: codePass3Report, e: codePass8Report, f: codePass1Report });
