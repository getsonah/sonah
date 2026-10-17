// The pre-edit channel (experiment 3): for every path the session edited, the file's FIRST
// version in the session — the agent's own earliest Read of it before the first edit, or, for a
// file created in-session, the first Write's body. The session record is the only source: no
// git, no filesystem. Content is retained only for paths that are later edited; every other
// Read result is discarded here, before the ledger leaves the slicer.

import { posix } from 'node:path';
import { READ_LINE_NUMBER, isNumberedRead, readText, RECORDED_FACTS } from '../../redact/index.js';

// D68 (E) (owner decision 2026-10-07; C-02 "M36 what the agent produced is kept whole"): the slicer keeps every body
// WHOLE — a written body, each side of an Edit, an Edit's `originalFile`, a Read's text — and nothing cuts it (D90: nor
// masks it). The 40,000-character transient memory bound (`RETAIN_CAP`, `retainHead`, `retainEdit`) and the
// review's 20,000 cap it served (`BEFORE_CAP`, redaction's `BODY_CAP`) are deleted: the window budget is the only bound.

/** Claude Code Read results carry "     12\t" prefixes; other adapters emit plain cat output.
 *  Strip the prefixes only when the text is clearly numbered (≥ 80% of non-empty lines). */
/** Claude Code sometimes records a Read result as its toolUseResult object, flattened to JSON:
 *  {"type":"text","file":{"filePath","content","numLines","startLine"}}. Unwrap to the content. */
export function unwrapReadResult(text) {
  const t = text.trimStart();
  if (!t.startsWith('{')) return text;
  try {
    const o = JSON.parse(t);
    if (typeof o?.file?.content === 'string') return o.file.content;
    if (typeof o?.content === 'string') return o.content;
  } catch { /* not JSON — plain output */ }
  return text;
}

/*  M33 R repair 3: the rule — what a line's number is, and when a text is numbered — lives in redact/index.js
 *  (`READ_LINE_NUMBER`, `isNumberedRead`), where redaction once read a numbered output de-numbered by exactly this rule
 *  (D90: it masks nothing now; the rule is the slicer's alone). */
export function stripLineNumbers(text) {
  const t = readText(text);
  if (!isNumberedRead(t)) return t;
  return t.split('\n').map((l) => l.replace(READ_LINE_NUMBER, '')).join('\n');
}

/** The recorder's separator between an Edit's segments — `ARG_SEP`, which events.js joins them
 *  with. Re-declared here because events.js imports this module; test/edit-bodies.test.js asserts
 *  the two are the same string. */
export const EDIT_SEPARATOR = '\n⟪→⟫\n';

/** An Edit's own text, whole (D68 E): every WRITTEN segment, then every REPLACED one, joined by `EDIT_SEPARATOR` —
 *  the shape the adapter splits back into one change per edit entry. An empty segment is the empty string the agent
 *  wrote (F83). */
export const editText = (written, replaced) => [...written, ...replaced].join(EDIT_SEPARATOR);

/** Credential-shaped paths (D68 R). D90 (owner decision 2026-10-15): the slicer withholds nothing for them, and the
 *  Codex change join no longer reads them (codex.js `safeChangePath`); the rule is kept for the code step's reader
 *  (cli/src/code-snapshot.js `withheldFileReason`) until it leaves it too. */
export const CREDENTIAL_PATH = /(^|\/)(\.env(\..*)?|secrets?\.(ya?ml|json|toml)|credentials(\.json)?|kubeconfig|\.npmrc|\.pypirc|\.netrc|\.htpasswd|id_(rsa|ed25519|ecdsa)(\.pub)?)$|\.(pem|key|p12|pfx|jks|kdbx)$/i;
/**
 * `CREDENTIAL_PATH` on a recorded path, in time linear in its length (M36 review). The pattern's `.*` stops at a line
 * break and its `$` is the text's end, so on a text holding a break every start before the last break scans to the next
 * break and fails: quadratic on a recorded value made of many `/.env.` runs and a break. A match cannot hold a break (no
 * part of the pattern matches one) and must end at the text's end, so only the text after the last break can hold it;
 * prefixed with a character that starts no alternative, `^` matches nothing there either. Same verdict, linear.
 */
export function credentialPath(path) {
  if (typeof path !== 'string') return false;
  let end = path.length;
  while (end > 0) {
    const c = path.charCodeAt(end - 1);
    if (c === 10 || c === 13 || c === 0x2028 || c === 0x2029) break;
    end--;
  }
  return CREDENTIAL_PATH.test(end === 0 ? path : `x${path.slice(end)}`);
}
/**
 * D69 (b) (owner decision 2026-10-08; C-02 "D69 the harness home folders"). The harnesses' home folders of the
 * recording's user — `~/.claude` and `~/.codex` (settings, credentials, memory, other sessions' transcripts: secrets of
 * unknown shape) — outside a harness worktree (`.claude/worktrees/…`, `.codex/worktrees/…`, which IS the project under
 * review, D40). A project's own `.claude` or `.codex` directory is not a home folder and is shown. (D68 (R) as built
 * withheld every `.claude` directory, a project's own included, and no `.codex` one: both replaced by this one rule.)
 *
 * The user's home is read from structure only, never from a file's or a message's words: from the path form its
 * recorder wrote the recording at (`recordingHome`), and from a path the recorder recorded home-relative (`~/…`,
 * `$HOME/…`, the shell's own grammar). Where the home cannot be read (a copied recording, a fixture, a checkpoint), every
 * `.claude` and `.codex` directory outside a worktree is held, wherever it stands: fails closed.
 *
 * D69 review (finding F5): a `.claude` or `.codex` directory OUTSIDE the recorder's working directory is held whether or
 * not the home is known — it is never the project's own (that lies under the cwd), so it is another home's or another
 * project's harness folder: a devcontainer whose recordings lie under the host's home while its paths name `/root`, a
 * symlinked `~/.claude`, a copy under another user's folder. The home then decides only inside the cwd (a cwd that
 * contains the home). The write scope reads the known home only (`homeFolderPath`): where the home is unknown a
 * project's own `.claude` is never put outside the work by the fail-closed withholding rule.
 */
const HOME_FOLDERS = Object.freeze(['.claude', '.codex']);
/**
 * The release review of the code step (2026-10-14): the harness files a harness keeps in the user's home folder itself,
 * beside its home folder, by the harness's own documented names — a formal list, never a pattern fitted to what was
 * seen. Claude Code: its state file `~/.claude.json` (the account, every project's prompt history, MCP server settings)
 * and the backups it writes beside it, `~/.claude.json.backup` and `~/.claude.json.backup.<time>` (`HOME_FILE_BACKUP`
 * after the name). Codex keeps all its state in its home folder (`CODEX_HOME`, by default `~/.codex`), so it adds none.
 * Each is a harness home path wherever the home folders are one: every rule below that reads the home folders reads
 * these too (`inHomeFolder`, the fail-closed `anyHomeName`), and so does the code step's reader
 * (cli/src/code-snapshot.js), through `harnessHomePath`.
 */
const HOME_FILES = Object.freeze(['.claude.json']);
/** What follows a harness home file's name in the name of a backup of it. */
const HOME_FILE_BACKUP = '.backup';
/** Whether `name`, one path name, is a harness home file (`HOME_FILES`) or a backup of one. */
export const isHomeFile = (name) => typeof name === 'string'
  && HOME_FILES.some((file) => name === file || name.startsWith(`${file}${HOME_FILE_BACKUP}`));
/** The folder of a harness home that holds the harness's worktrees (`.claude/worktrees/…`, `.codex/worktrees/…`): a
 *  worktree there IS the project under review (D40), never the home. The one spelling every harness-home rule reads:
 *  this file's, and the code pass's reader for a home this computer names (cli/src/code-snapshot.js). */
export const HARNESS_WORKTREES = 'worktrees';
/** Whether `rest`, a path relative to a harness home folder (slashes forward; empty for the folder itself), lies in that
 *  home outside its worktrees: its first name is not `HARNESS_WORKTREES`. */
export const inHarnessHome = (rest) => rest.split('/')[0] !== HARNESS_WORKTREES;
/** A path the recorder recorded relative to the user's home: the shell's `~`, `$HOME` or `${HOME}`, Windows' `%USERPROFILE%`. */
const HOME_RELATIVE = /^(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)(?:\/|$)/i;
/** Fails closed, the home unknown: any `.claude` or `.codex` path segment not followed by `HARNESS_WORKTREES`. */
const ANY_HOME_FOLDER = new RegExp(`(?:^|\\/)\\.(?:claude|codex)(?:\\/(?!${HARNESS_WORKTREES}(?:\\/|$))|$)`);
/** Fails closed, the home unknown: a path with a harness home folder segment (`ANY_HOME_FOLDER`), or a segment that is a
 *  harness home file (`isHomeFile`). Slashes forward. */
const anyHomeName = (p) => ANY_HOME_FOLDER.test(p) || p.split('/').some(isHomeFile);
/**
 * The path forms a recorder writes a session at (README.md, docs/INSTALL.md): Claude Code
 * `<home>/.claude/projects/<project>/<session>.jsonl` (a helper's under `<project>/<session>/subagents/`), Codex
 * `<home>/.codex/sessions/<y>/<m>/<d>/rollout-….jsonl` (`archived_sessions/` once archived). The greedy prefix takes the
 * last such folder of the path.
 */
const RECORDING_AT = /^(.+)\/\.(?:claude\/projects|codex\/(?:archived_)?sessions)\/[^/]/;
const slashed = (path) => path.replaceAll('\\', '/');
const isAbsolute = (path) => path.startsWith('/') || /^[A-Za-z]:\//.test(path);

/** The home folder of the user whose recorder wrote `files` (one lineage), from where it wrote them (`RECORDING_AT`), or
 *  null: a file at no such path, or files that name two homes. Structure only: the paths, never a file's bytes. */
export function recordingHome(files) {
  if (!Array.isArray(files) || !files.length) return null;
  let home = null;
  for (const file of files) {
    if (typeof file !== 'string') return null;
    const m = RECORDING_AT.exec(slashed(file));
    if (!m || !isAbsolute(m[1])) return null;
    const at = posix.normalize(m[1]);
    if (home !== null && at !== home) return null;
    home = at;
  }
  return home;
}

/** Whether `rest`, a path relative to the user's home, lies in one of its harness folders outside a worktree, or is a
 *  harness file kept in the home folder itself (`isHomeFile`). */
const inHomeFolder = (rest) => {
  const at = rest.indexOf('/');
  if (at < 0 && isHomeFile(rest)) return true;
  return HOME_FOLDERS.includes(at < 0 ? rest : rest.slice(0, at)) && inHarnessHome(at < 0 ? '' : rest.slice(at + 1));
};
/** `absolute` is `dir` or lies under it (by whole path segments: `/srv/proj-old` is not under `/srv/proj`). */
export const within = (absolute, dir) => absolute === dir || absolute.startsWith(dir.endsWith('/') ? dir : `${dir}/`);

/**
 * How the slicer spells a recorded path (events.js `relative`, recorded.js `relativeTo`; C-02 "D69"): relative to the
 * recorder's working directory when it lies under it — by whole path segments, the cwd itself spelled empty — and as
 * recorded otherwise. D69 review (finding F7): the cwd was stripped as a text prefix with no separator check and every
 * leading `/` dropped, so `/srv/proj-old/a.js` under a cwd `/srv/proj` read `-old/a.js`, and an absolute path outside the
 * cwd lost its `/` — `/tmp/a.txt` read `tmp/a.txt`, the spelling of a file of the project (C-02 promised "as recorded").
 */
export function spelledPath(path, cwd) {
  const s = String(path);
  if (!cwd) return s;
  if (s === cwd) return '';
  const cover = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return s.startsWith(cover) ? s.slice(cover.length).replace(/^\/+/, '') : s;
}

/** A path read where its recorder wrote it: `{ p, home, cwd, absolute }` — slashes forward; the home and the cwd when
 *  absolute; an absolute path normalized, a relative one joined to the cwd (null with no absolute cwd). */
function placed(path, place) {
  const p = slashed(path);
  const home = typeof place?.home === 'string' && isAbsolute(place.home) ? place.home : null;
  const cwd = typeof place?.cwd === 'string' && isAbsolute(slashed(place.cwd)) ? slashed(place.cwd) : null;
  const absolute = isAbsolute(p) ? posix.normalize(p) : cwd !== null ? posix.join(cwd, p) : null;
  return { p, home, cwd, absolute };
}

/**
 * Is `path` in a harness home folder of the recording's user? D90 (owner decision 2026-10-15): the slicer withholds
 * nothing by it any more (D69 b withheld an output, a prior state and recorded hunks); the code step's reader
 * (cli/src/code-snapshot.js) reads it. A home-relative path is read from the home on. Otherwise only a path with a `.claude` or `.codex` directory outside a
 * worktree, or (the release review of the code step) a harness home file (`isHomeFile`: `.claude.json` and its
 * backups), can be: held when it lies outside the recorder's working directory (`place.cwd`) or no absolute cwd places
 * it (D69 review F5: never the project's own); inside the cwd, held when it lies in the known home's folders or is one of
 * its home files (the cwd contains the home), or when the home is unknown (fails closed: the cwd may contain it).
 */
export function harnessHomePath(path, place = {}) {
  if (typeof path !== 'string' || !path) return false;
  const { p, home, cwd, absolute } = placed(path, place);
  const homeRelative = HOME_RELATIVE.exec(p);
  if (homeRelative) return inHomeFolder(p.slice(homeRelative[0].length));
  if (!anyHomeName(absolute ?? p)) return false;
  if (absolute === null || cwd === null || !within(absolute, cwd)) return true;
  return home === null || (absolute.startsWith(`${home}/`) && inHomeFolder(absolute.slice(home.length + 1)));
}

/**
 * The write scope's harness rule (D69 b, c; review F5): is `path` in the KNOWN home's harness folders (a home-relative
 * path, or a path under `place.home`), outside a worktree? Never fails closed: with no home read from structure, a
 * project's own `.claude` under the cwd stays work under review, and anything outside the cwd is outside it by the cwd
 * rule alone.
 */
export function homeFolderPath(path, place = {}) {
  if (typeof path !== 'string' || !path) return false;
  const { p, home, absolute } = placed(path, place);
  const homeRelative = HOME_RELATIVE.exec(p);
  if (homeRelative) return inHomeFolder(p.slice(homeRelative[0].length));
  return home !== null && absolute !== null && absolute.startsWith(`${home}/`)
    && inHomeFolder(absolute.slice(home.length + 1));
}
/**
 * D68 (R), D69 (b): why the content of the file at `path` was withheld — a closed member (redact
 * `RECORDED_FACTS.hunksWithheld`), `credential_path` (`CREDENTIAL_PATH`) or `harness_home` (`harnessHomePath`) — or null.
 * Structure only: the path, never the file. D90 (owner decision 2026-10-15): the slicer withholds nothing by it any
 * more (an observation, a prior state, a change's recorded hunks are all carried); the code step's reader
 * (cli/src/code-snapshot.js) still reads it.
 */
export const withheldFileReason = (path, place = {}) => (typeof path !== 'string' || !path ? null
  : credentialPath(path) || credentialPath(path.replaceAll('\\', '/')) ? 'credential_path'
    : harnessHomePath(path, place) ? 'harness_home' : null);

/** A whole-file body the record kept: a `Write`'s content, never an Edit's own fragment
 *  (`_editParts` marks the joined edit text, which is a patch, not a file state).
 *  F129: an EMPTY create body is a whole-file state too — `Write ''` emptied the file, and that is
 *  the last thing the record saw at the path; skipping it attached an older read instead.
 *  W3c-11: a heredoc that replaced the file (`cat > f <<'EOF'`) left exactly its body, empty or
 *  not. An appended one (`>>`) left the file plus its body, and an expanded one (unquoted
 *  delimiter) left text the record never saw — neither is the file's state. */
const wholeFileBody = (e) => {
  if ((e.kind !== 'create' && e.kind !== 'edit') || typeof e._body !== 'string' || e._editParts) return false;
  if (e._heredoc) return !e._heredoc.append && !e._heredoc.expanded;
  return e.kind === 'create' || e._body.length > 0;
};

/** D79, D80: the recorder's denial kinds that mean a call started and was stopped (evidence ledger.js
 *  `STOPPED_DENIALS`); every other kind of its closed vocabulary (redact `RECORDED_FACTS.denial`) means the call was
 *  refused before it ran. Re-declared here because the slicer imports nothing from the evidence package;
 *  test/d98-effect-rule.test.js holds the two equal. */
export const STOPPED_DENIAL_KINDS = Object.freeze(['interrupted', 'cancelled']);
/** The ledger kinds of a command, read as the evidence adapter reads them (what it attempted, `attempted ?? kind`): a
 *  failed command keeps what it attempted beside its legacy `error` kind. */
const COMMAND_KINDS = Object.freeze(['bash', 'test', 'error']);
/**
 * D98 (F9; D80 left it for the next re-freeze): is `events[index]` a write the slicer parsed from a command (`via`, a
 * sibling it emits right after its command) whose command the recorder typed as refused before it ran (a denial kind
 * of its closed vocabulary that is not a stopped one)? The parent is the command the run of `via` siblings hangs from,
 * as the evidence adapter links it (`shellWriteOf`): the same rule as evidence session.js `effectOf`'s `none` for such
 * a write, which test/d98-effect-rule.test.js checks event by event. Typed fields only.
 */
export function parsedFromRefusedCall(events, index) {
  if (!Array.isArray(events) || !events[index]?.via) return false;
  let at = index - 1;
  while (at >= 0 && events[at]?.via) at--;
  const command = at >= 0 ? events[at] : null;
  const kind = command?.recorded?.denial;
  return COMMAND_KINDS.includes(command?.attempted ?? command?.kind) && RECORDED_FACTS.denial.includes(kind)
    && !STOPPED_DENIAL_KINDS.includes(kind);
}

/**
 * Post-pass over the built events. Attaches `before` to the FIRST edit/create event of each
 * edited path, and to EVERY delete (F69), and deletes every transient field. The source
 * ladder, best first:
 *   original — the edit tool's own record of the file as it found it (Claude Code originalFile);
 *   read     — the LATEST non-error read of the path before its first write (the closest
 *              pre-edit state in the record; earlier reads of an unchanged file are the same);
 *   write    — for a file the record says was created (or whose prior existence is unknown),
 *              its first body; and, for a DELETE, the last whole-file body this session wrote
 *              to that path, when that is the most recent observation of it.
 * A path with an update-typed write and neither an original nor a read gets nothing.
 *   before = { text, source, turn, seq, partial, window?, truncated, lines, unknownPrior? }
 * D90 (owner decision 2026-10-15): no prior state is withheld for its path (D68 R and D69 b withheld a credential-shaped
 * path's and a harness home folder's: `{ withheld: reason }`, which a ledger an earlier slicer wrote may still carry and
 * the adapter reads, sonah-ledger.js `PRIOR_WITHHELD_REASONS`).
 * M36 phase 2 review (owner decision D68 H, critique c1): `turn` and `seq` name the event whose record holds the state —
 * the write itself for an `original` (the recorder kept it with that call), the Read for a `read`, the write for a
 * `write` — so a window labels the state by the event that recorded it. `window` is the Read's typed line window
 * (`file.startLine`, `numLines`, `totalLines`) when it is less than the file; `partial` says the read was part of the
 * file: by its typed window where the recorder typed one, else by an offset or a limit it asked for.
 * D68 (E): `text` is the source WHOLE (`truncated` is always false: only a persisted ledger an earlier Sonah cut says
 * true). Nothing cuts it (D90: nor masks it).
 *
 * The FIRST-WRITE rule is deliberate and stays: a later write of a path has no observed prior
 * state, and re-attaching the file's first version there would assert a state the record never
 * saw at that moment. A delete is not subject to it — a deletion's only code evidence is the
 * state it removed, and each delete is a distinct path-state the record did observe. Nothing is
 * reconstructed anywhere: with no source, there is no `before`. The adapter declares which rule
 * produced a change's before side (`priorState`).
 * D98 (F9): a write parsed from a command the recorder typed as refused before it ran (`parsedFromRefusedCall`) changed
 * nothing: it is never a path's first write, and its body is never a file's earlier state (`write`). Its own body stays
 * its `after`: the attempt stays visible.
 */
export function attachBefore(events) {
  const targets = [];             // [path, eventIndex] — a path's first write, and every delete
  const firstWrite = new Set();
  const refused = new Set();
  events.forEach((e, i) => { if (parsedFromRefusedCall(events, i)) refused.add(i); });
  events.forEach((e, i) => {
    if (!e.path || e.external || refused.has(i)) return;
    if (e.kind === 'delete') { targets.push([e.path, i]); return; }
    if ((e.kind === 'edit' || e.kind === 'create') && !firstWrite.has(e.path)) {
      firstWrite.add(e.path);
      targets.push([e.path, i]);
    }
  });
  for (const [path, wi] of targets) {
    const w = events[wi];
    // The most recent observation of this path before the target, scanning backwards: for a
    // write that is its latest read; for a delete, its latest read OR whole-file write,
    // whichever the record saw last.
    let read = null;
    let wrote = null;
    for (let i = wi - 1; i >= 0; i--) {
      const e = events[i];
      if (e.path !== path || refused.has(i)) continue;
      if (e.kind === 'read' && !e.isError && typeof e._readText === 'string' && (e._readText.length || e._readPlain === true)) {
        read = e;
        break;
      }
      if (w.kind === 'delete' && wholeFileBody(e)) { wrote = e; break; }
    }
    if (typeof w._orig === 'string' && w._orig.length) {
      const text = w._orig;
      w.before = { text, source: 'original', turn: w.turn, seq: w.seq, partial: false, truncated: false,
                   lines: text.split('\n').length };
    } else if (read) {
      // M33 R repair 3: the slicer keeps a Read's text unwrapped and de-numbered (`_readPlain`, events.js). A text that
      // is not is read here as it always was.
      const raw = read._readPlain === true ? read._readText : stripLineNumbers(unwrapReadResult(read._readText));
      const text = raw;
      const m = read._readMeta;
      const windowed = m && (m.startLine > 1 || (m.totalLines != null && m.numLines < m.totalLines));
      // M36 phase 2 review: where the recorder typed the read's window, it says whether the read was part of the file; an
      // offset or a limit only asked for part (a typed whole read with a limit past the file's end is the whole file).
      const partial = m ? !!windowed : Number.isFinite(read.offset) || Number.isFinite(read.limit);
      w.before = { text, source: 'read', turn: read.turn, seq: read.seq, partial, truncated: false,
                   lines: text.split('\n').length,
                   ...(windowed ? { window: { from: m.startLine, to: m.startLine + m.numLines - 1, total: m.totalLines } } : {}) };
    } else if (wrote) {
      const text = wrote._body;
      // An emptied file has no lines (F108's count, F129's case).
      w.before = { text, source: 'write', turn: wrote.turn, seq: wrote.seq, partial: false, truncated: false,
                   lines: text.length ? text.split('\n').length : 0 };
    } else if (w.kind === 'create' && typeof w._body === 'string' && w._body.length && w._writeType !== 'update') {
      const text = w._body;
      w.before = { text, source: 'write', turn: w.turn, seq: w.seq, partial: false, truncated: false,
                   lines: text.split('\n').length, ...(w._writeType === undefined ? { unknownPrior: true } : {}) };
    }
  }
  // S1-B: what a whole-file write left behind. The judge otherwise reads a defines summary and
  // must infer whether a symbol survived — the twin-accusation mechanism found in S1-A pass 1.
  // F67: for an Edit the same field carries the edit's OWN text — `parts` written segments,
  // then `priorParts` replaced ones, joined by the recorder's marker (events.js `editText`). D68 (E): both sides are
  // kept whole (F155's per-side cap and F168's per-side memory bound are gone with the cuts).
  // F108: an empty whole-file body (a file emptied, a cell cleared) is a recorded state with no
  // lines, not a missing one. An Edit's joined field is never empty: it always holds the marker.
  // W3c-11/F131: what the body IS, when it is not the file's new whole state, is declared on it —
  //   append   — a heredoc through `>>`: the text the file received at its end;
  //   expanded — a heredoc with an unquoted delimiter: the file received this text after shell
  //              expansion (`$VAR`, `$(…)`), which the record does not hold;
  //   insert   — a NotebookEdit insert: a new cell's source, not an existing cell's replacement.
  for (const e of events) {
    if ((e.kind === 'create' || e.kind === 'edit') && typeof e._body === 'string') {
      const text = e._body;
      e.after = { text, truncated: false, lines: text.length ? text.split('\n').length : 0,
        ...(e._editParts ? { parts: e._editParts, priorParts: e._editParts } : {}),
        ...(e._replaceAll ? { replaceAll: e._replaceAll } : {}),
        ...(e._heredoc?.append ? { append: true } : {}),
        ...(e._heredoc?.expanded ? { expanded: true } : {}),
        ...(e._insert ? { insert: true } : {}) };
    }
  }
  // Transient scratch only. `result` and `attempted` (CRD-A1/G2) are retained evidence, not
  // scratch: deleting them would restore the defect where an unobserved write reads as success.
  for (const e of events) {
    delete e._readText; delete e._body; delete e._orig; delete e._writeType; delete e._readMeta;
    delete e._editParts; delete e._replaceAll; delete e._heredoc; delete e._insert;
    delete e._readPlain;
  }
  return events;
}
