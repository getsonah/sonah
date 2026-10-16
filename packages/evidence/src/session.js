// The thought-action-observation spine: a canonical session of C-02 events, plus the receipt
// verification that makes every displayed claim checkable.
//
// The rule that matters: a receipt is grounded only when its quote appears LITERALLY in the
// reconstructed source of the exact event and role it cites. Nothing here trusts a model's
// word for what a session said. Verification is string search, in code.

import { resolveTextRef } from '../contracts/textref.js';
import { identityDigest } from '../contracts/canonical.js';
import { repairQuote, publishedReceipt, spansSyntheticMarker } from './receipt-repair.js';

// The event kinds a session holds. No product code reads this list; tools outside this repository do.
export const EVENT_KINDS = Object.freeze(['instruction', 'commentary', 'invocation', 'observation', 'boundary']);

// C-05 receipt roles. A role is a claim about WHICH channel the text came from, so a quote
// that exists in a tool result can never be presented as a human instruction (JG-03).
export const RECEIPT_ROLES = Object.freeze(['instruction', 'commentary', 'action', 'observation', 'code']);
// D71 (g): `project-instructions` — the project's own instruction file the harness gave the agent (a PROJECT INSTRUCTIONS
// region): its text is evidence of the project's rules, never the human's words and never an instruction. A role only
// grounding reads (`GROUNDING_ROLES`): RECEIPT_ROLES is the combined route's closed list (its joint schema), unchanged
// (D71 i); no combined request shows such a region, so no combined receipt can ground in one.
export const PROJECT_INSTRUCTIONS_ROLE = 'project-instructions';
export const GROUNDING_ROLES = Object.freeze([...RECEIPT_ROLES, PROJECT_INSTRUCTIONS_ROLE]);

/** Fix 1's "Referred from <path>", made safe to share: how a project instruction file is named where a
 *  person reads it (the page, the story, the report). Its recorded path when that path lies inside the working tree as
 *  written (the slicer spells a file under the recorder's working directory relative to it, events.js `relative`):
 *  relative, never climbing above where it starts. Else only its file name: an absolute path (a leading `/` or `\`,
 *  or a first segment naming a drive or a scheme, `C:`), a home-relative one (a first segment `~`, `~name`, `$HOME`,
 *  `%USERPROFILE%`: any `~`, `$` or `%` expansion) or one that climbs out (`../`) would name a place on the recorder's
 *  machine, its home folder and user name among them. Lexical, by the path's segments alone: no file system and no
 *  environment read. A path with no file name past its root reads `…`, the mark a clipped path's cut part reads. */
export function referredPath(path) {
  const recorded = String(path);
  const segments = recorded.replaceAll('\\', '/').split('/');
  const rooted = /^(?:$|[~$%]|[A-Za-z][A-Za-z0-9+.-]*:)/.test(segments[0]);
  let depth = 0;
  const climbs = segments.some((s) => (depth += s === '..' ? -1 : s && s !== '.' ? 1 : 0) < 0);
  if (!rooted && !climbs) return recorded;
  return segments.slice(rooted ? 1 : 0).filter((s) => s && s !== '.' && s !== '..').at(-1) ?? '…';
}

const ROLE_FOR_KIND = Object.freeze({
  instruction: 'instruction',
  commentary: 'commentary',
  invocation: 'action',
  observation: 'observation',
  'project-instructions': 'project-instructions',
});

// An earlier Sonah's redactor's marks in a hunk it scrubbed (`hunkRunsOf`, a hunk declared `hunkScrub`): those exact
// forms are that redactor's, and even their interior words are not source text. The leading newline on a dropped-lines
// note is part of the note. D90 (owner decision 2026-10-15): no Sonah writes a mark now, and a field's refs are the
// adapter's to cut: it places a mark outside every ref only where the field declares an earlier redactor's work
// (evidence/adapters/sonah-ledger.js `declaresRedaction`), and the same characters anywhere else are the recording's
// own text, inside a ref and quotable. So a ref is never split again here by what its text says.
const REDACTION_ARTIFACT = /‹(?:redacted|dropped)(?::[^›\n]+)?›|(?:^|\n)\[… \d+ line\(s\) dropped: [A-Za-z][A-Za-z -]*[A-Za-z] …\](?=\n|$)/g;

// A one-or-two letter quote would ground anywhere.
export const MIN_QUOTE_CHARS = 4;

/** H1: the result sources a failure may be concluded from: the harness's own record or the capture-time hook. */
export const NATIVE_RESULT_SOURCES = Object.freeze(['native', 'hook']);

/**
 * H1: does the record itself say this terminal result failed? `failed` or `cancelled` from a native or hook source, or
 * a recorded nonzero exit code (only ever typed by the harness or the hook). A failure label read from output text
 * (`parsed-output`) or recorded with no source proves nothing: every rule that rejects or concludes on a failed result
 * asks this, so a parsed outcome can only ever lead to `unknown`.
 */
export function recordedFailure(observation) {
  return (['failed', 'cancelled'].includes(observation?.result) && NATIVE_RESULT_SOURCES.includes(observation.sourceOfResult))
    || (Number.isFinite(observation?.exitCode) && observation.exitCode !== 0);
}

/**
 * The tool names a READ arrives under with `operation: 'other'` (closed). The contract lists `operation: 'read'`, but
 * the adapter never emits it: it maps only the slicer's create/edit/delete kinds to an operation and spells every other
 * non-command kind's tool by the kind (sonah-ledger.js), so the slicer's `read` kind — Claude Code's Read,
 * NotebookRead, Glob and Grep, and the vetted MCP file read — arrives as `tool: 'read', operation: 'other'`.
 * (Moved here from M33 X's carry.js, unchanged, when M35 windowing deleted the carry: the session page reads it.)
 */
export const READ_TOOLS = Object.freeze(['read']);
const READ_TOOL_SET = new Set(READ_TOOLS);
/** A read, in either spelling: a typed tool, never a program's name. */
export const isRead = (action) => action?.kind === 'invocation'
  && (action.operation === 'read' || (action.operation === 'other' && READ_TOOL_SET.has(action.tool)));

/** A session is an ordered event list plus the text blobs its TextRefs point into. */
export class Session {
  constructor({ sessionKey, rootSession = sessionKey, adapter = 'claude', events = [], blobs = {}, children = [],
    projectInstructions = [] }) {
    this.sessionKey = sessionKey;
    this.rootSession = rootSession;
    this.adapter = adapter;
    this.events = events;
    this.blobs = blobs; // sourceKey -> full decoded text
    // C-03 ChildLink[]: the recorded outcome of trying to resolve each delegation to a child
    // session. An empty list beside a delegation invocation means the child was never captured.
    this.children = children;
    this.byId = new Map(events.map((e) => [e.id, e]));
    // D71 (g), owner decision 2026-10-08: the project's own instruction files the harness gave the agent (the adapter's
    // `kind: 'project-instructions'` entries: a repository CLAUDE.md or AGENTS.md as recorded, never anything under the
    // harness home folders). Kept BESIDE the event list, never in it — no reader of `events` changes — each placed by
    // `afterSequence` (the sequence of the last event recorded before it; -1 before any) and named by its own id, so a
    // receipt of role `project-instructions` resolves through `event(id)` like any other.
    this.projectInstructions = Array.isArray(projectInstructions) ? projectInstructions : [];
    for (const entry of this.projectInstructions)
      if (typeof entry?.id === 'string' && !this.byId.has(entry.id)) this.byId.set(entry.id, entry);
  }

  /** Delegation invocations, whether or not their child session was captured. */
  delegations() {
    return this.events.filter((e) => e.kind === 'invocation' && e.operation === 'delegate');
  }

  /** The recorded child link for a delegation, or null when none was established. */
  childFor(assignmentEventId) {
    return this.children.find((c) => c.assignmentEvent === assignmentEventId) ?? null;
  }

  /** Attribute every cited action to one recorded actor. A child ID is useful only when the
   * verified links map it to exactly one child session; follow-ups to the same child may add
   * edges but cannot create a second actor. Never trust a model-supplied actor label. */
  actorForActions(actions) {
    const ambiguous = { state: 'ambiguous', sessionKey: null, childId: null };
    if (!Array.isArray(actions) || !actions.length) return ambiguous;
    const events = actions.map((action) => this.event(typeof action === 'string' ? action : action?.id));
    if (events.some((event) => event?.kind !== 'invocation')) return ambiguous;
    const ids = new Set(events.map((event) => event.childId ?? null));
    if (ids.size !== 1) return ambiguous;
    const [childId] = ids;
    if (childId === null) return { state: 'root', sessionKey: this.sessionKey, childId: null };
    const sessionKey = this.verifiedChildSession(childId);
    return sessionKey === null ? ambiguous : { state: 'verified-child', sessionKey, childId };
  }

  /** D71 (d): the recorded actor of one agent statement (a commentary event), by the rule `actorForActions` applies to
   *  actions — its lineage's child id, resolved through the verified links — for a choice not to act, which no action
   *  adopted. Ambiguous for anything that is not a commentary event, or a child id no verified link resolves. */
  actorForStatement(event) {
    const ambiguous = { state: 'ambiguous', sessionKey: null, childId: null };
    if (event?.kind !== 'commentary') return ambiguous;
    const childId = event.childId ?? null;
    if (childId === null) return { state: 'root', sessionKey: this.sessionKey, childId: null };
    const sessionKey = this.verifiedChildSession(childId);
    return sessionKey === null ? ambiguous : { state: 'verified-child', sessionKey, childId };
  }

  /** The one child session the verified links map `childId` to, or null: no verified link, links naming two
   *  sessions, a conflicting link, or a verified link without (or disagreeing about) its child session. The rule
   *  `actorForActions` attributes a child's actions by, and (M33 H) a statement to a helper by. */
  verifiedChildSession(childId) {
    if (typeof childId !== 'string' || !childId) return null;
    const links = this.children.filter((link) => link.childId === childId);
    const verified = links.filter((link) => link.state === 'verified'
      && typeof link.childSession === 'string' && link.childSession);
    const sessions = new Set(verified.map((link) => link.childSession));
    if (sessions.size !== 1 || links.some((link) => link.state === 'conflicting'
        || link.state === 'verified' && (!link.childSession
          || link.sessionKey != null && link.sessionKey !== link.childSession))) return null;
    return [...sessions][0];
  }

  event(id) {
    return this.byId.get(id) ?? null;
  }

  /** The terminal observation recorded against an invocation, if one exists. */
  observationFor(invocationId) {
    return this.events.find((e) =>
      e.kind === 'observation' && e.phase === 'terminal' && e.invocation === invocationId) ?? null;
  }

  /**
   * What the record says actually happened to an invocation.
   * 'none' means no terminal observation was recorded — which is NOT success. C-05: "A command
   * invocation establishes the choice to attempt that command even when it fails or is denied;
   * never turn it into a claim of execution success."
   */
  outcomeOf(invocationId) {
    return this.observationFor(invocationId)?.result ?? 'none';
  }

  /** True only when the action's completion is proved under its operation-specific rules. */
  succeeded(invocationId) {
    return this.actionOutcomeOf(invocationId) === 'succeeded';
  }

  /** Outcome of an action rather than its enclosing shell process. Direct writes need one
   * uniquely attributable native/hook terminal status before their semantic result can prove
   * adoption. A second terminal row, or a parsed-text success, establishes no write outcome.
   * A shell-inferred write can be proved only by one eligible simple direct-write command with
   * a typed zero exit. A failed or compound process can have written before failing, or failed
   * before succeeding elsewhere. */
  actionOutcomeOf(action) {
    const event = typeof action === 'string' ? this.event(action) : action;
    if (!event) return 'none';
    if (!event.shellWriteOf) {
      if (!['write', 'edit', 'delete'].includes(event.operation)) return this.outcomeOf(event.id);
      const receipts = this.events.filter((row) => row.kind === 'observation'
        && row.phase === 'terminal' && row.invocation === event.id);
      if (!receipts.length) return 'none';
      return receipts.length === 1 && receipts[0].terminalStatusProven === true
        && ['native', 'hook'].includes(receipts[0].sourceOfResult)
        && ['succeeded', 'failed', 'cancelled'].includes(receipts[0].result)
        ? receipts[0].result : 'unknown';
    }
    if (event.shellWriteStatusEligible !== true) return 'unknown';
    const receipts = this.events.filter((row) => row.kind === 'observation'
      && row.phase === 'terminal' && row.invocation === event.shellWriteOf);
    // A command's semantic result may be parsed from output even when its numeric exit came
    // from a typed native sidecar. `terminalStatusProven` plus exit=0 proves that exit; requiring
    // `sourceOfResult` here would discard legitimate typed command-status evidence.
    return receipts.length === 1 && receipts[0].terminalStatusProven === true
      && receipts[0].exitCode === 0 && receipts[0].result === 'succeeded'
      ? 'succeeded' : 'unknown';
  }

  /**
   * Resolve one field into maximal uninterrupted UTF-8 source spans. Two refs may be joined only
   * when they touch in the SAME blob. An elision, redaction, truncation, missing blob or malformed
   * ref breaks continuity; merely placing the surviving strings next to each other does not make
   * their seam a quotable source span. `complete` is relative to the supplied refs: an omitted
   * prefix/suffix must still be declared by the adapter's extent/coverage metadata.
   */
  textSpanInfoOf(event, field = 'text') {
    const { text, ranges, complete } = this.textRegionsOf(event, field);
    return { spans: ranges.map(({ from, until }) => text.slice(from, until)), complete };
  }

  /**
   * M36 phase 2 (C-07 "M36 window format"): the same spans as `textSpanInfoOf`, as character ranges of one text: the
   * field's stored text, its uninterrupted runs in order, every redactor artifact the adapter cut out of the refs kept
   * where it stands (outside every range). M36 phase 2 review: two runs of ONE blob, the later after the earlier, are separated in this text by exactly
   * what the blob stores between them (outside every range: an inline mask the adapter cut out of the refs stays in its
   * line, a dropped-lines note keeps its own line), so a field's lines are the stored text's own; only two runs with no
   * stored text between them (another blob, an unreadable ref, a ref before the one it follows) are joined by one line
   * break. A window cuts and numbers a field's lines in this text, so a redaction note's line is one line of it, and each
   * range is exactly one span `textSpanInfoOf` returns, in order. Text before the field's first ref and after its last
   * is not the field's (one blob may hold several fields: an Edit's segments).
   */
  textRegionsOf(event, field = 'text') {
    const refs = event?.[field];
    if (!Array.isArray(refs)) return { text: '', ranges: [], complete: false };
    const ranges = [];
    let text = '';
    let complete = true;
    // The run being read (its text, its first and its last ref), and the last ref of the last run placed in `text`.
    let current = '', first = null, previous = null, placed = null;
    /** The text one blob stores between two runs, the later after the earlier; null when there is none to read. */
    const storedBetween = (a, b) => {
      if (!a || !b || a.sourceKey !== b.sourceKey || !(b.fromByte > a.untilByte)) return null;
      try { return resolveTextRef(this.blobs[a.sourceKey], a.untilByte, b.fromByte); } catch { return null; }
    };
    const flush = () => {
      if (current) {
        if (text) text += storedBetween(placed, first) ?? '\n';
        ranges.push({ from: text.length, until: text.length + current.length });
        text += current;
        placed = previous;
      }
      current = '';
      first = null;
    };
    for (const ref of refs) {
      const blob = this.blobs[ref?.sourceKey];
      let part;
      try {
        if (typeof blob !== 'string') throw new TypeError('missing blob');
        part = resolveTextRef(blob, ref.fromByte, ref.untilByte);
      } catch {
        complete = false;
        flush();
        previous = null;
        placed = null;
        continue;
      }
      if (previous && (ref.sourceKey !== previous.sourceKey || ref.fromByte !== previous.untilByte)) {
        complete = false;
        flush();
      }
      first ??= ref;
      current += part;
      previous = ref;
    }
    flush();
    return { text, ranges, complete };
  }

  textSpansOf(event, field = 'text') {
    return this.textSpanInfoOf(event, field).spans;
  }

  /** A compact display/measurement projection, never a source for grounding or prompt fences. */
  textOf(event, field = 'text') {
    return this.textSpansOf(event, field).join('');
  }

  /** M36 phase 2: the recorded hunks of a call as same-side runs (`hunkRunsOf`), for a window to render. */
  hunkRunsOf(event) {
    return hunkRunsOf(event);
  }

  /** Keep each field separate as well as each uninterrupted span inside that field. */
  sourceGroupsFor(event) {
    if (!event) return [];
    const field = (role, holder, name) => ({ role, spans: this.textSpansOf(holder, name) });
    switch (event.kind) {
      case 'instruction': return [field('instruction', event, 'text')];
      case 'commentary': return [field('commentary', event, 'text')];
      case 'observation': return [field('observation', event, 'output')];
      // D71 (g): a project instruction file, whole, as the harness gave it to the agent (after redaction).
      case 'project-instructions': return [field('project-instructions', event, 'text')];
      case 'invocation': return [
        field('action', event, 'command'),
        // A delegate's captured brief is an action the parent sent to an agent, never a human
        // instruction. Keeping it citable lets review check what a follow-up actually asked.
        ...(['other', 'delegate'].includes(event.operation) ? [field('action', event, 'input')] : []),
        ...(event.paths ?? []).map((p) => ({ role: 'action', spans: [p.path] })),
        // B1: both sides of a change are code the record actually carried — the body the write
        // put on disk, and, for the first edit of a path, the file as the record found it. A
        // deletion has only the prior state, and that is the only code evidence it ever has.
        // An absent side resolves to '', which grounds nothing and costs no budget.
        ...(event.changes ?? []).flatMap((c) => [
          field('code', c, 'after'),
          field('code', c, 'before'),
          // M36 phase 2: an edit's own replaced text, kept beside the file state its first change carries (adapter).
          ...(Array.isArray(c?.replaced) ? [field('code', c, 'replaced')] : []),
        ]),
        // M36 phase 2 (D68 c3; C-05 "M36 hunk runs"): each maximal same-side run of a hunk the recorder recorded for the
        // call — its context, removed or added lines, markers and numbers stripped — is a code source of its own.
        // `hunk` marks the group: the runs show the same recorded change its bodies hold, so a count of a quote's
        // occurrences in the event's recorded code (ledger.js `codeSourceTexts`) reads the bodies, not both.
        ...(hunkRunsOf(event) ?? []).map((run) => ({ role: 'code', spans: run.spans, hunk: true })),
      ];
      default: return [];
    }
  }

  /** Every independently quotable source, labelled by its legitimate receipt role. */
  sourcesFor(event) {
    return this.sourceGroupsFor(event).flatMap(({ role, spans }) =>
      (spans.length ? spans : ['']).map((text) => ({ role, text })));
  }
}

/** M36 phase 2 (D68 c3): the side a hunk line's marker names, as the recorder wrote it (a `\\` line marks that the line
 *  before it has no line break at the end of the file: no line of the file). */
export const HUNK_SIDES = Object.freeze({ ' ': 'context', '-': 'removed', '+': 'added' });
const NO_NEWLINE_MARK = '\\';

/** The ranges of `text` between an earlier redactor's artifacts, as `textRegionsOf` ranges a field: each an
 *  uninterrupted span. Read only for hunks that redactor declared it scrubbed (`hunkRunsOf`). */
export function artifactRanges(text) {
  const ranges = [];
  let cursor = 0;
  for (const match of text.matchAll(REDACTION_ARTIFACT)) {
    if (match.index > cursor) ranges.push({ from: cursor, until: match.index });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) ranges.push({ from: cursor, until: text.length });
  return ranges;
}

/**
 * M36 phase 2 (owner decision D68 H, critique c3; C-05 "M36 hunk runs"). The hunks the recorder recorded for one call
 * (`recorded.hunks`: Claude Code's `structuredPatch`, a Codex change's `unified_diff`, already scrubbed before
 * `slice_hash`), as their maximal same-side runs, in order: `{ hunk, side, old: [from, through] | null, new: [from,
 * through] | null, lines, noNewlineAtEnd, text, ranges, spans }` — `old` the run's lines of the file as recorded before
 * the call (context and removed), `new` its lines of the file the call left, as the recorder numbered them (context and
 * added), `text` its lines (markers stripped) joined by line breaks, `ranges` and `spans` that text between every
 * redactor artifact (as `textRegionsOf` gives a field's): a line redaction masked (`‹dropped›`) keeps its place and is
 * never quotable. Structure only; nothing is computed but the recorder's own numbering. Null when the call recorded no
 * hunks, or any hunk is not of the recorded shape (its runs are then not shown and not sources).
 */
export function hunkRunsOf(event) {
  const hunks = event?.kind === 'invocation' ? event.recorded?.hunks : undefined;
  if (!Array.isArray(hunks) || !hunks.length) return null;
  const whole = (n) => Number.isSafeInteger(n) && n >= 0;
  const runs = [];
  for (let at = 0; at < hunks.length; at++) {
    const hunk = hunks[at];
    if (hunk === null || typeof hunk !== 'object' || !whole(hunk.oldStart) || !whole(hunk.newStart)
        || !Array.isArray(hunk.lines) || !hunk.lines.every((line) => typeof line === 'string'
          && (Object.hasOwn(HUNK_SIDES, line[0]) || line[0] === NO_NEWLINE_MARK))) return null;
    let oldLine = hunk.oldStart, newLine = hunk.newStart, run = null;
    for (const line of hunk.lines) {
      if (line[0] === NO_NEWLINE_MARK) { if (run) run.noNewlineAtEnd = true; continue; }
      const side = HUNK_SIDES[line[0]];
      if (!run || run.side !== side) {
        run = { hunk: at, side, old: side === 'added' ? null : [oldLine, oldLine - 1],
          new: side === 'removed' ? null : [newLine, newLine - 1], lines: [], noNewlineAtEnd: false };
        runs.push(run);
      }
      run.lines.push(line.slice(1));
      if (side !== 'added') { run.old[1] = oldLine; oldLine++; }
      if (side !== 'removed') { run.new[1] = newLine; newLine++; }
    }
  }
  // D90: an earlier redactor's marks are read only in hunks it declared it scrubbed (`hunkScrub`, never produced now); in
  // any other the same characters are the file's own text.
  const scrubbed = event.recorded?.hunkScrub !== undefined;
  for (const run of runs) {
    run.text = run.lines.join('\n');
    run.ranges = scrubbed ? artifactRanges(run.text) : run.text.length ? [{ from: 0, until: run.text.length }] : [];
    run.spans = run.ranges.map(({ from, until }) => run.text.slice(from, until));
  }
  return runs;
}

/**
 * M36 phase 2 (critique c4; C-05 "M36 grounding per shown span"): the session as one window's grounding reads it. A
 * quote the window's model returned grounds only inside ONE span the window showed (or, from phase 3, served): for every
 * event its source map holds (C-05: `{ role, text }` entries, a served span appended as one more entry of its event), the
 * view's sources are exactly those entries — consecutive entries of one role are one group, so a near-miss repair never
 * joins two of them — and never the event's whole recorded text. An event the map does not hold keeps its recorded
 * sources: a model receipt citing one is already refused as unsupplied (run-review.js `suppliedCandidate`), so only a
 * receipt code built from the record (a forbidden edit's undoing action) reaches it. Every other method is the
 * session's own. A null map is the session itself.
 *
 * M36 phase 3 review (owner decision D68 K, critique c6), decided by the owner as D69 (a) (2026-10-08): a window holding
 * several sessions needs no more. A quote grounds only inside a span of the event its receipt cites, and every event was
 * recorded in one session (its `childId`, null the root's), so the cited event names the quote's session — by
 * structure, never by its words — and the verified receipt carries it (`verifyReceipt`): attributed, never rejected. The same words in another session's shown text change nothing: packing schedules
 * sessions into one call and never changes what a quote grounds in. Where receipts must be one session's, the checks
 * that read several of them say so: a decision's actions (`actor_ambiguous`, M33 G4), a contradiction
 * (`other_session`), a support or a resolution (`cross_actor`).
 */
export function shownSession(session, sourceMap) {
  if (sourceMap == null || session == null) return session;
  const groupsOf = (event) => {
    const listed = event && typeof event.id === 'string' && Object.hasOwn(sourceMap, event.id) ? sourceMap[event.id] : undefined;
    if (!Array.isArray(listed)) return null;
    const groups = [];
    for (const source of listed) {
      if (!source || typeof source.text !== 'string' || !GROUNDING_ROLES.includes(source.role)) continue;
      const last = groups.at(-1);
      if (last && last.role === source.role) last.spans.push(source.text);
      else groups.push({ role: source.role, spans: [source.text] });
    }
    return groups;
  };
  const view = Object.create(session);
  view.sourceGroupsFor = (event) => groupsOf(event) ?? session.sourceGroupsFor(event);
  view.sourcesFor = (event) => {
    const groups = groupsOf(event);
    return groups === null ? session.sourcesFor(event)
      : groups.flatMap(({ role, spans }) => spans.map((text) => ({ role, text })));
  };
  return view;
}

/** A word character, and the scripts written without spaces between words (there, every character is a word's edge). */
const WORD = /[\p{L}\p{M}\p{N}_]/u;
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
/** Do two adjacent characters belong to one word? */
const oneWord = (a, b) => a !== undefined && b !== undefined && WORD.test(a) && WORD.test(b) && !UNSPACED.test(a)
  && !UNSPACED.test(b);

/**
 * M33 N repair: does `quote` occur in `text` starting and ending on a word's edge, at least once? A quote cut inside a
 * word can turn what it says around ("not" read as "no", "unwise" as "wise"), so it is never grounded. Pure. (Moved here
 * from forbidden.js by M33 brittleness M4's session route, so the one disclosure check of both routes applies it too.)
 */
export function atWordEdges(text, quote) {
  if (typeof text !== 'string' || typeof quote !== 'string' || !quote) return false;
  const first = Array.from(quote.slice(0, 2))[0], last = Array.from(quote.slice(-2)).pop();
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    const end = at + quote.length;
    const before = Array.from(text.slice(Math.max(0, at - 2), at)).pop(), after = Array.from(text.slice(end, end + 2))[0];
    if (!oneWord(before, first) && !oneWord(last, after)) return true;
  }
  return false;
}

/**
 * C-05 receipt verification, in the contract's order. Returns a grounded receipt or a typed
 * rejection — never a partial "probably fine".
 *
 * A valid quote establishes PROVENANCE only. It does not make the surrounding explanation true.
 */
export function verifyReceipt(session, receipt) {
  const sources = citableSources(session, receipt);
  if (sources === null) return { ok: false, reason: 'receipt_rejected', receipt };

  // Exact substring of ONE uninterrupted source span of the declared role. Joining disconnected
  // refs, even within the same event and blob, is exactly what this refuses.
  const grounded = sources.some((s) => s.text.includes(receipt.quote));
  if (!grounded) return { ok: false, reason: 'receipt_rejected', receipt };

  // M36 phase 3 review (critique c6): the receipt carries the session its quote grounds in — the recording's key, and
  // the cited event's recorded child id when a helper's session recorded it — set here from the event, never from what
  // the model sent. Not part of a receipt's identity (`receiptProjection`): the event id already names it.
  const { childId: _sent, ...rest } = receipt;
  const recorded = session.event(receipt.eventId)?.childId;
  const childId = typeof recorded === 'string' && recorded ? recorded : null;
  return { ok: true, receipt: { ...rest, sessionKey: session.sessionKey, ...(childId ? { childId } : {}) } };
}

/**
 * Everything C-05 requires BEFORE the substring test, in the contract's order: the sources of
 * the declared role that this receipt is entitled to quote from, or null when it is entitled to
 * none. Kept in one place so the strict check and the repair can never drift apart about what
 * "the same receipt, with a better quote" means.
 */
function citableSources(session, receipt) {
  if (!receipt || typeof receipt.quote !== 'string') return null;
  if (!GROUNDING_ROLES.includes(receipt.role)) return null;
  // A surviving route may still carry the redactor's inline mask or a dropped-lines note in
  // one ref. Those characters are recorder prose, never something the speaker or code said.
  if (spansSyntheticMarker(receipt.quote)) return null;

  const event = session.event(receipt.eventId);
  if (!event) return null; // cites an event that does not exist

  // Role/event compatibility: a commentary quote cannot be sold as an instruction.
  const natural = ROLE_FOR_KIND[event.kind];
  const allowed = event.kind === 'invocation' ? ['action', 'code'] : [natural];
  if (!allowed.includes(receipt.role)) return null;

  // Session identity: a quote cannot borrow matching text from another session.
  if (receipt.sessionKey != null && receipt.sessionKey !== session.sessionKey) return null;

  if (receipt.quote.trim().length < MIN_QUOTE_CHARS) return null;

  return session.sourcesFor(event).filter((s) => s.role === receipt.role);
}

/**
 * Deterministic repair of a near-miss quote (W3-3). Returns a VERIFIED receipt or a rejection.
 *
 * What this is not: it is not a second, laxer way to ground a receipt. The repair proposes one
 * candidate — an exact substring of one source, produced by code in `receipt-repair.js` — and
 * `verifyReceipt` above is what accepts it. A quote that cannot be snapped, or whose snapped
 * form still fails the strict check, is rejected exactly as it is today.
 *
 * Only a failed SUBSTRING test is repairable. A receipt that cites a missing event, claims the
 * wrong role for the kind, names another session, or is too short to be distinctive is refused
 * outright: those are claims about provenance, and no amount of string work makes them true.
 *
 * One repair per receipt. The caller never retries.
 */
export function repairReceipt(session, receipt) {
  const strict = verifyReceipt(session, receipt);
  if (strict.ok) return strict;

  const rejected = { ok: false, reason: 'receipt_rejected', receipt };

  const sources = citableSources(session, receipt);
  if (sources === null) return rejected;

  // Frozen PR-code facades supply `event`/`sourcesFor` without TextRefs; they have one intact
  // code source and therefore no disjoint-ref groups. Session-backed facades should delegate
  // sourceGroupsFor so this guard also covers their historical event receipts.
  const groups = (typeof session.sourceGroupsFor === 'function'
    ? session.sourceGroupsFor(session.event(receipt.eventId)) : [])
    .filter((group) => group.role === receipt.role && group.spans.length > 1)
    .map((group) => group.spans);
  const snapped = repairQuote(sources.map((s) => s.text), receipt.quote, MIN_QUOTE_CHARS,
    { disjointGroups: groups });
  if (snapped == null) return rejected;

  // The snapped quote earns nothing by being snapped: it is verified from scratch.
  const verified = verifyReceipt(session, { ...receipt, quote: snapped });
  if (!verified.ok) return rejected;

  // `repairedFrom` is accounting only. The renderer shows `quote`, which is now exact; what the
  // model originally wrote is never displayed as evidence.
  return {
    ok: true,
    receipt: { ...verified.receipt, repairedFrom: receipt.quote },
    repaired: true,
    original: receipt.quote,
  };
}

/**
 * Verify a set of receipts, keeping the rejections rather than silently dropping them.
 * `repaired` is how many of the verified ones needed snapping — the yield this bought.
 *
 * F77: each verified receipt is the one a reader is shown. One that repair snapped carries
 * `repaired: true` and its `original`; every other one carries no repair field at all, whatever
 * the model sent, so the flag is only ever code's statement about what code did.
 */
export function verifyReceipts(session, receipts = [], { repair = true } = {}) {
  const results = receipts.map((r) => (repair ? repairReceipt(session, r) : verifyReceipt(session, r)));
  return {
    verified: results.filter((r) => r.ok).map(publishedReceipt),
    rejected: results.filter((r) => !r.ok),
    repaired: results.filter((r) => r.ok && r.repaired === true).length,
  };
}

/** Stable identity for a receipt projection, used inside row identities (C-06). */
export function receiptProjection(receipt) {
  return {
    role: receipt.role,
    sessionKey: receipt.sessionKey ?? null,
    eventId: receipt.eventId ?? null,
    revisionOid: receipt.revisionOid ?? null,
    quote: receipt.quote,
  };
}

export function decisionIdentity(repo, decision) {
  return identityDigest('sonah.decision-identity/1', {
    repo,
    actorSession: decision.actorSession,
    dimension: decision.dimension,
    value: decision.value ?? null,
    actions: decision.actions ?? [],
    stated: decision.stated ? receiptProjection(decision.stated) : null,
  }, ['actions']);
}

export function findingIdentity(repo, finding) {
  return identityDigest('sonah.finding-identity/1', {
    repo,
    origin: finding.origin,
    kind: finding.kind,
    scope: finding.scope,
    receipts: (finding.receipts ?? []).map(receiptProjection),
    anchor: finding.anchor ?? null,
  }, ['receipts']);
}
