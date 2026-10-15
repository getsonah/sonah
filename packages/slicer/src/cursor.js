// Cursor adapter — discovery and routing, not a new parser.
//
// Cursor's agent transcripts are Claude-Code-style JSONL (verified in Entire's MIT source,
// entireio/cli: cmd/entire/cli/agent/cursor/AGENT.md "Transcript" section, and their real capture
// cmd/entire/cli/agent/cursor/testdata/real_session_tool_use.jsonl). The job here is to point the
// EXISTING event builder at Cursor's session files, normalising only the quirks their code
// documents. Everything downstream — buildEvents, the labels, toolResultsOf — needs no
// knowledge that Cursor exists. The SQLite image sidecar (their agent/cursor/images.go) is skipped
// entirely: sonah judges text.
//
// Quirks, each cited to where Entire's code reveals it:
//   - Records carry `role`, not `type` (cmd/entire/cli/transcript/parse.go normalizeLineType:
//     "Claude Code uses 'type' while Cursor uses 'role'"). Without the mapping, records.js drops
//     every line as unrecognised scaffolding — silently.
//   - User text arrives wrapped: `<timestamp>…</timestamp>` prepended, `<user_query>…</user_query>`
//     around the real prompt (cmd/entire/cli/textutil/ide_tags.go). The timestamp strip MUST stay
//     anchored to the start of the message and MUST run before the user_query unwrap — the unwrap
//     can promote pasted user content to the string start, so the pipeline is applied exactly once
//     and in their order (ide_tags.go lines 14-26). A pasted <timestamp> mid-message survives.
//   - Tool names and input keys diverge from Claude Code (their agent/cursor/types.go +
//     AGENT.md tool table): Shell(command)→Bash, StrReplace(path,old_string,new_string)→Edit,
//     Write keys the body `contents` where Claude Code uses `content`, Glob uses
//     `glob_pattern`/`target_directory`. Files are keyed `path`, not `file_path` — events.js
//     already reads `input.path`, so that one needs no rewrite.
//   - tool_use blocks carry NO `id` field (AGENT.md: "Blocks carry no id field"). Deterministic
//     synthetic ids are minted so results — real or the degraded marker below — can attach.
//   - `{"type":"turn_ended",…}` is a Cursor-only scaffolding record (last line of their
//     testdata/real_session_tool_use.jsonl). Not a turn, not compaction: dropped.
//
// CAVEAT — Cursor's on-disk record famously omits tool OUTPUTS in some modes. Their shipped real
// capture contains six tool_use blocks and zero tool_result carriers; their own file-modification
// tracking reads tool INPUTS only and leans on git status as the backstop (agent/cursor/AGENT.md
// "Gaps & Limitations" #4, transcript.go ExtractModifiedFiles). When a transcript shows tool calls
// but no results anywhere, every shell call is explicitly marked outcome `unknown` rather than
// inferred from silence — a degraded verdict is worse than no verdict. Edits/reads get no synthetic
// result at all: an empty result would fabricate `bytes: 0` on reads, which is a claim, not an
// absence. If the transcript DOES carry results (the recording modes), they pass through unchanged
// and attach normally; an individually missing result then stays absent, exactly as it does for
// Claude Code.
//
// No opening list is extended (M34 labels: none is read anywhere): Cursor's scaffolding is in-band tags
// on real human turns (strip/unwrap transforms, handled here), not whole synthetic user records the
// way Codex injects AGENTS.md. Nothing in their cursor package fabricates a user turn.
//
// Session-directory conventions (their agent/cursor/cursor.go):
//   - dir:    ~/.cursor/projects/<sanitized-repo-path>/agent-transcripts  (GetSessionDir)
//   - sanitisation: strip leading "/", replace every non-alphanumeric with "-"
//     (sanitizePathForCursor) — "/Users/x/Acme Labs/repo" → "Users-x-Acme-Labs-repo", so a repo
//     path containing a space MUST survive every test below.
//   - layout: Cursor CLI writes flat <dir>/<id>.jsonl; the IDE nests <dir>/<id>/<id>.jsonl
//     (ResolveSessionFile). The file stem is the conversation_id, which is the session identity —
//     the transcript lines themselves carry no sessionId, no cwd, no version.

import { createReadStream } from 'node:fs';
import { duplicateJsonKeys } from './strict-json.js';
import { createInterface } from 'node:readline';
import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { isCompactionMarker, PRIVATE_LABEL } from './records.js';
import { LABELS, LABEL_BASIS, LABEL_GAPS, MARKERS, LINEAGE_ROLES, labelOf, applyLabel } from './labels.js';

/** Cursor names → the canonical names the event builder already understands. */
const TOOL_ALIAS = { Shell: 'Bash', StrReplace: 'Edit' };

/** Record kinds we keep, mirroring records.js. Everything else is scaffolding (turn_ended, …). */
const KEPT_TYPES = new Set(['user', 'assistant', 'system']);

// Ported from entireio/cli cmd/entire/cli/textutil/ide_tags.go (MIT — see THIRD_PARTY_NOTICES.md).
// Order is load-bearing: ide tags, then the ANCHORED timestamp, then the user_query unwrap.
const IDE_TAG = /<ide_[^>]*>[\s\S]*?<\/ide_[^>]*>/g;
const TIMESTAMP_PREFIX = /^\s*<timestamp(\s[^>]*)?>[^<\n]*<\/timestamp\s*>/;
const USER_QUERY_TAG = /<\/?user_query>/g;

/**
 * Strip Cursor's in-band wrappers from one user text. Apply exactly once per text — the unwrap can
 * expose user content at the start of the message, so a second pass could eat pasted content
 * (their ide_tags.go comment: "Not idempotent").
 */
export function stripCursorTags(text, { anchored = true } = {}) {
  let t = String(text).replace(IDE_TAG, '');
  if (anchored) t = t.replace(TIMESTAMP_PREFIX, '');
  return t.replace(USER_QUERY_TAG, '').trim();
}

/**
 * Route by session-dir convention, exactly as codex.js routes by rollout naming. Only Cursor puts
 * transcripts under .cursor/projects (their GetSessionDir), and the segment survives any prefix —
 * including a home directory containing a space.
 */
export function isCursorSession(file) {
  return /\/\.cursor\/projects\//.test(file);
}

/** ~/.cursor/projects/<sanitized>/agent-transcripts for one repo. Null when home is unknowable. */
export function cursorSessionDir(repoPath, { home = process.env.HOME } = {}) {
  if (!home) return null;
  return join(home, '.cursor', 'projects', sanitizePathForCursor(repoPath), 'agent-transcripts');
}

/**
 * Cursor's project-directory sanitisation, transcribed from entireio/cli
 * cmd/entire/cli/agent/cursor/cursor.go sanitizePathForCursor (MIT — see THIRD_PARTY_NOTICES.md):
 * strip leading "/", replace every non-alphanumeric byte with "-". The space in "Acme Labs" becomes
 * a dash like any other punctuation.
 */
export function sanitizePathForCursor(path) {
  return String(path).replace(/^\/+/, '').replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Discover a repo's Cursor sessions and group them into lineages.
 *
 * Both on-disk layouts (their ResolveSessionFile): flat CLI files <dir>/<id>.jsonl and nested IDE
 * files <dir>/<id>/<id>.jsonl. Nothing in their cursor package records a continuation or fork
 * pointer, so each conversation file is its own lineage — one file, oldest-first ordering by mtime
 * across lineages.
 *
 * @returns {Promise<string[][]>} lineages, each a single-file chain
 */
export async function resolveCursorLineages(repoPath, { home = process.env.HOME, minBytes = 0 } = {}) {
  const dir = cursorSessionDir(repoPath, { home });
  if (!dir) return [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found = [];
  for (const e of entries) {
    let f = null;
    if (e.isFile() && e.name.endsWith('.jsonl')) f = join(dir, e.name); // CLI flat
    else if (e.isDirectory()) f = join(dir, e.name, `${e.name}.jsonl`); // IDE nested
    if (!f) continue;
    try {
      const s = await stat(f);
      if (!s.isFile() || s.size < minBytes) continue;
      found.push({ f, mtime: s.mtimeMs });
    } catch {
      // IDE creates the directory before flushing the transcript (their ResolveSessionFile
      // comment); an empty conversation dir is expected, not an error.
    }
  }

  return found.sort((a, b) => a.mtime - b.mtime || (a.f < b.f ? -1 : 1)).map((x) => [x.f]);
}

/** Mirror of codexLineageKey: Cursor has no fork pointer, so the conversation id is the key. */
export function cursorLineageKey(meta) {
  return meta?.sessionId ?? meta?.file ?? null;
}

/**
 * Read one Cursor transcript into the same normalised shape readSession produces for Claude Code.
 * @returns {Promise<{records: object[], meta: object, corrupt: number}>}
 */
export async function readCursorSession(file) {
  const records = [];
  const meta = {
    // The conversation_id names the file in both layouts (their AGENT.md "Transcript"); the lines
    // themselves carry no sessionId/cwd/version, so identity comes from the path and cwd must be
    // supplied by the caller (sliceLineage's opts.cwd), as discovery always knows the repo.
    sessionId: basename(file, '.jsonl') || null,
    cwd: null,
    version: null,
    gitBranch: null,
    file,
    agent: 'cursor',
    toolOutputsMissing: false,
  };
  let corrupt = 0;
  let lineNo = 0;

  let sawToolUse = false;
  let sawToolResult = false;
  /** Every Bash-aliased call id, so the degraded-mode marker can attach to each. */
  const shellCallIds = [];

  const rl = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    lineNo++;
    if (!line.trim()) continue;

    let d;
    try {
      d = JSON.parse(line);
    } catch {
      corrupt++;
      continue;
    }
    if (d === null || typeof d !== 'object' || Array.isArray(d)) { corrupt++; continue; }
    // C-02: a row that repeats a key is not a serializer product; it costs one line, declared.
    if (duplicateJsonKeys(line)) { corrupt++; continue; }

    // Cursor writes `role` where Claude Code writes `type` (their transcript/parse.go
    // normalizeLineType). Normalise on the record so every downstream helper switches uniformly.
    if (typeof d.type !== 'string' && typeof d.role === 'string') d = { ...d, type: d.role };

    // Future-proofing only: today's Cursor lines carry none of these.
    if (meta.cwd === null && typeof d.cwd === 'string') meta.cwd = d.cwd;
    if (meta.gitBranch === null && typeof d.gitBranch === 'string') meta.gitBranch = d.gitBranch;

    if (!KEPT_TYPES.has(d.type)) {
      // turn_ended and friends are scaffolding — but compaction markers hide in vendor types.
      if (isCompactionMarker(d)) records.push({ kind: 'compaction', line: lineNo, raw: d });
      continue;
    }

    if (d.type === 'user') {
      const { record, hasResult } = normalizeUser(d);
      if (hasResult) sawToolResult = true;
      records.push({ kind: 'user', line: lineNo, raw: record });
      continue;
    }

    if (d.type === 'assistant') {
      const { record, callIds, hadToolUse } = normalizeAssistant(d, lineNo);
      if (hadToolUse) sawToolUse = true;
      shellCallIds.push(...callIds);
      records.push({ kind: 'assistant', line: lineNo, raw: record });
      continue;
    }

    records.push({ kind: d.type, line: lineNo, raw: d });
  }

  // Degraded mode: tool calls with no outputs anywhere in the file (see header CAVEAT). Mark every
  // shell call's outcome unknown explicitly. The event builder recognises these synthetic
  // markers and does not turn them into recorded observations.
  if (sawToolUse && !sawToolResult) {
    meta.toolOutputsMissing = true;
    if (shellCallIds.length) {
      records.push({
        kind: 'user',
        line: lineNo + 1,
        raw: {
          type: 'user',
          // A compatibility marker for the slicer. This row did not come from Cursor's
          // recording and must not certify that a tool observation was captured.
          syntheticMissingToolResults: true,
          message: {
            role: 'user',
            content: shellCallIds.map((id) => ({ type: 'tool_result', tool_use_id: id, content: '' })),
          },
        },
      });
    }
  }

  labelCursorRecords(records);
  return { records, meta, corrupt };
}

/**
 * M34 labels (C-02 "Slice-time labels"). Cursor's labelling function. Cursor types no human channel beyond its `user`
 * role, so a user row's text is the human's (`cursor_user_role`) — or, where the reader's strip of Cursor's own
 * scaffolding left a text block blank, the harness's (`cursor_scaffolding`); its tool results are observations; assistant text is
 * thought, a call an action, reasoning private; a compaction is harness; the reader's own degraded-mode row is harness.
 */
export function labelCursorRecords(records) {
  const L = LABELS, B = LABEL_BASIS;
  for (const rec of records) {
    const d = rec.raw;
    const blocks = typeof d?.message?.content === 'string' ? [{ type: 'text', text: d.message.content }]
      : Array.isArray(d?.message?.content) ? d.message.content : null;
    let value;
    if (rec.kind === 'compaction') value = labelOf(L.harness, B.compactBoundary, { markers: [MARKERS.compaction] });
    else if (rec.kind === 'system') value = labelOf(L.harness, B.systemRow);
    else if (d?.syntheticMissingToolResults === true) value = labelOf(L.harness, B.readerCompatibility);
    else if (!blocks) value = labelOf(null, B.cursorUserRole, { gap: LABEL_GAPS.unknownRow });
    else {
      const parts = blocks.map((block) => {
        if (block?.type === 'tool_result') return labelOf(L.observation, B.toolResult);
        if (block?.type === 'tool_use') return labelOf(L.action, B.toolUse);
        if (['thinking', 'redacted_thinking', 'reasoning'].includes(block?.type)) return PRIVATE_LABEL;
        if (rec.kind === 'assistant') return block?.type === 'text' ? labelOf(L.thought, B.assistantText)
          : labelOf(null, B.assistantText, { gap: LABEL_GAPS.unknownBlock });
        // A text block the reader's own strip left blank held only Cursor's scaffolding: harness.
        if (block?.type === 'text' && typeof block.text === 'string' && !block.text.trim())
          return labelOf(L.harness, B.cursorScaffolding);
        return labelOf(L.human, B.cursorUserRole);
      });
      value = parts.length === 1 ? parts[0] : { parts };
    }
    applyLabel(rec, value, LINEAGE_ROLES.root);
  }
  return records;
}

/**
 * User record: strip Cursor's wrappers from text blocks (anchored strip on the first block only —
 * the message start), pass tool_result blocks through untouched so the recording modes attach
 * results exactly like Claude Code.
 */
function normalizeUser(d) {
  const m = d.message ?? {};
  const c = m.content;
  let hasResult = false;

  if (typeof c === 'string') {
    return { record: { ...d, message: { ...m, content: stripCursorTags(c) } }, hasResult };
  }
  if (!Array.isArray(c)) return { record: d, hasResult };

  let firstText = true;
  const content = c.map((b) => {
    if (b && b.type === 'tool_result') { hasResult = true; return b; }
    if (b && b.type === 'text' && typeof b.text === 'string') {
      const text = stripCursorTags(b.text, { anchored: firstText });
      firstText = false;
      return { ...b, text };
    }
    return b;
  });
  return { record: { ...d, message: { ...m, content } }, hasResult };
}

/**
 * Assistant record: alias tool names, translate the input keys their types.go documents, and mint
 * deterministic ids for blocks that have none so results can attach.
 */
function normalizeAssistant(d, lineNo) {
  const m = d.message ?? {};
  const c = m.content;
  const callIds = [];
  let hadToolUse = false;
  if (!Array.isArray(c)) return { record: d, callIds, hadToolUse };

  const content = c.map((b, i) => {
    if (!b || b.type !== 'tool_use' || typeof b.name !== 'string') return b;
    hadToolUse = true;
    const name = TOOL_ALIAS[b.name] ?? b.name;
    const input = normalizeToolInput(b.name, b.input);
    // No `id` on Cursor blocks (their AGENT.md) — mint one from position: deterministic, no clock.
    const id = typeof b.id === 'string' && b.id ? b.id : `cursor-call:${lineNo}:${i}`;
    if (name === 'Bash') callIds.push(id);
    return { ...b, id, name, input };
  });
  return { record: { ...d, message: { ...m, content } }, callIds, hadToolUse };
}

/**
 * Input-key translation, from their agent/cursor/types.go and the AGENT.md tool table. `path` is
 * left alone — events.js already accepts it alongside file_path.
 */
function normalizeToolInput(cursorName, input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input ?? {};
  const out = { ...input };
  // Write keys the body `contents`; the event builder's allow-list wants `content`.
  if (cursorName === 'Write' && typeof out.contents === 'string' && out.content === undefined) {
    out.content = out.contents;
  }
  // Glob: glob_pattern/target_directory → pattern/path, or the read event has no path and drops.
  if (cursorName === 'Glob') {
    if (out.pattern === undefined && typeof out.glob_pattern === 'string') out.pattern = out.glob_pattern;
    if (out.path === undefined && typeof out.target_directory === 'string') out.path = out.target_directory;
  }
  return out;
}
