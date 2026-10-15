// M33 R (redact before every cut). Synthetic Claude Code records whose text puts a secret-shaped token across one of
// the cuts Sonah makes of a text before it reaches review, shared by the slicer/redaction test and the adapter test.
//
// Every byte here is invented. It imports only node built-ins and the packages under test.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { redact } from '../../redact/index.js';

/** A 40-character GitHub-shaped token and a 93-character Anthropic-shaped key (both invented). */
export const GHP = `ghp_${'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz'.slice(0, 36)}`;
export const SK = `sk-ant-api03-${'Q7x9'.repeat(20)}`;
export const TOKENS = Object.freeze({ ghp: GHP, sk: SK });

/** Every 8-character run of `token` that `text` still holds. */
export const leaks = (text, token) => Array.from({ length: token.length - 7 }, (_, i) => token.slice(i, i + 8))
  .filter((fragment) => text.includes(fragment));

/** Offsets from two before the token to two past it, every `step`. */
export const offsets = (token, step = 1) => {
  const out = [];
  for (let at = -2; at <= token.length + 2; at += step) out.push(at);
  if (out.at(-1) !== token.length + 2) out.push(token.length + 2);
  return out;
};

const LINE = 'checked the parser module and left it as it was';
/** Exactly `n` characters of prose: whole lines, then a partial line of `y` with no line break. */
export const prose = (n) => {
  let out = '';
  while (out.length + LINE.length + 1 <= n) out += `${LINE}\n`;
  return out + 'y'.repeat(Math.max(0, n - out.length));
};
/** `total` characters of text holding `token` from character `at` (a space before it, so it is a word of its own). */
export const place = (token, at, total) => {
  const rest = ' is the key\n';
  return `${prose(at - 1)} ${token}${rest}${prose(Math.max(0, total - at - token.length - rest.length))}`;
};
/** A token starting `offset` characters before `cut`: the cut falls `offset` characters into it. */
export const across = (token, cut, offset, total) => place(token, cut - offset, total);
/**
 * M33 R repair 2. `total` characters of text holding `token` split by a line continuation — a `\` and a line break —
 * `split` characters into it (clamped to the token), that line break at character `at`: one logical line, two physical
 * ones. Redaction joins them and sees the token whole; a cut at that line break hands it half.
 */
export const continued = (token, split, at, total) => {
  const k = Math.min(Math.max(split, 0), token.length);
  const text = `${prose(at - k - 2)} ${token.slice(0, k)}\\\n${token.slice(k)} is the key\n`;
  return text + prose(Math.max(0, total - text.length));
};

/** A deterministic 64-character line of base64 letters that redaction drops as unclassified high-entropy content. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export const noiseLine = (i) => Array.from({ length: 64 }, (_, k) => B64[(i * 29 + k * 37 + ((k * k) % 11)) % 64]).join('');
/** `n` characters that are all such lines (the last one partial). */
export const noise = (n) => {
  let out = '';
  for (let i = 0; out.length < n; i++) out += `${noiseLine(i)}\n`;
  return out.slice(0, n);
};

// ---- Claude Code records -------------------------------------------------------------------------------------------

let n = 0;
const uid = () => `m33r-${String(++n).padStart(6, '0')}`;
// M34 labels review (F6): a typed recorder (2.1.219 and later), whose human prompts carry the host's typed origin; a
// 2.1.205 recording is labelled by the declared legacy fallback, every row of it a counted gap.
const base = { sessionId: 'sess-m33-r', cwd: '/repo', version: '2.1.284', gitBranch: 'main', isSidechain: false };
export const userTurn = (text) => ({ ...base, type: 'user', uuid: uid(), origin: { kind: 'human' },
  message: { role: 'user', content: text } });
export const said = (text) => ({ ...base, type: 'assistant', uuid: uid(),
  message: { role: 'assistant', content: [{ type: 'text', text }] } });
export const toolUse = (id, name, input) => ({ ...base, type: 'assistant', uuid: uid(),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
export const toolResult = (id, content, { isError = false, toolUseResult } = {}) => ({ ...base, type: 'user', uuid: uid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] },
  ...(toolUseResult ? { toolUseResult } : {}) });
const updated = (id) => toolResult(id, 'The file has been updated successfully.');

/** Slice `records` from a synthetic recording on disk: `{ raw, clean }`, the ledger before and after redaction. */
export async function sliced(records) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-r-'));
  const file = join(dir, 'session.jsonl');
  await writeFile(file, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
  try {
    const raw = await sliceLineage([file]);
    const snapshot = structuredClone(raw);
    return { raw: snapshot, clean: redact(raw).ledger };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

/**
 * The cuts, each as a builder of records whose text puts `token` `offset` characters across that cut. The budgets are
 * the ones the old slicer cut at before redaction (and Sonah's bounds now keep, after it).
 */
export const CUTS = Object.freeze({
  // An ask over 20,000 characters: its first 14,000 and last 6,000.
  askHead: (token, offset) => [userTurn(across(token, 14_000, offset, 30_000)), said('Done.')],
  askTail: (token, offset) => [userTurn(across(token, 30_000 - 6_000, offset, 30_000)), said('Done.')],
  // A file body over 20,000 characters, from each source.
  readBefore: (token, offset) => [userTurn('fix it'), toolUse('r1', 'Read', { file_path: '/repo/a.txt' }),
    toolResult('r1', across(token, 20_000, offset, 25_000)),
    toolUse('e1', 'Edit', { file_path: '/repo/a.txt', old_string: 'checked', new_string: 'looked' }), updated('e1')],
  originalBefore: (token, offset) => [userTurn('fix it'),
    toolUse('e1', 'Edit', { file_path: '/repo/a.txt', old_string: 'checked', new_string: 'looked' }),
    toolResult('e1', 'The file has been updated successfully.', { toolUseResult: { filePath: '/repo/a.txt',
      originalFile: across(token, 20_000, offset, 25_000), type: 'update' } })],
  writeAfter: (token, offset) => [userTurn('write it'),
    toolUse('w1', 'Write', { file_path: '/repo/b.txt', content: across(token, 20_000, offset, 25_000) }),
    toolResult('w1', 'File created successfully')],
  editAfter: (token, offset) => [userTurn('edit it'),
    toolUse('e1', 'Edit', { file_path: '/repo/b.txt', old_string: 'x', new_string: across(token, 20_000, offset, 25_000) }),
    updated('e1')],
  // A MultiEdit whose written side reaches the cap in its second segment (15,000 + 5,000).
  editSegment: (token, offset) => [userTurn('edit it'), toolUse('m1', 'MultiEdit', { file_path: '/repo/b.txt', edits: [
    { old_string: 'a', new_string: prose(15_000) },
    { old_string: 'b', new_string: across(token, 5_000, offset, 9_000) }] }), updated('m1')],
  // A write's arguments over 2,000 characters (the argsExcerpt), for a Write and for an Edit's old side.
  writeArgs: (token, offset) => [userTurn('write it'),
    toolUse('w1', 'Write', { file_path: '/repo/b.txt', content: across(token, 2_000, offset, 3_000) }),
    toolResult('w1', 'File created successfully')],
  editArgs: (token, offset) => [userTurn('edit it'),
    toolUse('e1', 'Edit', { file_path: '/repo/b.txt', old_string: across(token, 2_000, offset, 3_000), new_string: 'y' }),
    updated('e1')],
  // A first error line over 200 characters.
  errorLine: (token, offset) => {
    const head = 'Error: failed to fetch https://example.test/?q=';
    const line = `${head}${'x'.repeat(Math.max(0, 200 - offset - head.length - 1))} ${token} and gave up`;
    return [userTurn('run it'), toolUse('b1', 'Bash', { command: 'node run.js' }),
      toolResult('b1', `${line}\nat run.js:1`, { isError: true })];
  },
  // A hunk header over 100 characters: the enclosing definition's line, only in the header.
  hunkHeader: (token, offset) => {
    const head = 'function connect(host) { const url = "https://example.test/?q=';
    const line = `${head}${'x'.repeat(Math.max(0, 100 - offset - head.length - 1))} ${token}"; }`;
    const body = ['1', '2', '3', '4'];
    return [userTurn('edit it'), toolUse('e1', 'Edit', { file_path: '/repo/c.js',
      old_string: [line, ...body, 'old'].join('\n'), new_string: [line, ...body, 'new'].join('\n') }), updated('e1')];
  },
  // A MultiEdit whose joined diffs pass 1,400 characters.
  multiDiff: (token, offset) => {
    const first = Array.from({ length: 24 }, (_, i) => `row ${String(i).padStart(2, '0')} ${'w'.repeat(40)}`).join('\n');
    // `-q\n+<first>` is the first diff; the join adds `\n…\n`, the second diff `-a\n+`.
    const before = `-q\n+${first.split('\n').join('\n+')}`.length + 3 + 4;
    const line = `${'z'.repeat(Math.max(0, 1_400 - offset - before - 1))} ${token} end`;
    return [userTurn('edit it'), toolUse('m1', 'MultiEdit', { file_path: '/repo/d.txt', edits: [
      { old_string: 'q', new_string: first }, { old_string: 'a', new_string: line }] }), updated('m1')];
  },
  // The slicer's own memory bound (40,000 characters) under a body redaction shrinks below the review cap.
  retainedRead: (token, offset) => [userTurn('fix it'), toolUse('r1', 'Read', { file_path: '/repo/a.txt' }),
    toolResult('r1', `${noise(39_000)}\n${across(token, 999, offset, 3_000)}`),
    toolUse('e1', 'Edit', { file_path: '/repo/a.txt', old_string: 'checked', new_string: 'looked' }), updated('e1')],
  retainedWrite: (token, offset) => [userTurn('write it'),
    toolUse('w1', 'Write', { file_path: '/repo/b.txt', content: `${noise(39_000)}\n${across(token, 999, offset, 3_000)}` }),
    toolResult('w1', 'File created successfully')],
  // M33 R repair 2: a token split by a line continuation whose line break is where the slicer's window of a write's
  // arguments ends (the end of the line holding character 2,000), where a first error line ends, and at the slicer's
  // memory bound (behind 39,000 characters redaction drops, so the review cap does not hide it).
  writeArgsContinued: (token, offset) => [userTurn('write it'),
    toolUse('w1', 'Write', { file_path: '/repo/b.sh', content: continued(token, offset, 2_000, 3_000) }),
    toolResult('w1', 'File created successfully')],
  editArgsContinued: (token, offset) => [userTurn('edit it'),
    toolUse('e1', 'Edit', { file_path: '/repo/b.sh', old_string: continued(token, offset, 2_000, 3_000), new_string: 'y' }),
    updated('e1')],
  errorLineContinued: (token, offset) => {
    const k = Math.min(Math.max(offset, 0), token.length);
    const line = `Error: request failed for ${token.slice(0, k)}\\\n${token.slice(k)} and gave up`;
    return [userTurn('run it'), toolUse('b1', 'Bash', { command: 'node run.js' }),
      toolResult('b1', `${line}\nat run.js:1`, { isError: true })];
  },
  retainedReadContinued: (token, offset) => [userTurn('fix it'), toolUse('r1', 'Read', { file_path: '/repo/a.txt' }),
    toolResult('r1', `${noise(39_000)}\n${continued(token, offset, 999, 3_000)}`),
    toolUse('e1', 'Edit', { file_path: '/repo/a.txt', old_string: 'checked', new_string: 'looked' }), updated('e1')],
  retainedWriteContinued: (token, offset) => [userTurn('write it'),
    toolUse('w1', 'Write', { file_path: '/repo/b.txt', content: `${noise(39_000)}\n${continued(token, offset, 999, 3_000)}` }),
    toolResult('w1', 'File created successfully')],
  // M33 R repair 3: the same, as Claude Code records a Read — every line behind its number (`     N\t`). The slicer
  // used to apply its memory bound to the NUMBERED text, while redaction sees it de-numbered: the bound here falls on
  // the second physical line of the continued token, `numberedInto(offset)` characters into its numbered line (on its
  // padding, its digits, its tab, or its text). Behind the digits the bound's check could not see the `\`, and the
  // first half of the token survived in the pre-edit body. The read's own output lines (`tailLines`) hold it too.
  retainedReadNumberedContinued: (token, offset) => [userTurn('fix it'), toolUse('r1', 'Read', { file_path: '/repo/Dockerfile' }),
    toolResult('r1', numberedAtBound(token, offset)),
    toolUse('e1', 'Edit', { file_path: '/repo/Dockerfile', old_string: 'RUN step 1', new_string: 'RUN step 2' }), updated('e1')],
});

/** M33 R repair 3. Claude Code's numbered Read text of `lines`: each behind its number, right-aligned in six, and a tab. */
export const numbered = (lines) => lines.map((line, i) => `${String(i + 1).padStart(6)}\t${line}`).join('\n');
/** Where, in the numbered line after the continuation, `numberedAtBound` puts the 40,000th character. */
export const numberedInto = (offset) => [6, 7, 9, 0, 3][((offset % 5) + 5) % 5];
/**
 * A numbered Read result: about 38,000 characters of lines redaction drops, then `token` split by a continuation
 * `offset` characters into it (clamped), the 40,000th character of the NUMBERED text `numberedInto(offset)` characters
 * into the numbered line that holds the token's second half, then thirty ordinary lines.
 */
export const numberedAtBound = (token, offset) => {
  const k = Math.min(Math.max(offset, 0), token.length);
  const pre = [];
  let length = 0;
  for (let i = 0; length < 38_000; i++) { const line = noiseLine(i); pre.push(line); length += 7 + line.length + 1; }
  const first = `RUN fetch --header ${token.slice(0, k)}\\`;
  const filler = 40_000 - numberedInto(offset) - length - 8 - (7 + first.length + 1);
  return numbered([...pre, 'f'.repeat(filler), first, `${token.slice(k)} --retry 3`,
    ...Array.from({ length: 30 }, (_, i) => `RUN step ${i}`)]);
};
