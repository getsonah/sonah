// D128 (A05+B23+D6): one synthetic row for each form of Claude Code row that the reader of 0.3.0-beta.5 left
// unclassified, by the recorder version that wrote it, with the class the reader now gives it. Only the key sets and
// the JSON kind of each value mirror the recorder: a value that was a token (no white space, at most 64 characters) is
// a synthetic token here, one that held words holds synthetic words, and numbers, booleans and arrays stay what they
// were. No recording is read, and nothing here holds a secret or a person's text.
//
// `expect` is the class the reader gives the row: `harness` (read by its structure, harness context, counted),
// `observations` (read by its structure, its listed type's own class: a declared loss on its channel), `unclassified`
// (something unlisted on it can hold session content: fail closed) or `instructions` (a message channel the reader
// declares as a loss).

const SESSION = 'd128d128-0000-4000-8000-000000000128';
let seq = 0;
const uid = () => `d128-${String(++seq).padStart(6, '0')}`;
const envelope = (version, extra) => ({ cwd: '/repo with space', entrypoint: 'cli', gitBranch: 'main',
  isSidechain: false, parentUuid: null, sessionId: SESSION, timestamp: '2026-10-21T10:00:00.000Z',
  userType: 'external', uuid: uid(), version, ...extra });
const attachment = (version, payload, extra = {}) => envelope(version, { type: 'attachment', attachment: payload, ...extra });
const RENDERED = { rendered: [{ content: 'Synthetic words the recorder rendered.' }], renderedRole: 'system' };
const system = (version, extra) => envelope(version, { type: 'system', ...extra });

/** `{ name, versions, row, expect }`: `versions` are the recorder versions the census found the form in. */
export const RECORDER_ROWS = Object.freeze([
  // ---- row types no list names ----
  { name: 'history-suppression', versions: ['(no version; recordings of 2.1.295 and 2.1.299)'], expect: 'harness',
    row: { type: 'history-suppression', cause: 'synthetic_cause', ts: '2026-10-21T10:00:00.000Z', sessionId: SESSION } },
  { name: 'history-suppression with an account', versions: ['(no version; a recording of 2.1.295)'], expect: 'harness',
    row: { type: 'history-suppression', cause: 'synthetic_cause', ts: '2026-10-21T10:00:00.000Z',
      vetoedAgainstAccountUuid: 'aaaaaaaa-0000-4000-8000-000000000001', sessionId: SESSION } },
  { name: 'bridge-session with noHistoryBackfill', versions: ['(no version; recordings of 2.1.295 and 2.1.299)'],
    expect: 'harness', row: { type: 'bridge-session', bridgeSessionId: 'bridge_synthetic_0001', lastSequenceNum: 7,
      noHistoryBackfill: true, ownerAccountUuid: 'aaaaaaaa-0000-4000-8000-000000000002',
      ownerOrganizationUuid: 'aaaaaaaa-0000-4000-8000-000000000003', sessionId: SESSION } },
  { name: 'permission-mode', versions: ['(no version; recordings of 2.1.251 and 2.1.296)'], expect: 'harness',
    row: { type: 'permission-mode', permissionMode: 'acceptEdits', sessionId: SESSION } },
  // D150 (its review, F3): the request rows as the recorder writes them, with no envelope (`cwd`, `uuid`, `isSidechain`,
  // …): its own keys, `sessionId`, `timestamp` and `version`. The `api-request-shape` row this fixture held carried such an
  // envelope; its recorded form is in d150-recorder-rows-fixture.js.
  { name: 'api-request', versions: ['2.1.303'], expect: 'harness',
    row: { type: 'api-request', cacheControl: [{ path: ['system'], value: { ttl: '1h', type: 'ephemeral' } }],
      id: 'aaaaaaaa-0000-4000-8000-000000000004', keep: 1, params: { betas: ['beta-1'], max_tokens: 1000,
        model: 'synthetic-model' }, querySource: 'sdk', requestDigest: 'f'.repeat(64), sessionId: SESSION,
      shapeHash: 'e'.repeat(64), tail: ['d'.repeat(64)], timestamp: '2026-10-21T10:00:00.000Z', version: '2.1.303' } },
  { name: 'api-request-blob of a system message', versions: ['2.1.303'], expect: 'unclassified',
    row: { type: 'api-request-blob', hash: 'c'.repeat(64), message: { role: 'system', content: [{ type: 'text',
      text: 'Synthetic words.' }] }, sessionId: SESSION } },
  { name: 'api-request-blob of a user message', versions: ['2.1.303'], expect: 'instructions',
    row: { type: 'api-request-blob', hash: 'b'.repeat(64), message: { role: 'user', content: [{ type: 'text',
      text: 'Synthetic words.' }] }, sessionId: SESSION } },
  { name: 'last-prompt with no leaf', versions: ['(no version; a recording of 2.1.111 and 2.1.119)'],
    expect: 'unclassified', row: { type: 'last-prompt', lastPrompt: 'Synthetic words of a prompt.', sessionId: SESSION } },
  // D128 judgment call 6 (its review): a prompt of one word is a token, so its row reads as harness context (6 rows of
  // that recording, each a copy of a person's turn the recording also holds).
  { name: 'last-prompt with no leaf and a one-word prompt', versions: ['(no version; a recording of 2.1.111 and 2.1.119)'],
    expect: 'harness', row: { type: 'last-prompt', lastPrompt: 'synthetic', sessionId: SESSION } },
  // ---- system subtypes no list names ----
  { name: 'system.turn_duration', versions: ['2.1.251'], expect: 'harness',
    row: system('2.1.251', { subtype: 'turn_duration', durationMs: 1200, isMeta: false, messageCount: 4 }) },
  { name: 'system.informational', versions: ['2.1.280', '2.1.286', '2.1.289', '2.1.295', '2.1.299'],
    expect: 'unclassified', row: system('2.1.295', { subtype: 'informational', content: 'Synthetic words.',
      isMeta: false, level: 'info' }) },
  { name: 'system.local_command', versions: ['2.1.295'], expect: 'unclassified',
    row: system('2.1.295', { subtype: 'local_command', commandRun: { name: 'synthetic' },
      content: 'Synthetic words of an output.', isMeta: false, level: 'info' }) },
  { name: 'system.model_refusal_fallback', versions: ['2.1.219', '2.1.222'], expect: 'unclassified',
    row: system('2.1.222', { subtype: 'model_refusal_fallback', apiRefusalCategory: 'cyber',
      apiRefusalExplanation: 'Synthetic words.', content: 'Synthetic words.', direction: 'down',
      fallbackModel: 'synthetic-model', isMeta: true, level: 'warning', originalModel: 'synthetic-model',
      refusedUserMessageUuid: null, requestId: 'req_synthetic', retractedMessageUuids: [], scope: 'turn',
      trigger: 'refusal' }) },
  { name: 'system.model_refusal_no_fallback', versions: ['2.1.286', '2.1.289', '2.1.295'], expect: 'unclassified',
    row: system('2.1.295', { subtype: 'model_refusal_no_fallback', apiRefusalCategory: 'cyber',
      apiRefusalExplanation: 'Synthetic words.', content: '', isMeta: true, level: 'warning',
      originalModel: 'synthetic-model', refusedUserMessageUuid: null, requestId: 'req_synthetic' }) },
  // ---- attachment types no list names ----
  { name: 'attachment.budget_usd', versions: ['2.1.278', '2.1.296'], expect: 'harness',
    row: attachment('2.1.296', { type: 'budget_usd', total: 5, used: 1.25, remaining: 3.75 }, RENDERED) },
  { name: 'attachment.auto_mode with no field', versions: ['2.1.160'], expect: 'harness',
    row: attachment('2.1.160', { type: 'auto_mode' }) },
  { name: 'attachment.dynamic_skill', versions: ['2.1.219', '2.1.286'], expect: 'unclassified',
    row: attachment('2.1.286', { type: 'dynamic_skill', displayPath: 'skills/synthetic',
      skillDir: '/repo/Synthetic Folder/skills', skillNames: ['synthetic'] }, RENDERED) },
  { name: 'attachment.hook_cancelled', versions: ['2.1.295'], expect: 'unclassified',
    row: attachment('2.1.295', { type: 'hook_cancelled', command: 'synthetic hook command words', durationMs: 10,
      hookEvent: 'PostToolUse', hookName: 'PostToolUse:Edit', timedOut: true, timeoutMs: 60000,
      toolUseID: 'toolu_synthetic' }) },
  // ---- listed attachment types with a key no list names ----
  { name: 'attachment.session_context with changed and reason', versions: ['2.1.295', '2.1.299'], expect: 'harness',
    row: attachment('2.1.295', { type: 'session_context', context: { synthetic: 'Synthetic words.' }, changed: true,
      reason: 'synthetic_reason' }, { ...RENDERED, renderedRole: 'user' }) },
  { name: 'attachment.task_status with canContinueAgent', versions: ['2.1.295'], expect: 'observations',
    row: attachment('2.1.295', { type: 'task_status', canContinueAgent: true, deltaSummary: null,
      description: 'Synthetic words.', outputFilePath: '/tmp/synthetic.output', status: 'completed',
      taskId: 'synthetic01', taskType: 'local_agent' }, RENDERED) },
  { name: 'attachment.deferred_tools_delta with removedByBlock', versions: ['2.1.295', '2.1.299'], expect: 'harness',
    row: attachment('2.1.295', { type: 'deferred_tools_delta', addedLines: [], addedNames: [], failedMcpServers: [],
      needsAuthMcpServers: [], pendingMcpServers: [], readdedNames: [], removedByBlock: ['SyntheticTool'],
      removedNames: ['SyntheticTool'], wireHiddenNames: [] }, RENDERED) },
  { name: 'attachment.total_tokens_reminder with session_id', versions: ['2.1.251'], expect: 'harness',
    row: attachment('2.1.251', { type: 'total_tokens_reminder', text: 'Synthetic words.' },
      { session_id: SESSION }) },
  { name: 'attachment.session_context with session_id', versions: ['2.1.251', '2.1.296'], expect: 'harness',
    row: attachment('2.1.296', { type: 'session_context', context: { synthetic: 'Synthetic words.' } },
      { session_id: SESSION, ...RENDERED }) },
  { name: 'attachment.date with session_id', versions: ['2.1.251', '2.1.296'], expect: 'harness',
    row: attachment('2.1.251', { type: 'date', date: '2026-10-21' }, { session_id: SESSION }) },
  { name: 'attachment.deferred_tools_delta with session_id', versions: ['2.1.251'], expect: 'harness',
    row: attachment('2.1.251', { type: 'deferred_tools_delta', addedLines: [], addedNames: [], failedMcpServers: [],
      pendingMcpServers: [], readdedNames: [], removedNames: [], wireHiddenNames: [] }, { session_id: SESSION }) },
  { name: 'attachment.mcp_instructions_delta with session_id', versions: ['2.1.251'], expect: 'harness',
    row: attachment('2.1.251', { type: 'mcp_instructions_delta', addedBlocks: ['Synthetic words.'], addedNames: [],
      removedNames: [] }, { session_id: SESSION }) },
  { name: 'attachment.credential_org with session_id', versions: ['2.1.296'], expect: 'harness',
    row: attachment('2.1.296', { type: 'credential_org', organizationUuid: 'aaaaaaaa-0000-4000-8000-000000000005' },
      { session_id: SESSION }) },
  { name: 'attachment.remote_session_change with session_id', versions: ['2.1.296'], expect: 'harness',
    row: attachment('2.1.296', { type: 'remote_session_change', commit: 'Synthetic words.', managedCommit: false,
      managedPr: false, pr: 'Synthetic words.', sendUserFileHint: false, url: null },
    { session_id: SESSION, rendered: [{ content: 'Synthetic words.' }], renderedRole: 'user',
      renderedBesideToolResult: true }) },
  { name: 'attachment.prompt_snapshot with session_id', versions: ['2.1.296'], expect: 'harness',
    row: attachment('2.1.296', { type: 'prompt_snapshot', contextRendering: 'inline', echoWireToolInputs: false,
      reminderFold: true, systemPrompt: ['Synthetic words.'] }, { session_id: SESSION }) },
  // ---- what stays strict ----
  // D150: a queued command with no `commandMode` that the recorder flagged `isMeta: true` is listed as the harness's
  // (`listed`: harness context, not read by its structure, so the census does not name it).
  { name: 'attachment.queued_command with no commandMode', versions: ['2.1.286', '2.1.295'], expect: 'harness',
    listed: true,
    row: attachment('2.1.295', { type: 'queued_command', isMeta: true, origin: { kind: 'coordinator' },
      prompt: 'Synthetic words of a queued message.', reminderId: 'synthetic01', source_uuid: uid() }, RENDERED) },
]);
