// D150: one synthetic row for each form of Claude Code's request records (`api-request`, `api-request-shape`,
// `api-request-blob`) as the recorder of 2.1.303 and 2.1.308 writes them, by its field names, in a main recording and in
// a helper's (whose request rows carry its agentId and no `isSidechain`). Only the key sets and the JSON kind of each
// value mirror the recorder: a token is a synthetic token, words are synthetic words. No recording is read, and nothing
// here holds a secret or a person's text.
//
// `expect` is the class the reader gives the row in a recording of its own beside a conversation (d128-recorder-rows.test.js
// `readerClass`): `harness`, `unclassified` or `instructions`. A row with an agentId there is admitted by the end-of-read
// check, its agentId being that recording's single child identity.

export const SESSION = 'd150d150-0000-4000-8000-000000000150';
export const CHILD = 'a150d150d150d150d';
const HASH = (c) => c.repeat(64);

/** An `api-request` row: digests, request parameters and hash lists, no text (2.1.303, 2.1.308). */
export const apiRequest = (extra = {}) => ({ type: 'api-request', base: HASH('a'),
  cacheControl: [{ path: ['system', 0], value: { ttl: '1h', type: 'ephemeral' } }], id: 'aaaaaaaa-0000-4000-8000-000000000150',
  keep: 2, params: { betas: ['beta_1'], context_management: { edits: [] }, max_tokens: 32000, model: 'synthetic-model',
    output_config: { effort: 'high' }, thinking: { type: 'adaptive' } }, querySource: 'repl_main_thread',
  requestDigest: HASH('b'), sessionId: SESSION, shapeHash: HASH('c'), tail: [HASH('d'), HASH('e')],
  timestamp: '2026-10-24T10:00:00.000Z', version: '2.1.308', ...extra });
/** An `api-request-shape` row: the request's system prompt and tools under their hash (2.1.303, 2.1.308). */
export const apiRequestShape = (extra = {}, shape = {}) => ({ type: 'api-request-shape', sessionId: SESSION,
  shape: { system: [{ type: 'text', text: 'Synthetic words of a system prompt.' }], tools: [{ name: 'Bash',
    description: 'Synthetic words of a tool.', input_schema: { type: 'object' } }], ...shape }, shapeHash: HASH('c'),
  timestamp: '2026-10-24T10:00:00.000Z', version: '2.1.308', ...extra });
/** An `api-request-blob` row: one message of a request under its hash; no uuid, no timestamp, no version. */
export const apiRequestBlob = (message, extra = {}) => ({ type: 'api-request-blob', hash: HASH('f'), message,
  sessionId: SESSION, ...extra });

/** `{ name, versions, row, expect }`: `versions` are the recorder versions the census found the form in. */
export const RECORDER_ROWS = Object.freeze([
  { name: 'api-request of a main recording', versions: ['2.1.303', '2.1.308'], expect: 'harness', row: apiRequest() },
  { name: 'api-request of a helper (its agentId, no isSidechain)', versions: ['2.1.308'], expect: 'harness',
    row: apiRequest({ agentId: CHILD }) },
  { name: 'api-request-shape', versions: ['2.1.303', '2.1.308'], expect: 'harness', row: apiRequestShape() },
  { name: 'api-request-shape of a helper (its agentId, no isSidechain)', versions: ['2.1.308'], expect: 'harness',
    row: apiRequestShape({ agentId: CHILD }) },
  // No recorded form: a request's messages beside its shape are no listed form, read by structure (words: unread).
  { name: 'api-request-shape with messages', versions: ['(none: planted)'], expect: 'unclassified',
    row: apiRequestShape({}, { messages: [{ role: 'user', content: 'Synthetic words.' }] }) },
  { name: 'api-request-blob of a helper\'s user message', versions: ['2.1.308'], expect: 'instructions',
    row: apiRequestBlob({ role: 'user', content: [{ type: 'text', text: 'Synthetic words.' }] }, { agentId: CHILD }) },
]);
