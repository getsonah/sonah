// D71 (S4): a synthetic session and its checklist report (a session-only review's statuses and channels: owner decisions
// 2026-10-08 (a)-(h)), for the session page and the PR comment. Every string, path, command and id here is invented.
//
// The session: one request with four asks (one done, one partly done, one not done, one the review could not settle)
// and a later request no row cites (code's own not-checked row); a test run that fails and is passed over; a background
// job and a denied command the agent answers; three web lookups and one fetch whose results are recorded with none of
// their output shown (S7: no failure rows, output-no-status `unread`); a choice not to
// act; a decision of how; claims that are contradicted by the human's message and by a file's recorded content, one that
// rests on a check that never completed, one marked as an assumption, one confirmed; the project's instruction file.

import { Session } from '../../evidence/src/session.js';
import { REQUIREMENT_UNREVIEWED_TEXT } from '../../evidence/src/ledger.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

export const CHECKLIST_TEXT = Object.freeze({
  ask1: 'Add a retry to the fetcher and log each failure. Keep the timeout at 5 seconds. The API returns XML.',
  ask2: 'Also update the changelog.',
  plan: 'I will add three retries; I will not add a backoff, three plain retries are enough here.',
  fetchBody: 'export async function fetchWithRetry(url) {\n  return retry(3, () => fetch(url));\n}\n',
  readmeBefore: 'Version 2.0 of the fetcher.\n',
  readmeAfter: 'Version 2.1 of the fetcher.\n',
  readmeClaim: 'The README said version 3 before my edit.',
  final: 'Done: retries are added and the tests pass. The API returns JSON, so I parse it as JSON. I left the logging for later.',
  project: '# Project rules\n\nRun the whole suite before you finish.\n',
});

const T = CHECKLIST_TEXT;
const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const idOf = (c) => `sha256:${c.repeat(64).slice(0, 64)}`;

/** A blob of its own, referenced whole. */
function text(b, key, value) {
  b.blobs[key] = value;
  return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(value, 'utf8') }];
}
/** A tool call and its result, recorded as given (`recorded`: the recorder's typed facts on the call). */
function call(b, id, { tool, operation = 'other', command = null, recorded = null, result = 'unknown', output = '',
  terminalStatusProven = false, exitCode = null }) {
  b.events.push({ sequence: b.events.length, id, kind: 'invocation', callKey: id, tool, operation, paths: [],
    command: command === null ? [] : text(b, `${id}-cmd`, command), input: [], changes: [], ...(recorded ? { recorded } : {}) });
  b.events.push({ sequence: b.events.length, id: `${id}-r`, kind: 'observation', invocation: id, callKey: id, phase: 'terminal',
    result, exitCode, terminalStatusProven, output: output ? text(b, `${id}-out`, output) : [], sourceOfResult: 'native' });
}

export function checklistSession() {
  const b = sessionBuilder();
  b.ask('I1', T.ask1);
  b.say('C1', T.plan);
  b.change('W1', 'src/fetch.js', { after: T.fetchBody });
  b.run('R1', 'npm test', 'failed', 'Tests: 1 failed, 4 passed');
  call(b, 'S1', { tool: 'WebSearch' });
  call(b, 'S2', { tool: 'WebSearch' });
  call(b, 'S3', { tool: 'WebSearch' });
  call(b, 'S4', { tool: 'WebFetch' });
  call(b, 'X1', { tool: 'bash', operation: 'command', command: 'npm run e2e', recorded: { backgroundTaskId: 'job-1' } });
  call(b, 'X2', { tool: 'bash', operation: 'command', command: 'rm -rf build', recorded: { denial: 'user-rejected' } });
  b.change('W2', 'README.md', { operation: 'edit', before: T.readmeBefore, after: T.readmeAfter });
  b.say('C2', T.readmeClaim);
  b.run('R2', 'npm run lint', 'succeeded', 'lint ok');
  b.say('F1', T.final, 'final');
  b.ask('I2', T.ask2);
  const projectInstructions = [{ id: 'P1', kind: 'project-instructions', path: 'CLAUDE.md', afterSequence: -1,
    text: text(b, 'project', T.project) }];
  return new Session({ sessionKey: STORY_KEY, adapter: 'claude', events: b.events, blobs: b.blobs, children: b.children,
    projectInstructions });
}

const decided = (fields) => ({ actorSession: STORY_KEY, dimension: 'retries', chosen: 'three retries', value: null,
  valueReceipt: null, valueState: 'unchecked', actions: [], stated: null, constrainedBy: null, instructionReview: null,
  column: 'asked-chose', columnState: 'grounded', amends: [], materiality: 'material', materialityRule: 'synthetic',
  relevance: 'unchecked', reasons: [], ...fields });

/** The report a session-only review of `checklistSession` publishes: rows as code published them. */
export function checklistReport() {
  const ask = (quote, status, extra = {}) => ({ text: quote, instruction: receipt('instruction', 'I1', quote), status, ...extra });
  const requirements = [
    ask('Add a retry to the fetcher', 'done', { deliverable: receipt('code', 'W1', 'return retry(3, () => fetch(url));') }),
    ask('log each failure', 'not-done', { shortfall: receipt('commentary', 'F1', 'I left the logging for later') }),
    ask('Keep the timeout at 5 seconds', 'not-checked', { reason: 'deliverable_ungrounded' }),
    ask('The API returns XML', 'partly-done', { deliverable: receipt('commentary', 'F1', 'so I parse it as JSON'),
      shortfall: receipt('commentary', 'F1', 'The API returns JSON') }),
    { text: REQUIREMENT_UNREVIEWED_TEXT, instruction: { eventId: 'I2', role: 'instruction' }, status: 'not-checked',
      reason: 'ask_unreviewed', codeMade: true, facts: ['no_deliverable_by_end'] },
  ];
  const narrative = { requirements: requirements.filter((r) => r.codeMade !== true)
    .map((r) => ({ text: r.text, instruction: r.instruction, status: r.status })) };
  const eventIds = ['I1', 'C1', 'W1', 'W1-r', 'R1', 'R1-r', 'S1', 'S1-r', 'S2', 'S2-r', 'S3', 'S3-r', 'S4', 'S4-r', 'X1', 'X1-r',
    'X2', 'X2-r', 'W2', 'W2-r', 'C2', 'R2', 'R2-r', 'F1', 'I2'];
  const failure = (eventId, action, outcome, form, tool, handling, extra = {}) => ({ eventId, outcome, form, action, tool,
    handling, ...extra });
  return {
    reviewScope: 'session-only', codeCoverage: 'missing', coverage: 'complete', sessionReview: 'complete',
    sessionStatus: 'DECIDE', promptVersion: 'sonah.narrative/28',
    windowResults: [{ windowIndex: 0, eventIds, failure: null, narrative }],
    requirements,
    promises: [
      { id: idOf('a'), stated: receipt('commentary', 'F1', 'the tests pass'), text: 'The tests pass', status: 'incomplete',
        receipts: [receipt('commentary', 'F1', 'the tests pass')], restsOn: ['X1'] },
      { id: idOf('b'), stated: receipt('commentary', 'F1', 'so I parse it as JSON'), text: 'It parses JSON', status: 'open',
        receipts: [receipt('commentary', 'F1', 'so I parse it as JSON')], assumption: true },
      { id: idOf('c'), stated: receipt('commentary', 'C1', 'I will add three retries'), text: 'Three retries', status: 'verified',
        receipts: [receipt('commentary', 'C1', 'I will add three retries'), receipt('observation', 'R2-r', 'lint ok')] },
    ],
    findings: [
      { id: idOf('d'), origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE', contradictionSource: 'human_message',
        title: "Claim contradicted by the human's own message",
        receipts: [receipt('commentary', 'F1', 'The API returns JSON'), receipt('instruction', 'I1', 'The API returns XML')] },
      { id: idOf('e'), origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE', contradictionSource: 'file_content',
        title: "Claim contradicted by a file's recorded content",
        receipts: [receipt('commentary', 'C2', 'The README said version 3'), receipt('code', 'W2', 'Version 2.0 of the fetcher.')] },
    ],
    decisions: [
      decided({ id: idOf('1'), dimension: 'backoff', chosen: 'no backoff', column: 'unasked', notActing: true,
        stated: receipt('commentary', 'C1', 'I will not add a backoff, three plain retries are enough here') }),
      decided({ id: idOf('2'), dimension: 'retry count', chosen: 'three retries', actions: ['W1'],
        stated: receipt('commentary', 'C1', 'I will add three retries'),
        constrainedBy: { instruction: receipt('instruction', 'I1', 'Add a retry to the fetcher'), settles: false,
          settledValueQuote: null } }),
    ],
    failures: [
      failure('R1-r', 'R1', 'ran-failed', 'exit', 'bash', 'passed-over',
        { response: receipt('commentary', 'F1', 'Done: retries are added and the tests pass.') }),
      failure('X1-r', 'X1', 'no-terminal-status', 'background', 'bash', 'not-checked', { reason: 'response_ungrounded' }),
      failure('X2-r', 'X2', 'did-not-run', 'denial', 'bash', 'told-human',
        { response: receipt('commentary', 'F1', 'I left the logging for later') }),
    ],
    pivots: [], writtenClaims: [],
    counts: { decisions: 2, byColumn: { 'asked-settled': 0, 'asked-chose': 1, unasked: 1 }, uncheckedColumn: 0 },
  };
}
