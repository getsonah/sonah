// M33 R repair 2. Synthetic Codex rollouts whose patches hold a secret block across what the slicer used to cut away
// from a patch before redaction (its context lines, and changed lines whose own text starts with `--` or `++`), shared
// by the slicer test and the adapter test.
//
// Every byte here is invented. It imports only node built-ins and the packages under test.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { redact } from '../../redact/index.js';

// ---- synthetic Codex rollouts ----------------------------------------------------------------------------------------

const OWN = 'thread-m33-r-patch';
const item = (payload) => JSON.stringify({ type: 'response_item', payload });
const event = (payload) => JSON.stringify({ type: 'event_msg', payload });
const meta = JSON.stringify({ type: 'session_meta', payload: { id: OWN, cwd: '/repo' } });

/** A direct `apply_patch` call and its output. */
export const direct = (patch) => [item({ type: 'custom_tool_call', name: 'functions.apply_patch', call_id: 'p1', input: patch }),
  item({ type: 'custom_tool_call_output', call_id: 'p1', output: 'Success. Updated the following files.' })];
/** A code cell's `apply_patch` (an innocuous patch of the same path) whose native FileChange carries `unifiedDiff`. */
export const native = (path, unifiedDiff) => {
  const patch = `*** Begin Patch\n*** Update File: ${path}\n@@\n-old\n+new\n*** End Patch`;
  return [event({ type: 'task_started', turn_id: 't1', model_context_window: 1 }),
    item({ type: 'custom_tool_call', name: 'exec', call_id: 'w1', input: `text(await tools.apply_patch(${JSON.stringify(patch)}));` }),
    event({ type: 'item_completed', thread_id: OWN, turn_id: 't1', item: { id: 'f1', type: 'FileChange', status: 'completed',
      changes: { [`/repo/${path}`]: { type: 'update', unified_diff: unifiedDiff, move_path: null } }, stdout: '', stderr: '' } }),
    item({ type: 'custom_tool_call_output', call_id: 'w1',
      output: [{ type: 'input_text', text: 'Script completed' }, { type: 'input_text', text: 'Success.' }] })];
};

/** Slice the rollout `rows` (after its meta and ask): `{ raw, clean }`, the ledger before and after redaction. */
export async function codexSliced(rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-r-patch-'));
  const file = join(dir, 'rollout-2026-09-30T12-00-00-m33r.jsonl');
  await writeFile(file, `${[meta, item({ type: 'message', role: 'user', content: 'Rotate the deploy key.' }), ...rows].join('\n')}\n`);
  try {
    const raw = await sliceLineage([file]);
    const snapshot = structuredClone(raw);
    return { raw: snapshot, clean: redact(raw).ledger };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/** An `apply_patch` of `path` whose one Update section is `hunk` (its lines). */
export const patchOf = (path, hunk) => ['*** Begin Patch', `*** Update File: ${path}`, ...hunk, '*** End Patch'].join('\n');
/** The same hunk as a FileChange's unified diff: `@@` as a numbered hunk header, a trailing newline. */
export const unifiedOf = (hunk) => `${hunk.map((line) => (line.startsWith('@@') ? `@@ -1,8 +1,8 @@${line.slice(2)}` : line)).join('\n')}\n`;

/** Both shapes of one change: `[shape, rows]`. */
export const shapes = (path, hunk) => [['apply_patch', direct(patchOf(path, hunk))], ['FileChange', native(path, unifiedOf(hunk))]];
export const edits = (ledger) => ledger.ledger.filter((e) => e.kind === 'edit' || e.kind === 'create');

/** Every 8-character run of any of `secrets` that `text` still holds. */
export const leaks = (text, secrets) => {
  const found = new Set();
  for (const secret of secrets) for (let i = 0; i + 8 <= secret.length; i++) {
    const fragment = secret.slice(i, i + 8);
    if (text.includes(fragment)) found.add(fragment);
  }
  return [...found];
};

// Low-entropy secret lines: only the key above them says they are secret.
export const WORDS = ['correct-horse-battery-staple-lantern', 'quiet-meadow-orchard-violet-ember', 'paper-tiger-river-stone-hollow'];
export const ROTATED = WORDS.map((w) => `${w}-rotated`);
// A PEM block, its header lines assembled at run time.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export const b64Line = (i, n = 64) => Array.from({ length: n }, (_, k) => B64[(i * 31 + k * 7 + ((k * k) % 13)) % 64]).join('');
export const BEGIN = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
export const END = ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
export const PEM_BODY = [b64Line(1), b64Line(2), `${b64Line(3, 30)}==`];
export const PEM_SHORT = [`${b64Line(5, 18)}==`];
export const unpadded = (lines) => lines.map((line) => line.replace(/=+$/, ''));
export const ENV_VALUE = 'zebraquartzl';
export const ENV_ROTATED = 'mossriverstone';

// The reviewer's reproductions, as hunks of an Update.
export const CASES = {
  'a YAML secret block whose key is a context line': {
    path: 'deploy.yaml', secrets: [...WORDS, ...ROTATED],
    hunk: ['@@', ' signing_key: |', ...WORDS.map((w) => `-  ${w}`), ...ROTATED.map((w) => `+  ${w}`), ' region: eu-west-1'],
  },
  'a YAML secret block whose key is the hunk\'s anchor': {
    path: 'deploy.yaml', secrets: [...WORDS, ...ROTATED],
    hunk: ['@@ signing_key: |', ...WORDS.map((w) => `-  ${w}`), ...ROTATED.map((w) => `+  ${w}`)],
  },
  'a PEM block removed whole': {
    path: 'keys.txt', secrets: unpadded(PEM_BODY),
    hunk: ['@@', ' first: 1', `-${BEGIN}`, ...PEM_BODY.map((l) => `-${l}`), `-${END}`, ' second: 2'],
  },
  'a PEM block whose BEGIN and END lines are context': {
    path: 'keys.txt', secrets: unpadded([...PEM_BODY, ...PEM_SHORT]),
    hunk: ['@@', ` ${BEGIN}`, ...PEM_BODY.map((l) => `-${l}`), ...PEM_SHORT.map((l) => `+${l}`), ` ${END}`],
  },
  'a continued .env value under a context line': {
    path: 'run.sh', secrets: [ENV_VALUE, ENV_ROTATED],
    hunk: ['@@', ' export DB_PASSWORD=\\', `-  ${ENV_VALUE}`, `+  ${ENV_ROTATED}`, ' echo done'],
  },
};
