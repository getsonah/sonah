// R4, frozen against contracts 0.1 at ac4d830. Integration entry point for R3/R6:
// call runCodeReview instead of adding a second model call beside runReview.
// This module owns the frozen-diff boundary; the existing grounder remains unchanged.
// Inputs must already be redacted. No disk, network, clock or transport is used here.

import { Session, MIN_QUOTE_CHARS, repairReceipt, shownSession, effectReader, ACTION_EFFECTS } from './session.js';
import { challengeItems, CHALLENGE_PROFILE, requestFits, reviewInputBytes, MAX_REVIEW_INPUT_BYTES,
  disclosureAsks, disclosureOutcomes, disclosureCounts } from './challenge.js';
import { runReview, TRANSPORT_SHORTFALL, promisesBesideFindings, unverifiedBesideFindings, resultReceiptRepair,
  claimCore, claimBare, bindingsFor, unsettledContradictionStatements, plannedSourceMap } from './run-review.js';
import { WRITTEN_CHANNEL, writtenChatClaim, windowSourceMap } from './written.js';
import { buildNarrativePrompt, NARRATIVE_SCHEMA } from './prompt.js';
import { buildLedger, groundFinding, honestStatuses, mergeDuplicateFindings, codeSourceTexts, coverageBeforeUnrecordedCap,
  withheldRejection, withheldCauseCounts, declaredCauses, WITHHELD_REJECTION_CAUSES, WRITTEN_WITHHELD_CAUSES,
  PROMISE_STATUSES, SUPPORT_REJECTIONS, JUDGE_FAILURE_CODES, markHelperStatements } from './ledger.js';
import { buildCodeReviewPrompt, CODE_REVIEW_VERSION, CODE_REVIEW_SCHEMA, FILE_STATES,
  fileReview, renderManifest, widestManifest, renderHunks, windowDiff } from './code-review-prompt.js';
// D87 (spec item 5, "lift, don't revive"): the grounding helpers this route used live in code-pass.js now; this module
// imports them back and behaves byte for byte as before. The route stays retired (D82 step 10): nothing ships it.
import { sourceId, identifySources, sourceSession, quoteOverlaps, receiptRepairOnce } from './code-pass.js';
export { sourceId, identifySources };

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/**
 * W3d-2. The error a judge wrapper rethrows for a failed call: the call's own code when it is
 * one of JUDGE_FAILURE_CODES, otherwise `model_unavailable` — the closed-token rule `runReview`
 * applies to every window — plus its transport class when it carried one (outside the closed
 * list it is `unknown`). The wrappers used to keep only `budget_exhausted`, so a missing key and
 * a timeout both reached the window as `model_unavailable` with no class. Never the message:
 * that is the transport's text, and it can carry the prompt or a key (B5).
 */
function judgeFailure(error) {
  const code = JUDGE_FAILURE_CODES.includes(error?.code) ? error.code : 'model_unavailable';
  const transportClass = error?.transportClass == null ? null
    : TRANSPORT_SHORTFALL.includes(error.transportClass) ? error.transportClass : 'unknown';
  return Object.assign(new Error(code), { code }, transportClass ? { transportClass } : {});
}

const forbidden = new Set(['severity', 'confidence', 'rank', 'tier', 'priority', 'importance',
  'approved', 'permission', 'completeness', 'materiality', 'materialityRule', 'column']);

function hasRating(value) {
  if (Array.isArray(value)) return value.some(hasRating);
  return plain(value) && Object.entries(value).some(([key, val]) => forbidden.has(key) || hasRating(val));
}

// Transport schema enforcement is not assumed (the local subscription backend returns JSON).
// This implements only the JSON-schema keywords used by this module's pinned output schema.
function matches(value, schema) {
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    if (!types.some((t) => t === 'integer' ? Number.isSafeInteger(value)
      : t === 'object' ? plain(value) : t === kind)) return false;
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (typeof value === 'string' && (value.length < (schema.minLength ?? 0)
      || value.length > (schema.maxLength ?? Infinity))) return false;
  if (typeof value === 'number' && value < (schema.minimum ?? -Infinity)) return false;
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || (schema.uniqueItems && new Set(value).size !== value.length)) return false;
    if (schema.items && !value.every((v) => matches(v, schema.items))) return false;
    if (schema.contains && !value.some((v) => matches(v, schema.contains))) return false;
  }
  if (plain(value)) {
    if ((schema.required ?? []).some((k) => !Object.hasOwn(value, k))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some((k) => !Object.hasOwn(schema.properties ?? {}, k))) return false;
    if (Object.entries(schema.properties ?? {}).some(([k, s]) => Object.hasOwn(value, k) && !matches(value[k], s))) return false;
  }
  return true;
}

// Slack for the difference between a probe request and the real one: fence framing and the
// manifest's own state words. A probe is always built in its widest form, so this only ever
// leaves a request smaller than the cap, never larger.
const BUDGET_RESERVE = 1024;

// F106: why a changed file could not be reviewed, in the words the `code_unreviewable` note uses.
// The reasons `fileReview` assigns (code-review-prompt.js), in a fixed order.
const UNREVIEWABLE_REASONS = Object.freeze([
  ['binary', 'binary'], ['withheld', 'withheld by redaction'],
  ['oversize', 'over the request budget'], ['diff_unparsed', 'whose diff did not parse'],
]);

// A chunk call reviews files no session window carried. It is not a second extraction pass:
// re-extracting the same decisions from the same events would double-count them.
const CHUNK_INSTRUCTION = `

## Code-only chunk — this is not a session extraction

The files marked "shown" above were not carried by any session window; this request exists to
review them. Return decisions, pivots, claims, requirements and writtenClaims EMPTY: they are
extracted from the session windows, not here. Any session events shown are the recorded invocations that
touched these files, supplied as context for codeFindings and sessionFindings only.
reviewedFiles still lists exactly the "shown" files whose patch you checked.`;

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Git quoted paths use C escapes, not just JSON escapes. Support UTF-8 octal bytes as well.
function diffPath(line, prefix) {
  let path = line.slice(4).split('\t')[0];
  if (path === '/dev/null') return null;
  if (path.startsWith('"')) {
    if (!path.endsWith('"')) throw new Error('unreviewed_scope');
    const bytes = [];
    for (let i = 1; i < path.length - 1; i++) {
      if (path[i] !== '\\') {
        const cp = String.fromCodePoint(path.codePointAt(i));
        bytes.push(...Buffer.from(cp));
        i += cp.length - 1;
      } else {
        const octal = path.slice(i + 1).match(/^[0-7]{3}/);
        if (octal) { bytes.push(parseInt(octal[0], 8)); i += 3; }
        else {
          const escaped = { t: '\t', n: '\n', r: '\r', b: '\b', f: '\f', v: '\v', '\\': '\\', '"': '"' }[path[++i]];
          if (escaped === undefined) throw new Error('unreviewed_scope');
          bytes.push(...Buffer.from(escaped));
        }
      }
    }
    path = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
  }
  if (!path.startsWith(prefix) || !path.slice(2) || /[\x00-\x1f\x7f]/.test(path)
      || path.slice(2).split('/').some((p) => p === '..' || p === '.' || !p))
    throw new Error('unreviewed_scope');
  return path.slice(2);
}

/** The changed file one `diff --git` block names, or null when it cannot be attributed. */
function blockPath(section) {
  let oldPath = null, newPath = null, named = false;
  for (const line of section.split('\n')) {
    if (line.startsWith('@@')) break;
    try {
      if (line.startsWith('--- ')) { oldPath = diffPath(line, 'a/'); named = true; }
      else if (line.startsWith('+++ ')) { newPath = diffPath(line, 'b/'); named = true; }
    } catch { named = false; break; } // an undecodable header leaves the block unattributed
  }
  // A block with no ---/+++ preamble (a mode change, a binary file) names itself in its
  // header, but only when both sides are the same path; anything else stays unattributed.
  const path = named ? (newPath ?? oldPath) : (section.match(/^diff --git a\/(.+) b\/\1$/m)?.[1] ?? null);
  return typeof path === 'string' ? path : null;
}

// Every `diff --git` header opens a new block; text before the first one is a block of its own.
const diffSections = (diff) => diff.split(/(?=^diff --git )/m);

/**
 * Split the supplied patch into one verbatim block per changed file, in the order the patch
 * lists them. This is what a request shows a model instead of the whole diff (F30). It is a
 * separate, deliberately simple pass: the strict parser below owns validity and quotable
 * sources, and a block this pass cannot attribute to a named file is dropped, never guessed.
 */
function diffBlocks(diff, files) {
  const known = new Set(files.map((f) => f.path));
  const blocks = new Map();
  if (typeof diff !== 'string' || !diff) return blocks;
  for (const section of diffSections(diff)) {
    if (!section.startsWith('diff --git ')) continue;
    const lines = section.split('\n');
    const path = blockPath(section);
    if (path === null || !known.has(path) || blocks.has(path)) continue;
    let additions = 0, deletions = 0;
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }
    const file = files.find((entry) => entry.path === path);
    const withheld = Array.isArray(file?.withheldHunks)
      ? file.withheldHunks.filter(validHunkRange).map(({ oldStart, oldLines, newStart, newLines }) =>
        ({ oldStart, oldLines, newStart, newLines, reason: 'redacted_content' })) : [];
    // This is code-owned coverage metadata, outside every hunk and every quotable SOURCE.
    // It tells the reviewer that a displayed block is incomplete without inventing code lines.
    const omissionNote = withheld.length
      ? `\n[Sonah coverage: ${withheld.length} diff hunk(s) withheld; original ranges ${JSON.stringify(withheld)}. These ranges were not reviewed.]\n`
      : '';
    blocks.set(path, { path, text: section + omissionNote, additions, deletions });
  }
  return blocks;
}

const validHunkRange = (hunk) => hunk && Object.keys(hunk).sort().join(',')
  === 'newLines,newStart,oldLines,oldStart,reason'
  && hunk.reason === 'redacted_content'
  && [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines].every(Number.isSafeInteger)
  && hunk.oldStart >= 0 && hunk.newStart >= 0
  && hunk.oldLines >= 0 && hunk.newLines >= 0 && hunk.oldLines + hunk.newLines > 0
  && (!hunk.oldLines || hunk.oldStart > 0) && (!hunk.newLines || hunk.newStart > 0);

const intersectsWithheld = (source, hunk) => {
  const start = source.side === 'LEFT' ? hunk.oldStart : hunk.newStart;
  const count = source.side === 'LEFT' ? hunk.oldLines : hunk.newLines;
  return count > 0 && source.startLine <= start + count - 1 && source.endLine >= start;
};

function validWithheldHunks(file, sources) {
  const hunks = file.withheldHunks;
  if (!Array.isArray(hunks) || !hunks.length || !hunks.every(validHunkRange)) return false;
  if (file.change === 'added' && hunks.some((hunk) => hunk.oldLines !== 0)
    || file.change === 'deleted' && hunks.some((hunk) => hunk.newLines !== 0)) return false;
  let oldEnd = 0, newEnd = 0;
  for (const hunk of hunks) {
    if ((hunk.oldLines && hunk.oldStart <= oldEnd)
      || (hunk.newLines && hunk.newStart <= newEnd)
      || sources.some((source) => source.path === file.path && intersectsWithheld(source, hunk))) return false;
    if (hunk.oldLines) oldEnd = hunk.oldStart + hunk.oldLines - 1;
    if (hunk.newLines) newEnd = hunk.newStart + hunk.newLines - 1;
  }
  return true;
}

/** Parse and freeze the exact supplied patch, never a mutable working tree or fuzzy suffix. */
export function snapshotDiff({ pr, diff }) {
  const files = Array.isArray(pr?.files) ? pr.files.map((f) => ({ ...f })) : [];
  const snapshot = { baseOid: pr?.diffBaseOid ?? pr?.baseOid ?? null, headOid: pr?.headOid ?? null,
    diff: typeof diff === 'string' ? diff : '', files, sources: [], blocks: [], unreviewable: [],
    complete: false };
  const oid = (v) => typeof v === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(v);
  const usable = oid(pr?.baseOid) && oid(snapshot.baseOid) && oid(snapshot.headOid)
    && pr.baseOid.length === snapshot.headOid.length && snapshot.baseOid.length === snapshot.headOid.length
    && (pr.gitAlgorithm == null || pr.gitAlgorithm === (snapshot.headOid.length === 40 ? 'sha1' : 'sha256'))
    && typeof diff === 'string' && diff.length > 0 && files.length > 0
    && files.every((f) => text(f.path, 4096)) && new Set(files.map((f) => f.path)).size === files.length;
  if (!usable) return deepFreeze(snapshot);

  const seen = new Set();

  // The strict parser over ONE block: every check it has always made, over one file's lines.
  // It throws on a structurally invalid header or hunk and commits nothing itself; `found`
  // records which files the block had located before it failed, so the caller can name them.
  const parseBlock = (lines, found) => {
    const sources = [];
    let clean = true;
    let oldPath;
    let current = null;
    let newPath;
    let headerPaths = null;
    let pendingFile = false;
    let lastEnd = { LEFT: 0, RIGHT: 0 };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('diff --git ')) {
        pendingFile = true;
        headerPaths = [];
        const header = line.slice('diff --git '.length);
        // A Git pathname may itself contain spaces. Test separator candidates, then match
        // the decoded pair against the authoritative ---/+++ names rather than guessing.
        for (let at = header.indexOf(' '); at !== -1; at = header.indexOf(' ', at + 1)) {
          try { headerPaths.push([diffPath('--- ' + header.slice(0, at), 'a/'), diffPath('+++ ' + header.slice(at + 1), 'b/')]); }
          catch { /* This space was part of a pathname. */ }
        }
        oldPath = undefined; current = null; continue;
      }
      if (line.startsWith('--- ')) { oldPath = diffPath(line, 'a/'); current = null; continue; }
      if (line.startsWith('+++ ')) {
        if (oldPath === undefined) throw new Error('unreviewed_scope');
        newPath = diffPath(line, 'b/');
        const path = newPath ?? oldPath;
        current = files.find((f) => f.path === path);
        const change = oldPath === null ? 'added' : newPath === null ? 'deleted'
          : oldPath === newPath ? 'modified' : 'renamed';
        if (!current || seen.has(path) || found.has(path) || (newPath === null && current.change !== 'deleted')
            || (oldPath === null && current.change !== 'added')
            || current.change !== change
            || (headerPaths && !headerPaths.some(([l, r]) => l === (oldPath ?? newPath) && r === (newPath ?? oldPath)))
            || (oldPath !== null && newPath !== null && oldPath !== newPath
              && (current.change !== 'renamed' || current.oldPath !== oldPath)))
          throw new Error('unreviewed_scope');
        found.add(path);
        pendingFile = false;
        lastEnd = { LEFT: 0, RIGHT: 0 };
        continue;
      }
      if (line.startsWith('@@')) {
        const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/);
        if (!current || !m) throw new Error('unreviewed_scope');
        const [left, leftCount, right, rightCount] = [Number(m[1]), Number(m[2] ?? 1), Number(m[3]), Number(m[4] ?? 1)];
        if (![left, leftCount, right, rightCount, left + leftCount, right + rightCount].every(Number.isSafeInteger)
            || (oldPath === null && leftCount !== 0) || (newPath === null && rightCount !== 0)
            || (leftCount && left < 1) || (rightCount && right < 1)
            || (leftCount && left <= lastEnd.LEFT) || (rightCount && right <= lastEnd.RIGHT))
          throw new Error('unreviewed_scope');
        const content = { LEFT: [], RIGHT: [] };
        let oldN = 0, newN = 0;
        while (oldN < leftCount || newN < rightCount) {
          const row = lines[++i];
          if (row === '\\ No newline at end of file') continue;
          if (typeof row !== 'string' || ![' ', '+', '-'].includes(row[0])) throw new Error('unreviewed_scope');
          if (row[0] !== '+') { content.LEFT.push(row.slice(1)); oldN++; }
          if (row[0] !== '-') { content.RIGHT.push(row.slice(1)); newN++; }
          if (oldN > leftCount || newN > rightCount) throw new Error('unreviewed_scope');
        }
        for (const [side, start, count, revisionOid] of [
          ['LEFT', left, leftCount, snapshot.baseOid], ['RIGHT', right, rightCount, snapshot.headOid],
        ]) {
          if (!count) continue;
          // F225: the id is assigned once every block is parsed, from the source's own content.
          sources.push({ path: current.path, side, startLine: start, endLine: start + count - 1,
            revisionOid, text: content[side].join('\n') });
          lastEnd[side] = start + count - 1;
        }
        continue;
      }
      // Only known Git metadata may occur outside a hunk. Ignoring arbitrary tails used to
      // certify a patch ending in a truncation notice or an unfinished next-file header.
      if (line !== '' && line !== '\\ No newline at end of file'
          && !/^index [a-f0-9]+\.\.[a-f0-9]+(?: [0-7]{6})?$/.test(line)
          && !/^(?:new file mode|deleted file mode|old mode|new mode) [0-7]{6}$/.test(line)
          && !/^(?:similarity|dissimilarity) index \d+%$/.test(line)
          && !/^(?:rename|copy) (?:from|to) .+$/.test(line)) clean = false;
    }
    // Neither a stray line outside a hunk nor a header that never reached its +++ line is a
    // defect in any file's own hunks (F60), so neither costs a file its sources — but the patch
    // as a whole did not parse cleanly, and says so.
    if (pendingFile) clean = false;
    return { sources, clean };
  };

  // F87: one try/catch around the whole patch meant the first structurally invalid hunk
  // aborted every file after it, and left the bad file's earlier hunks behind as though they
  // were sound. Each block is now parsed on its own. A block that fails costs exactly the file
  // it names — declared `diff_unparsed` below, with no sources at all — and parsing continues
  // with the next block. A block no file can be attributed to names nothing; either way
  // `parsed` goes false, so a malformed patch can never certify `complete`.
  const known = new Set(files.map((f) => f.path));
  const unparsed = new Set();
  let valid = true;
  for (const section of diffSections(diff)) {
    const found = new Set();
    try {
      const { sources, clean } = parseBlock(section.split('\n'), found);
      if (!clean) valid = false;
      snapshot.sources.push(...sources);
      for (const path of found) seen.add(path);
    } catch {
      valid = false;
      for (const path of found) unparsed.add(path);
      const named = section.startsWith('diff --git ') ? blockPath(section) : null;
      if (named !== null && known.has(named)) unparsed.add(named);
    }
  }
  // F225: content ids. Identical blocks are one; a file whose block shares an id with a different
  // block keeps no source at all, like a file whose block did not parse.
  const identified = identifySources(snapshot.sources);
  snapshot.sources = identified.sources;
  for (const path of identified.collided) { unparsed.add(path); valid = false; }
  // Bytes beside a hunk that did not parse are not trustworthy because they decoded: a file
  // with any failed block keeps no sources, so nothing can quote or anchor in it.
  if (unparsed.size) snapshot.sources = snapshot.sources.filter((s) => !unparsed.has(s.path));
  // `parsed` is the narrower fact coverage still depends on: the supplied patch decoded cleanly
  // and every named file was located in it. A patch that did not parse may have placed the wrong
  // bytes, so no amount of placement can make that review complete. `complete` keeps its own
  // meaning — every file supplied whole — but no longer decides eligibility or coverage (F24).
  snapshot.parsed = valid && seen.size === files.length;
  snapshot.complete = snapshot.parsed
    && files.every((f) => snapshot.sources.some((s) => s.path === f.path)
      && f.change !== 'binary' && f.contentState === 'complete')
    && pr.enumeration === 'complete';

  // W3-4 / F24. A file nobody can read is declared, never reviewed and never anchored. Binary
  // files have no hunks at all; a file the redactor withheld or the reader could not supply
  // completely has no trustworthy hunks; a file with no block in the supplied patch was not
  // supplied; a file whose block did not parse has no hunks anyone can trust (F87).
  // `snapshot.complete` keeps its old meaning and no longer gates eligibility.
  const blocks = diffBlocks(snapshot.diff, files);
  snapshot.blocks = files.filter((f) => blocks.has(f.path)).map((f) => blocks.get(f.path));
  for (const file of files) {
    const retained = snapshot.sources.filter((source) => source.path === file.path);
    const partial = file.contentState === 'partial' && retained.length > 0
      && validWithheldHunks(file, retained);
    const contradictory = (file.contentState === 'complete' && file.withheldHunks !== undefined
      && (file.withheldHunks === null || !Array.isArray(file.withheldHunks)
        || file.withheldHunks.length > 0))
      || (file.contentState === 'partial' && retained.length > 0 && !partial);
    const reason = file.change === 'binary' ? 'binary'
      : unparsed.has(file.path) ? 'diff_unparsed'
        : contradictory || !blocks.has(file.path)
          || (file.contentState !== 'complete' && !partial) ? 'withheld' : null;
    if (reason) snapshot.unreviewable.push({ path: file.path, reason });
  }
  if (snapshot.unreviewable.length) {
    const blocked = new Set(snapshot.unreviewable.map((entry) => entry.path));
    snapshot.sources = snapshot.sources.filter((source) => !blocked.has(source.path));
  }
  snapshot.complete = snapshot.complete && snapshot.unreviewable.length === 0;
  return deepFreeze(snapshot);
}

/** RV-04: an entire range must occupy one actual hunk on the requested side. */
export function validateAnchor(snapshot, anchor) {
  if (anchor === null) return true;
  if (!plain(anchor) || Object.keys(anchor).some((k) => !['path', 'side', 'startLine', 'endLine'].includes(k))
      || !['LEFT', 'RIGHT'].includes(anchor.side) || !Number.isSafeInteger(anchor.startLine)
      || !Number.isSafeInteger(anchor.endLine) || anchor.startLine < 1 || anchor.endLine < anchor.startLine)
    return false;
  // W3-4: a file that was never reviewable cannot host a finding. Its hunks reach no prompt, so
  // an anchor in it points at code this review did not read.
  if ((snapshot.unreviewable ?? []).some((u) => u.path === anchor.path)) return false;
  const file = snapshot.files.find((entry) => entry.path === anchor.path);
  if (Array.isArray(file?.withheldHunks) && file.withheldHunks.some((hunk) =>
    validHunkRange(hunk) && intersectsWithheld({ ...anchor, startLine: anchor.startLine,
      endLine: anchor.endLine }, hunk))) return false;
  return snapshot.sources.some((s) => s.path === anchor.path && s.side === anchor.side
    && anchor.startLine >= s.startLine && anchor.endLine <= s.endLine);
}

// W3f-2 / F225. A request no longer shows any revision: a frozen source's id names its block, and
// the block's side names its revision in this snapshot. So a code receipt is not asked to carry
// one — code reads it from the source. A receipt that does carry one must carry the source's own:
// a revision the source does not have is a claim about other code, and is still refused.
const revisionHolds = (receipt, source) => receipt.revisionOid === undefined || receipt.revisionOid === source.revisionOid;

/** The candidate with every frozen code receipt bound to its source's revision, as code read it. */
function withFrozenRevisions(candidate, snapshot) {
  const sourceOf = (receipt) => snapshot.sources.find((s) => s.eventId === receipt?.eventId);
  if (!Array.isArray(candidate?.receipts) || !candidate.receipts.some(sourceOf)) return candidate;
  return { ...candidate, receipts: candidate.receipts.map((receipt) => {
    const source = sourceOf(receipt);
    return source ? { ...receipt, revisionOid: source.revisionOid } : receipt;
  }) };
}

/** The fields a joint finding may carry: the seven every finding has, and (M33 brittleness M4) a session finding's
 *  optional disclosure. */
const FINDING_FIELDS = Object.freeze(['origin', 'kind', 'title', 'explanation', 'scope', 'anchor', 'receipts']);
const fieldsOf = (origin) => (origin === 'session-review' ? [...FINDING_FIELDS, 'disclosedBy'] : FINDING_FIELDS);

/** M33 brittleness M4: a joint session finding as its own challenge item shows it — without its proposed disclosure,
 *  which is judged as an item of its own; a finding that carries none is shown exactly as proposed. */
const withoutDisclosure = (candidate) => {
  if (!plain(candidate) || !Object.hasOwn(candidate, 'disclosedBy')) return candidate;
  const { disclosedBy: _judgedApart, ...finding } = candidate;
  return finding;
};

function candidateReason(candidate, origin, snapshot) {
  const schema = CODE_REVIEW_SCHEMA.properties[origin === 'code-review' ? 'codeFindings' : 'sessionFindings'].items;
  if (!plain(candidate) || !matches(candidate, schema) || hasRating(candidate)
      || Object.keys(candidate).some((k) => !fieldsOf(origin).includes(k))
      || candidate.origin !== origin || !text(candidate.title, 160) || !text(candidate.explanation, 4000)
      || !['current-code', 'session-effect'].includes(candidate.scope)
      || !Object.hasOwn(candidate, 'anchor') || !Array.isArray(candidate.receipts)
      || (origin === 'code-review' && (candidate.kind !== 'code_issue' || candidate.scope !== 'current-code'))
      || (origin === 'session-review' && !['edit_under_negative_requirement', 'claim_contradicted'].includes(candidate.kind)))
    return 'kind_rejected';
  if ((candidate.scope === 'session-effect' && candidate.anchor !== null)
      || !validateAnchor(snapshot, candidate.anchor)) return 'relevance_unchecked';
  let frozenCode = false;
  let supportsAnchor = candidate.anchor === null;
  for (const receipt of candidate.receipts) {
    if (!plain(receipt) || Object.keys(receipt).some((k) => !['eventId', 'role', 'quote', 'revisionOid', 'sessionKey'].includes(k))
        || !text(receipt.quote, 400) || receipt.quote.trim().length < MIN_QUOTE_CHARS)
      return 'receipt_rejected';
    const source = snapshot.sources.find((s) => s.eventId === receipt.eventId);
    if (source) {
      if (receipt.role !== 'code' || !revisionHolds(receipt, source)
          || !source.text.includes(receipt.quote)) return 'receipt_rejected';
      frozenCode = true;
      // A valid line somewhere in the patch is not proof that THIS receipt belongs there (code-pass.js `quoteOverlaps`).
      if (candidate.anchor && source.path === candidate.anchor.path && source.side === candidate.anchor.side
        && quoteOverlaps(source, receipt.quote, candidate.anchor)) supportsAnchor = true;
    } else if (origin === 'code-review' && receipt.role === 'code') return 'relevance_unchecked';
  }
  if (!supportsAnchor) return 'relevance_unchecked';
  // W3d-4: withheld, and said to be withheld for exactly this — no frozen code behind a claim
  // about the current code — rather than for a quote that did not match.
  return candidate.scope === 'current-code' && !frozenCode ? { reason: 'receipt_rejected', cause: 'no_frozen_code' } : null;
}

// W3d-4. Effects the record states as not having happened (D98, F9: session.js `effectOf`; refused before it ran, or a
// direct write that failed or was cancelled), and the one that proves it did. Anything else — `unknown` — is an outcome
// the record does not contain: a command that failed or was cancelled among them, since it may have changed a file
// before it ended (C-02, D80).
const [NO_EFFECT, UNDONE_EFFECT, LANDED_EFFECT] = ACTION_EFFECTS;
const OUTCOME_FAILED = Object.freeze([NO_EFFECT, UNDONE_EFFECT]);

/**
 * One reviewer, one result: existing session narrative plus grounded code candidates.
 * judge is the same injected async ({system,prompt,schema,label}) interface as runReview.
 * Production CLI wiring is R6's responsibility; run-review.js remains R3-owned.
 */
export async function runCodeReview({ session = null, pr, diff = null, judge, challengeJudge = judge,
  onProgress = () => {} }) {
  const frozenPr = pr == null ? null : structuredClone(pr);
  const snapshot = snapshotDiff({ pr: frozenPr, diff });
  const original = session ?? new Session({ sessionKey: 'no-session' });
  const resolver = sourceSession(original, snapshot);
  const codeFindingCandidates = [], codeFindings = [], sessionFindings = [];
  const rejectedCodeFindings = [], rejectedSessionFindings = [];
  // Counts-only funnel for the two direct finding arrays in the joint model response. A
  // repeated framing in another window/chunk is one proposal; receipt repair and challenge
  // replies are never new proposals. Malformed candidates without a usable claim identity
  // remain separate occurrences rather than accidentally collapsing together.
  const proposalStages = { code: new Map(), session: new Map() };
  const proposalKey = (candidate) => plain(candidate)
    && ['kind', 'title', 'explanation', 'scope'].every((key) => typeof candidate[key] === 'string')
    ? JSON.stringify([candidate.kind, candidate.title, candidate.explanation, candidate.scope, candidate.anchor])
    : Symbol('malformed-finding');
  const stageFor = (origin, candidate) => {
    const stages = proposalStages[origin];
    const key = proposalKey(candidate);
    if (!stages.has(key)) stages.set(key, { evaluated: false, eligible: false,
      voted: false, challengeComplete: false, survived: false, grounded: false });
    return stages.get(key);
  };
  // W3d-4: findings withheld because a write they rest on has no recorded outcome.
  const outcomeUnknown = { findings: 0, writes: new Set() };
  // Irrecoverable code-review failures. A failed or malformed request is counted in the
  // attempt totals, but its file-level shortfall can be repaired by a later valid review of
  // those same frozen hunks. A foreign claim or an unrun challenge cannot be repaired that way.
  const failures = new Set();
  const seenCode = new Set(), seenSession = new Set();
  // F187: receipts `groundFinding` repaired, per finding `ground` kept (its id, first seen).
  const repairedOf = new Map();
  // A file is placed only when a request both carried its frozen hunks and the response
  // acknowledged that same file. The acknowledgement is downgrade-only: it cannot add a path
  // the code did not send, and an omission is eligible for one bounded code-only retry.
  const placed = new Set();
  const narrativeShown = new Set();
  let attemptedCalls = 0, usableResults = 0;
  let windowRequests = 0, chunkRequests = 0, overBudgetRequests = 0;
  let rejectedNarrative = 0;
  // M33 (C-06 "M33 per-part verdicts"): which narrative window each rejected proposal came from, so it
  // limits only that window's parts; one from a request that is no narrative window (a code-only chunk)
  // is counted apart and limits every part.
  const rejectedNarrativeWindows = new Set();
  let rejectedNarrativeUnplaced = 0;
  const codeChallenges = [];
  // M33 brittleness M4: each disclosure run's record, and what became of every proposed disclosure of a joint edit
  // finding that survived its own challenge — the closed code reason it was not asked, or how its challenge ended.
  const disclosureChallenges = [];
  const disclosures = disclosureCounts();
  // F24: one withheld hunk, one binary file or one partial file used to switch the code review
  // off for EVERY file. Eligibility now asks only whether there is something readable to read.
  // An over-budget file stays eligible: it is reviewable code this transport could not carry,
  // not code nobody can read, and the run still declares it.
  const excluded = new Set(snapshot.unreviewable.map((entry) => entry.path));
  const eligible = typeof judge === 'function' && snapshot.files.some((f) =>
    f.change !== 'binary' && !excluded.has(f.path)
    && snapshot.sources.some((s) => s.path === f.path));

  /** `narrativeContract` (M33 C repair): the answer is to the session narrative request (no reviewable file), whose
   *  contract admits a claim's `supportedBy`; a joint answer's contract does not. */
  function narrativeOf(response, windowIndex = null, window = null, { narrativeContract = false } = {}) {
    if (!plain(response) || !['decisions', 'pivots', 'claims', 'requirements'].every((k) => Array.isArray(response[k]))) return null;
    const narrative = {};
    // Review-WP: what the request's window was shown, built only when a claim cites written code — the
    // same written-body test runReview applies with the window's own source map (`writtenChatClaim`).
    let shown;
    // M36 phase 2 review (c4): the map the window's request was built with when it is a planned one (what it SHOWED).
    const shownOf = () => (shown ??= Array.isArray(window?.events)
      ? plannedSourceMap(window) ?? windowSourceMap(original, window) : null);
    for (const key of ['decisions', 'pivots', 'claims', 'requirements']) {
      // Keep rejected proposals: runReview must see them to reject them itself, and a proposal it
      // cannot evaluate leaves its window incomplete. Filtered here, that window would look
      // complete — reported as covered, and its answer replayed (D60) where W3f-2 (F226) asks the
      // window again.
      narrative[key] = response[key];
      for (const item of response[key]) {
        // M33 (C-06 "M33 written statements"): a claim quoting what one of the agent's own writes
        // wrote, as its window was shown it, is a written statement runReview reclassifies, never a
        // narrative fault. Any other claim citing written code is one it cannot read.
        if (key === 'claims' && item?.stated?.role === 'code' && writtenChatClaim(item, original, shownOf())) continue;
        // M33 (C-06): a claim is read without its resolvedBy, exactly as runReview reads it; the
        // ledger judges the resolution alone, and a rated or malformed one is a malformed resolution
        // (H1b), never a rated claim. The closed schema is checked first: it reads no deeper than the
        // contract, so `hasRating` only ever walks a value the contract admits and cannot overflow.
        // M33 C repair: an answer to the narrative request is read as its contract reads it — without its
        // supportedBy too (`claimBare`), which runReview judges on its own. The joint contract does not admit one.
        const read = key === 'claims' ? (narrativeContract ? claimBare(item) : claimCore(item)) : item;
        const valid = matches(read, CODE_REVIEW_SCHEMA.properties[key].items) && !hasRating(read);
        if (!valid) {
          rejectedNarrative++;
          if (Number.isSafeInteger(windowIndex) && windowIndex >= 0) rejectedNarrativeWindows.add(windowIndex);
          else rejectedNarrativeUnplaced++;
        }
      }
    }
    // M33 (C-06 "M33 written statements"): passed on unread. runReview reads each one; an unreadable one
    // is withheld and counted there and never makes the narrative, a window or the review incomplete.
    if (Object.hasOwn(response, WRITTEN_CHANNEL)) narrative[WRITTEN_CHANNEL] = response[WRITTEN_CHANNEL];
    return narrative;
  }

  function inspect(candidate, origin, suppliedIds = null, against = resolver) {
      // M33 brittleness M4: how a disclosure's own challenge ended is code's fact on the candidate, never a field of the
      // joint answer: the answer's contract is checked without it, and grounding reads it.
      const contract = plain(candidate) && Object.hasOwn(candidate, 'disclosureChallenge')
        ? (({ disclosureChallenge: _codeFact, ...answered }) => answered)(candidate) : candidate;
      const reason = candidateReason(contract, origin, snapshot);
      let result = reason ? { ok: false, ...(typeof reason === 'string' ? { reason } : reason) } : null;
      if (!result && suppliedIds && candidate.receipts.some((r) =>
        !snapshot.sources.some((s) => s.eventId === r.eventId) && !suppliedIds.has(r.eventId)))
        result = { ok: false, reason: 'receipt_rejected' };
      if (!result && candidate.kind === 'edit_under_negative_requirement') {
        const actions = candidate.receipts.filter((r) => r.role === 'action').map((r) => original.event(r.eventId));
        // W3d-4 (D58). Every cited edit must be recorded as having happened. One the record says
        // failed never landed: the check ran, and the finding is withheld (`action_failed`). One whose
        // outcome the record does not contain is different — whether it happened is absent evidence,
        // so the finding is withheld AND the session capped (`outcomeUnknown`, declared as a
        // `write_outcome_unknown` gap by `ground`). Unknown is checked first: a finding that may
        // rest on an unrecorded write caps even when another write it cites failed.
        // An inferred shell write is a separate action from its enclosing process. Only a
        // parser-proved single direct-write command with a unique typed zero exit proves it
        // succeeded. A nonzero or compound process can have changed the file before a later
        // failure, so it cannot suppress a finding as a proved failed write.
        const effect = effectReader(original);
        const outcome = (a) => effect(a);
        const unknown = actions.filter((a) => a && outcome(a) !== LANDED_EFFECT && !OUTCOME_FAILED.includes(outcome(a)));
        if (!actions.length) result = { ok: false, reason: 'receipt_rejected', cause: 'role_missing' };
        else if (actions.some((a) => !a)) result = { ok: false, reason: 'receipt_rejected' };
        else if (unknown.length) result = { ok: false, reason: 'unreviewed_scope', outcomeUnknown: unknown.map((a) => a.id) };
        else if (actions.some((a) => outcome(a) !== LANDED_EFFECT))
          result = { ok: false, reason: 'receipt_rejected', cause: 'action_failed' };
      }
      if (!result) {
        try { result = groundFinding({ repo: frozenPr.repo, session: against, pr: frozenPr,
          candidate: withFrozenRevisions(candidate, snapshot) }); }
        catch { result = { ok: false, reason: 'kind_rejected' }; }
      }
      return result;
  }

  function ground(candidates, origin, suppliedIds = null, against = resolver) {
    const grounded = [];
    for (const candidate of candidates) {
      const rejected = origin === 'code-review' ? rejectedCodeFindings : rejectedSessionFindings;
      const result = inspect(candidate, origin, suppliedIds, against);
      // W3d-4: not a check that ran and was inconclusive — the record lacks what the check needs.
      // Rejected as a check that did not run (`unreviewed_scope`, which caps), counted once per
      // finding, and its writes declared below as absent evidence.
      if (!result.ok && Array.isArray(result.outcomeUnknown)) {
        outcomeUnknown.findings++;
        for (const id of result.outcomeUnknown) outcomeUnknown.writes.add(id);
        rejected.push({ reason: 'unreviewed_scope' });
        continue;
      }
      if (!result.ok) { rejected.push({ reason: result.reason, ...(result.cause ? { cause: result.cause } : {}) }); continue; }
      grounded.push(result.finding);
      const seen = origin === 'code-review' ? seenCode : seenSession;
      if (seen.has(result.finding.id)) continue;
      seen.add(result.finding.id);
      // F187: how many of this finding's receipts grounding snapped to the recorded text — the
      // finding kept, so a second offer of it adds nothing. Summed into the report's count below.
      repairedOf.set(result.finding.id, result.receiptsRepaired ?? 0);
      if (origin === 'code-review') { codeFindingCandidates.push(candidate); codeFindings.push(result.finding); }
      else sessionFindings.push(result.finding);
    }
    return grounded;
  }

  // D60 (W3f-1): every request is asked as it is. A reused window used to get a second prompt of its
  // own ("already checked … Do not re-extract"), so its code half was a new question on every
  // review; an answer is now reused only for the identical request, by the judge's caller.
  const combinedJudge = async ({ prompt, label, window, placing = [], codeOnly = false,
    manifestRendered = false }) => {
    attemptedCalls++;
    if (codeOnly) chunkRequests++; else windowRequests++;
    const suppliedIds = new Set([...(window?.events ?? []).map((e) => e.id),
      ...original.events.filter((e) => e.kind === 'instruction' && e.authority === 'human').map((e) => e.id)]);
    // M36 phase 2 review (critique c4; C-05 "M36 grounding per shown span"): a window request's joint answer grounds in
    // the session as that window showed it (its planned source map: a result's omitted middle, a cut, is not there), the
    // frozen code beside it; a code-only chunk shows every event whole, so it grounds in the session itself.
    // M36 phase 3 review (D68 K, c6): a window holding several sessions grounds a quote the same way — in a span of the
    // event its receipt cites, which names its session (session.js `verifyReceipt`).
    const shownMap = codeOnly ? null : plannedSourceMap(window);
    const against = shownMap ? sourceSession(shownSession(original, shownMap), snapshot) : resolver;
    if (!codeOnly) for (const path of placing) narrativeShown.add(path);
    const request = buildCodeReviewPrompt({ narrativePrompt: prompt, snapshot, placed: placing, manifestRendered });
    if (codeOnly) request.prompt += CHUNK_INSTRUCTION;
    let response;
    try {
      if (!requestFits(request)) {
        overBudgetRequests++;
        throw Object.assign(new Error('budget_exhausted'), { code: 'budget_exhausted' });
      }
      response = await judge({ ...request, label: `code+${label}` });
    }
    catch (error) {
      throw judgeFailure(error);
    }
    // Malformed code results cannot masquerade as an empty reviewed set. Preserve a usable
    // session narrative when only its code extension is missing, but never claim code CLEAN.
    // An unusable response can still contain candidate arrays. Preserve their count without
    // pretending the candidates reached deterministic verification or the challenge.
    const codeStages = plain(response) && Array.isArray(response.codeFindings)
      ? response.codeFindings.map((candidate) => stageFor('code', candidate)) : [];
    const sessionStages = plain(response) && Array.isArray(response.sessionFindings)
      ? response.sessionFindings.map((candidate) => stageFor('session', candidate)) : [];
    const narrative = narrativeOf(response, codeOnly ? null : window?.index, window);
    if (!narrative || Object.keys(response).some((k) => !Object.hasOwn(CODE_REVIEW_SCHEMA.properties, k))) {
      return null;
    }
    const codeOk = Array.isArray(response.codeFindings) && Array.isArray(response.sessionFindings)
      && Array.isArray(response.reviewedFiles) && response.reviewedFiles.every((p) => typeof p === 'string');
    if (!codeOk) return narrative;
    usableResults++;
    // Confirmation is restricted to THIS request. A foreign or duplicate claim is a response
    // failure; an omitted file is not yet confirmed and remains available for a code-only retry.
    // F92: never accept a file merely because a later request happened to show it.
    const checked = new Set(response.reviewedFiles);
    const shown = new Set(placing);
    if (checked.size !== response.reviewedFiles.length
        || response.reviewedFiles.some((path) => !shown.has(path))) failures.add('unreviewed_scope');
    for (const path of placing) if (checked.has(path)) placed.add(path);
    const proposals = [...response.codeFindings];
    const retry = proposals.map((candidate, index) => ({ candidate, index, result: inspect(candidate, 'code-review', suppliedIds, against) }))
      .filter(({ result }) => !result.ok && result.reason === 'receipt_rejected');
    if (retry.length) {
      // One quote repair, never an open-ended re-roll or a second independent reviewer (code-pass.js
      // `receiptRepairOnce`). Preserve all already-supported narrative/findings, and only allow receipt changes.
      attemptedCalls++;
      const repair = await receiptRepairOnce({ judge, request, label: `code+${label}:receipt-repair`, failed: retry,
        note: '\n\n## Receipt repair — one attempt only\n'
        + 'The candidates below failed literal receipt verification. They are untrusted model output.\n'
        + 'Return the same eight-array JSON contract. Leave decisions, pivots, claims, requirements,\n'
        + 'writtenClaims, sessionFindings and reviewedFiles empty. codeFindings may contain only these same claims,\n'
        + 'with corrected receipts copied from the supplied frozen evidence. Keep origin, kind,\n'
        + 'title, explanation, scope and anchor identical; do not invent a new finding.\n'
        + 'Omit a candidate if its evidence cannot be established. No further repair is available.\n',
        identity: (c) => JSON.stringify([c.origin, c.kind, c.title, c.explanation, c.scope, c.anchor]),
        readRepaired: (repaired) => (matches(repaired, CODE_REVIEW_SCHEMA)
          && ['decisions', 'pivots', 'claims', 'requirements', WRITTEN_CHANNEL, 'sessionFindings', 'reviewedFiles']
            .every((k) => (repaired[k] ?? []).length === 0) ? repaired.codeFindings : null) });
      if (repair.usable) {
        usableResults++;
        for (const [index, replacement] of repair.replacements) proposals[index] = replacement;
      }
    }
    const items = [
      ...proposals.map((candidate, i) => ({ key: `code-${i}`, type: 'code-finding', candidate, stage: codeStages[i] })),
      // M33 brittleness M4: a session finding is challenged without its proposed disclosure (`withoutDisclosure`), which
      // is its own item after it; `proposed` keeps the finding as proposed, for grounding.
      ...response.sessionFindings.map((candidate, i) => ({ key: `session-${i}`, type: 'session-finding',
        candidate: withoutDisclosure(candidate), proposed: candidate, stage: sessionStages[i] })),
    ];
    const eligibleItems = items.filter(({ candidate, proposed = candidate, type, stage }) => {
      stage.evaluated = true;
      const origin = type === 'code-finding' ? 'code-review' : 'session-review';
      // M33 C recheck 2 (C-06 "M33 claims are facts"): a joint contradicted claim is put to the challengers like a
      // narrative one; code withholds none as not a claim.
      if (inspect(proposed, origin, suppliedIds, against).ok) return true;
      ground([proposed], origin, suppliedIds, against); // Count deterministic failures without spending challenge calls.
      return false;
    });
    for (const item of eligibleItems) item.stage.eligible = true;
    // M33 G4: what this request supplied of the session, by event and role — the same role-bearing
    // shape a window's source map has (`buildNarrativePrompt`), for exactly the session ids a joint
    // receipt may cite (`suppliedIds`). Frozen code sources are not in it; they are checked apart.
    const suppliedSources = Object.create(null);
    for (const id of suppliedIds) {
      const event = original.event(id);
      if (event) suppliedSources[id] = against.sourcesFor(event).map(({ role, text }) => ({ role, text }));
    }
    // M33 C repair (C-05 "M33 vote binding"): a joint `claim_contradicted` session finding is publication-bound
    // like a narrative one — event level only (`bindingsFor`); a code finding is not bound. (M33 C event binding: the
    // misfiled-vote reading of M33 C recheck 2, which gave a code finding the events it cites as its evidence, is
    // gone. A swap between a code finding and a session finding is an accepted risk, C-05.)
    let bindings = new Map();
    try { bindings = bindingsFor(original, eligibleItems); } catch { bindings = null; }
    const challenge = await challengeItems({ items: eligibleItems, judge: challengeJudge,
      evidence: request.evidencePrompt, labelPrefix: `challenge:${label}:joint`,
      supportEvents: (item) => (bindings === null ? (item.type === 'session-finding' ? () => false : null)
        : bindings.get(item.key) ?? null),
      verifyReceipt: (receipt) => {
        const source = snapshot.sources.find((s) => s.eventId === receipt?.eventId);
        if (source && (receipt.role !== 'code' || !revisionHolds(receipt, source))) return { ok: false };
        if (!source && !suppliedIds.has(receipt?.eventId)) return { ok: false };
        // M33 G4: a session event this request supplied, cited under a role it was not shown with.
        // The one typed re-route a window's challenge gives (`resultReceiptRepair`): an action's id
        // cited for its one supplied result moves to that result; anything else stays rejected.
        if (!source && !(suppliedSources[receipt.eventId] ?? []).some((s) => s.role === receipt.role))
          return resultReceiptRepair(original, suppliedSources, receipt) ?? { ok: false };
        // W3d-1: the same one repair grounding gives a receipt — never its role or revision.
        // F225: a frozen code receipt is read at its source's revision, which code supplies.
        return repairReceipt(against, source ? { ...receipt, revisionOid: source.revisionOid } : receipt);
      } });
    // M33 H repair (C-06 "M33 helper-internal claims"): code's mark on each joint contradiction whose statement is a
    // helper's own, read from the recording now, so a report saved without it reads the same (`markHelperStatements`).
    codeChallenges.push(markHelperStatements(original, challenge));
    const challenged = new Map(challenge.results.map((result) => [result.key, result]));
    for (const item of eligibleItems) {
      const result = challenged.get(item.key);
      item.stage.voted ||= result?.votes?.some((vote) => vote.answered === true) === true;
      item.stage.challengeComplete ||= result?.executionComplete === true;
    }
    // D58: only an item whose challenge did not RUN is unreviewed scope. One the challengers voted
    // on and could not settle is withheld — never grounded, never published — and counted by its
    // challenge (`unsettledItems`), not rejected as unchecked.
    for (const rejected of challenge.rejected.filter((item) => item.resolved !== true && item.executionComplete !== true)) {
      (rejected.type === 'code-finding' ? rejectedCodeFindings : rejectedSessionFindings).push({ reason: 'unreviewed_scope' });
    }
    if (!challenge.complete) failures.add('unreviewed_scope');
    // M33 brittleness M4: a surviving edit finding's proposed disclosure, put to the challengers as its own item when it
    // passed every code check; its outcome rides on the finding as code recorded it (`disclosureChallenge`).
    const outcomes = await challengeDisclosures(challenge.survivors, { request, label, suppliedIds, suppliedSources, against });
    for (const item of challenge.survivors) {
      item.stage.survived = true;
      const origin = item.type === 'code-finding' ? 'code-review' : 'session-review';
      const proposed = item.proposed ?? item.candidate;
      const candidate = outcomes.has(item.key) ? { ...proposed, disclosureChallenge: outcomes.get(item.key) } : proposed;
      if (ground([candidate], origin, suppliedIds, against).length) item.stage.grounded = true;
    }
    return narrative;
  };

  /**
   * M33 brittleness M4: the disclosure run of one joint request — the one disclosure step both routes share (owner
   * decision 2026-10-06; challenge.js `disclosureAsks`, `disclosureOutcomes`). Every surviving session finding that
   * proposes a disclosure is checked by code first, with this route's fact of whether its statement was supplied to this
   * request; one that passed is asked as its own item (challenge.js `disclosureItem`) in a three-pass run of its own,
   * bound to the statement's event. Returns each challenged item's outcome by its finding's key; every proposal is
   * counted (`disclosures`). A run that does not complete leaves its findings DECIDE (`unexecuted`), never unreviewed:
   * the finding itself was judged.
   */
  async function challengeDisclosures(survivors, { request, label, suppliedIds, suppliedSources, against = resolver }) {
    const asked = disclosureAsks(survivors.filter((item) => item.type === 'session-finding' && plain(item.proposed))
      .map((item) => ({ key: item.key, candidate: item.proposed,
        supplied: plain(item.proposed.disclosedBy) && suppliedIds.has(item.proposed.disclosedBy.eventId) })),
    { repo: frozenPr?.repo, session: against, pr: frozenPr }, disclosures);
    if (!asked.length) return new Map();
    let run;
    try {
      run = await challengeItems({ items: asked, judge: challengeJudge, evidence: request.evidencePrompt,
        labelPrefix: `challenge:${label}:disclosure`, supportEvents: (item) => new Set([item.statement]),
        verifyReceipt: (receipt) => {
          const source = snapshot.sources.find((s) => s.eventId === receipt?.eventId);
          if (source && (receipt.role !== 'code' || !revisionHolds(receipt, source))) return { ok: false };
          if (!source && !suppliedIds.has(receipt?.eventId)) return { ok: false };
          if (!source && !(suppliedSources[receipt.eventId] ?? []).some((s) => s.role === receipt.role))
            return resultReceiptRepair(original, suppliedSources, receipt) ?? { ok: false };
          return repairReceipt(against, source ? { ...receipt, revisionOid: source.revisionOid } : receipt);
        } });
    } catch { run = null; }
    if (run) disclosureChallenges.push(run);
    return disclosureOutcomes(asked, run?.results, disclosures);
  }

  // ---- what each request is allowed to carry (F30) -----------------------------------------
  // A chunk call carries no window's session narrative, so it has the largest allowance of any
  // request this run makes. That is the allowance a single file must fit inside to be reviewable
  // at all: a file bigger than it is declared, never summarised and never clipped to fit.
  // M35 (windowing): a code-only chunk is no session's window — no segment, no piece, no carried context; its events
  // are shown whole (`buildNarrativePrompt` with no settings), as always.
  const chunkWindow = (index, events = []) => ({ index, events, session: null, segments: [], piece: null, repeats: null,
    activeTask: null, workBytes: 0, oversize: false, fromSequence: null, untilSequence: null });
  // The manifest prints FILE_STATES[reason], so a reason with no state word there would print
  // `undefined` into the prompt. Every reason `fileReview` assigns has one now (F105 added
  // `diff_unparsed`); a reason outside FILE_STATES still falls back to the generic withheld state
  // — it IS withheld from every request, and "not reviewable" is what the model must know. The
  // declaration, the gap note and the window records keep the exact reason either way.
  const forManifest = (list) => list.map((row) => row.reason == null || Object.hasOwn(FILE_STATES, row.reason)
    ? row : { ...row, reason: 'withheld' });
  // Every file in its longest possible manifest state, so a probe is never an under-estimate.
  // F152: and the widest rows of them, since a manifest now lists its shown files first.
  const widest = forManifest(fileReview(snapshot, MAX_REVIEW_INPUT_BYTES)
    .map((row) => ({ ...row, reason: row.reason ?? 'oversize' })));
  const probeManifest = widestManifest(widest);
  // Every narrative measured here carries the rendered probe manifest, and says so (F153).
  const overheadOf = (narrativePrompt, extra = 0) =>
    reviewInputBytes(buildCodeReviewPrompt({ narrativePrompt, snapshot, placed: [], manifestRendered: true }))
      + extra + BUDGET_RESERVE;
  const chunkBudget = Math.max(0, MAX_REVIEW_INPUT_BYTES - overheadOf(
    buildNarrativePrompt({ session: original, window: chunkWindow(0), hunks: '', manifest: probeManifest }).prompt,
    Buffer.byteLength(CHUNK_INSTRUCTION, 'utf8')));
  // One reviewability verdict per changed file, shared by every request and by the declaration.
  const rows = fileReview(snapshot, chunkBudget);
  const manifestRows = forManifest(rows);
  const reasonOf = new Map(rows.map((row) => [row.path, row.reason]));
  const reviewable = rows.filter((row) => !row.reason);
  const unreviewable = rows.filter((row) => row.reason);

  const windowPlacement = new Map();
  const windowDiffFor = ({ window, build }) => {
    const budget = Math.max(0, MAX_REVIEW_INPUT_BYTES
      - overheadOf(build({ diff: null, hunks: '', manifest: probeManifest }).prompt));
    const slice = windowDiff(window, original, snapshot, budget, manifestRows);
    slice.omitted = slice.omitted.map((o) => ({ ...o, reason: reasonOf.get(o.path) ?? o.reason }));
    // F153: whether this window's narrative was given a rendered manifest travels with its
    // placement to the request builder — a fact about what this code built, not a text search.
    windowPlacement.set(window.index, { placed: slice.placed, manifestRendered: typeof slice.manifest === 'string' });
    return slice;
  };
  const placing = (window) => windowPlacement.get(window?.index)?.placed ?? [];
  const rendered = (window) => windowPlacement.get(window?.index)?.manifestRendered === true;

  let report;
  if (original.events.length) {
    // The legacy prompt renderer supplies the exact session/carry text, not its obsolete task.
    report = await runReview({ session: original, pr: frozenPr, diff: null,
      challengeJudge, windowDiffFor: eligible ? windowDiffFor : null,
      judge: eligible ? (request) => combinedJudge({ ...request, placing: placing(request.window),
        manifestRendered: rendered(request.window) })
        : async (request) => {
          if (typeof judge !== 'function') return null;
          try {
            const response = await judge(request);
            // M33 I1: this request carries the narrative contract, closed at its top level, and is read
            // as a session review reads it: an answer with a member the contract does not declare is
            // passed on as it came, so its window fails as `narrative:schema`. It used to be read with
            // that member dropped — an answer the D60 store does not keep, so the next review asked again.
            if (plain(response) && Object.keys(response).some((key) => !Object.hasOwn(NARRATIVE_SCHEMA.properties, key)))
              return response;
            return narrativeOf(response, request.window?.index, request.window, { narrativeContract: true });
          }
          catch (error) { throw judgeFailure(error); }
        }, onProgress });
  } else {
    report = buildLedger({ repo: frozenPr?.repo ?? { host: 'github.com', id: '0' }, session: original, pr: frozenPr });
  }

  // ---- the chunk pass: every reviewable file is read at least once ---------------------------
  // A file no window's request carried is reviewed in a code-only call, together with the
  // recorded invocations that touched it. Chunks are filled with WHOLE files, in `pr.files`
  // order, until the next file would not fit.
  if (eligible) {
    const byPath = new Map(rows.map((row) => [row.path, row]));
    const contextEvents = (paths) => {
      const wanted = new Set(paths);
      const events = [];
      for (const event of original.events) {
        if (event.kind !== 'invocation') continue;
        const named = [...(event.paths ?? []).map((p) => p?.path), ...(event.changes ?? []).map((c) => c?.path)];
        if (!named.some((p) => typeof p === 'string' && wanted.has(p.startsWith('./') ? p.slice(2) : p))) continue;
        events.push(event);
        const observation = original.observationFor(event.id);
        if (observation) events.push(observation);
      }
      return events;
    };
    const chunkNarrative = (paths, index, events = contextEvents(paths)) => buildNarrativePrompt({ session: original,
      window: chunkWindow(index, events),
      hunks: renderHunks(snapshot, paths), manifest: renderManifest(manifestRows, new Set(paths)),
      throughSessionEnd: true }).prompt;
    const chunkFits = (paths, index, events = contextEvents(paths)) => {
      const request = buildCodeReviewPrompt({ narrativePrompt: chunkNarrative(paths, index, events), snapshot, placed: paths,
        manifestRendered: true });
      request.prompt += CHUNK_INSTRUCTION;
      return requestFits(request);
    };

    const queue = reviewable.filter((row) => !placed.has(row.path)).map((row) => row.path);
    const chunkRetried = new Set();
    const windowCount = report.windowResults?.length ?? 0;
    for (let index = 0; queue.length; index++) {
      let take = 1, spent = byPath.get(queue[0]).bytes;
      while (take < queue.length && spent + byPath.get(queue[take]).bytes <= chunkBudget)
        spent += byPath.get(queue[take++]).bytes;
      // The session context a chunk carries is not in that estimate, so shrink until it fits.
      while (take > 1 && !chunkFits(queue.slice(0, take), windowCount + index)) take--;
      const paths = queue.splice(0, take);
      const context = contextEvents(paths);
      // The invocation/result pair is optional context for this code-only pass. A single
      // otherwise-reviewable whole file must not go unread solely because that context is too
      // large. The separate session window keeps its own budget shortfall; the code request
      // still carries the entire frozen file and all human instructions.
      const events = paths.length === 1 && !chunkFits(paths, windowCount + index, context) ? [] : context;
      const prompt = chunkNarrative(paths, windowCount + index, events);
      try {
        await combinedJudge({ prompt, label: `chunk:${index + 1}`,
          window: chunkWindow(windowCount + index, events), placing: paths, codeOnly: true,
          manifestRendered: true });
      } catch { /* Recorded in `failures`; an unanswered chunk never becomes placement. */ }
      // A file first encountered in this code-only pass gets one more attempt if the answer
      // omitted it. A file a narrative request already showed has used this pass as its retry.
      for (const path of paths) if (!placed.has(path) && !narrativeShown.has(path)
          && !chunkRetried.has(path)) { chunkRetried.add(path); queue.push(path); }
    }
  }

  if (reviewable.some((row) => !placed.has(row.path))) failures.add('unreviewed_scope');
  // Coverage requires both frozen placement and a same-request acknowledgement. The model
  // cannot add a foreign path, and a missing acknowledgement cannot silently become CLEAN.
  // `snapshot.complete` keeps its meaning — every file supplied whole — but no longer decides
  // this: a review that read 49 of 50 files read 49 files, and says so (F24, W3-1).
  const placedAll = snapshot.complete && frozenPr?.enumeration === 'complete' && snapshot.files.length > 0
    && snapshot.files.every((f) => placed.has(f.path));
  // D58 (W3d-3): a code finding whose quote did not match the frozen code is withheld and
  // counted; it does not cap. One no check could evaluate (malformed, anchored outside the PR) or
  // whose challenge never ran (`unreviewed_scope`) still does — the ledger's one rule.
  const codeCoverage = usableResults === 0 ? 'missing'
    : placedAll && failures.size === 0 && rejectedCodeFindings.every(withheldRejection)
      // A later same-file response may recover a failed or malformed earlier request.
      // The first attempt remains in attemptedCalls; completeness is about the final set
      // of verified file reviews and unresolved claims, not every transport attempt.
      ? 'complete' : 'partial';
  if (unreviewable.length || !snapshot.parsed || !eligible) failures.add('unreviewed_scope');
  // W3c-10 / F133. `runReview` reduced its report before this review placed anything, so every
  // unrecorded write inside the repository capped it there. The session's own reading is taken
  // from before that cap; `honestStatuses` below re-applies it with the placement this run
  // recorded, so a write whose file the code review read in the diff no longer caps. Every other
  // adapter gap still lowers the session here exactly as before.
  const read = coverageBeforeUnrecordedCap(report);
  // D58: a session finding withheld because its quote did not match, and a pivot or requirement a
  // window withheld the same way, ran and were inconclusive; they no longer lower the session. A
  // pivot or requirement that could not be evaluated, or whose challenge never ran, already left
  // its window incomplete, so `read` (runReview's own coverage) carries that cap.
  // W3d-4: a finding resting on a write with no recorded outcome is absent evidence, and caps.
  const sessionIncomplete = rejectedSessionFindings.some((r) => !withheldRejection(r)) || rejectedNarrative
    || original.adapterGaps?.some((gap) => gap?.code !== 'unrecorded_body') || outcomeUnknown.findings > 0;
  const coverage = sessionIncomplete && read === 'complete' ? 'partial' : read;
  // M33 (C-06): one identity can now be published FYI (a verified self-correction) by the session
  // review and DECIDE by a direct session finding. Those are not dropped as one copy: both reach the
  // merge below, which never softens a DECIDE.
  const allSessionFindings = [...report.findings, ...sessionFindings]
    .filter((f, i, fs) => fs.findIndex((x) => x.id === f.id && x.status === f.status) === i);
  // The session's own coverage facts still describe the session, but the extra session findings
  // and rejections found here can only lower it. Record the downgrade as a declaration so the
  // final recomputation reduces from facts and a declaration, never from an absence.
  const facts = report.coverageFacts ? { ...report.coverageFacts, declared: coverage } : null;
  // W3-1. One declaration for everything this review could not read, with the counts that
  // say why. Unreviewable files are never reviewed and never finding-anchored, so the only
  // honest thing left to do with them is name them.
  // F106: under its own code. `source_clipped` says a recorder cut source text, which is false
  // here. Scoped to the PR, because it is a changed file of the PR that went unread — so it caps
  // the code review and leaves a fully-read session alone (F116).
  const gaps = [...(report.gaps ?? [])];
  const omittedHunks = snapshot.files.filter((file) => ['partial', 'unavailable'].includes(file.contentState)
    && (file.withheldHunks === null || Array.isArray(file.withheldHunks)
      && file.withheldHunks.length > 0));
  if (omittedHunks.length) {
    const known = omittedHunks.every((file) => Array.isArray(file.withheldHunks));
    gaps.push({ code: 'redacted_content', channel: 'code', scope: 'pr',
      count: known ? omittedHunks.reduce((n, file) => n + file.withheldHunks.length, 0) : null,
      note: known ? 'diff hunks were withheld by redaction' : 'diff extent was withheld by redaction' });
  }
  if (unreviewable.length) {
    const counted = UNREVIEWABLE_REASONS.map(([reason, words]) =>
      [unreviewable.filter((row) => row.reason === reason).length, words]).filter(([n]) => n > 0);
    // A reason outside the four is still a file that went unread; it is counted, never dropped.
    const other = unreviewable.length - counted.reduce((sum, [n]) => sum + n, 0);
    if (other > 0) counted.push([other, 'for another reason']);
    gaps.push({ code: 'code_unreviewable', channel: 'code', scope: 'pr', count: unreviewable.length,
      note: `${unreviewable.length} changed file(s) could not be reviewed: `
        + counted.map(([n, words]) => `${n} ${words}`).join(', ') });
  }
  // The adapter already declares every outcome-unknown write, whether or not the model noticed
  // it. Add the finding-specific writes to that same declaration; an ordinary synthetic Session
  // without an adapter declaration still gets a gap when a finding depends on one. This keeps
  // one evidence loss from being reported twice and never turns an absent finding into CLEAN.
  if (outcomeUnknown.findings) {
    const writes = [...outcomeUnknown.writes].sort();
    const prior = gaps.findIndex((gap) => gap.code === 'write_outcome_unknown'
      && gap.channel === 'observations' && gap.scope === 'session');
    if (prior < 0) gaps.push({ code: 'write_outcome_unknown', channel: 'observations', scope: 'session', eventIds: writes,
      count: writes.length, note: `${outcomeUnknown.findings} finding(s) rest on these writes and were withheld` });
    else {
      const all = [...new Set([...(gaps[prior].eventIds ?? []), ...writes])].sort();
      gaps[prior] = { ...gaps[prior], eventIds: all, count: all.length,
        note: `the recording does not establish whether these attempted writes completed; ${outcomeUnknown.findings} finding(s) depending on them were withheld` };
    }
  }
  // F101: the published list is the MERGED one. The F93/F94 merge ran inside buildLedger only,
  // over the session findings runReview grounded; the code findings grounded here never met it,
  // so four framings of one defect were published as four. Merged after grounding, as buildLedger
  // does, and the statuses below are reduced from this list (F63), never from the inputs. The
  // count adds to runReview's: a finding merged there is gone from its list, so none counts twice.
  const { findings, merged } = mergeDuplicateFindings([...codeFindings, ...allSessionFindings],
    { sourcesOf: (eventId) => codeSourceTexts(resolver, eventId) });   // L5: the frozen diff sources and the session's
  const directFunnel = (stages) => {
    const entries = [...stages.values()];
    return { proposed: entries.length,
      responseUnusable: entries.filter((entry) => !entry.evaluated).length,
      deterministicRejected: entries.filter((entry) => entry.evaluated && !entry.eligible).length,
      challengeEligible: entries.filter((entry) => entry.eligible).length,
      challengeVoted: entries.filter((entry) => entry.voted).length,
      challengeComplete: entries.filter((entry) => entry.challengeComplete).length,
      challengeSurvived: entries.filter((entry) => entry.survived).length,
      grounded: entries.filter((entry) => entry.grounded).length };
  };
  // A contradicted claim is proposed through the narrative claim channel, not through
  // sessionFindings. Count that separate route from the challenge's original proposal records.
  // The final published list may merge these with direct findings, so publication is a separate
  // final-row count rather than an attributed per-route count.
  const narrativeClaims = new Map();
  for (const window of report.windowResults ?? []) {
    for (const item of window.challenge?.results ?? []) {
      if (item.type !== 'claim' || !item.candidate?.contradictedBy) continue;
      const key = JSON.stringify([item.candidate.text, item.candidate.stated, item.candidate.contradictedBy]);
      const prior = narrativeClaims.get(key) ?? { eligible: false, voted: false,
        challengeComplete: false, survived: false };
      prior.eligible ||= Array.isArray(item.votes) && item.votes.length > 0;
      prior.voted ||= item.votes?.some((vote) => vote.answered === true) === true;
      prior.challengeComplete ||= item.executionComplete === true;
      prior.survived ||= item.survived === true;
      narrativeClaims.set(key, prior);
    }
  }
  const claimStages = [...narrativeClaims.values()];
  const findingFunnel = {
    direct: { code: directFunnel(proposalStages.code), session: directFunnel(proposalStages.session) },
    narrativeContradictedClaims: { proposed: claimStages.length,
      challengeEligible: claimStages.filter((entry) => entry.eligible).length,
      challengeVoted: claimStages.filter((entry) => entry.voted).length,
      challengeComplete: claimStages.filter((entry) => entry.challengeComplete).length,
      challengeSurvived: claimStages.filter((entry) => entry.survived).length,
      grounded: report.findings.filter((finding) => finding.kind === 'claim_contradicted').length },
    final: { published: findings.length,
      code: findings.filter((finding) => finding.origin === 'code-review').length,
      session: findings.filter((finding) => finding.origin === 'session-review').length,
      merged: (report.counts?.findingsMerged ?? 0) + merged },
  };
  // D58: the session review's withheld counts, plus this review's own — a code or session finding
  // whose quote did not match, and an item its joint challenges voted on and could not settle.
  const unsettled = codeChallenges.reduce((n, c) => n + (Number.isSafeInteger(c.unsettledItems) ? c.unsettledItems : 0), 0);
  // W3d-4: and which of them failed a check more specific than a quote — this review's own, plus
  // any the session review declared (`runReview` declares a decision whose actors are ambiguous).
  const own = withheldCauseCounts([...rejectedCodeFindings, ...rejectedSessionFindings]);
  const declaredCause = (cause) => (Number.isSafeInteger(report.withheld?.causes?.[cause])
    && report.withheld.causes[cause] >= 0 ? report.withheld.causes[cause] : 0);
  // M33 (C-06 "M33 written statements"): the written statements the session review withheld, by their
  // own closed causes, carried over as it counted them; this review withholds none of its own.
  const withheld = {
    proposals: (report.withheld?.proposals ?? 0)
      + [...rejectedCodeFindings, ...rejectedSessionFindings].filter(withheldRejection).length,
    unsettled: (report.withheld?.unsettled ?? 0) + unsettled,
    ...declaredCauses(Object.fromEntries([...WITHHELD_REJECTION_CAUSES, ...WRITTEN_WITHHELD_CAUSES]
      .map((cause) => [cause, declaredCause(cause) + (own[cause] ?? 0)]))),
  };
  // F187: the receipts this review's grounding snapped, added once to the count the session review
  // kept — for the findings published from here. A session finding the session review had already
  // grounded is published as ITS copy (`allSessionFindings` keeps the first), counted there.
  const groundedBefore = new Set(report.findings.map((f) => f.id));
  const receiptsRepaired = [...codeFindings, ...sessionFindings].filter((f) => !groundedBefore.has(f.id))
    .reduce((n, f) => n + (repairedOf.get(f.id) ?? 0), 0);
  // C-06 (M33 G4): "on every route including the combined code review". A claim whose stated receipt
  // a surviving claim_contradicted finding cites is that finding, not also an open promise — applied
  // to the published list, after this review's own session findings joined it. Counted beside the
  // session review's own count, never silently dropped.
  const beside = Array.isArray(report.promises) ? promisesBesideFindings(report.promises, findings) : null;
  // M33 C recheck: and a promise in a statement a published contradiction cites — the joint channel's included — is
  // never `verified`; each one lowered here is counted as the session review counts its own (`contradicted`). M33 C
  // recheck 2: nor in the statement of a joint contradiction whose own check did not settle. M33 C event binding: by
  // the statement's event, never by word overlap (`unverifiedBesideFindings`).
  const jointUnsettled = unsettledContradictionStatements(original, codeChallenges)
    .map((stated) => ({ kind: 'claim_contradicted', receipts: [stated] }));
  const promised = beside
    ? { ...beside, ...unverifiedBesideFindings(original, beside.promises, [...findings, ...jointUnsettled]) } : null;
  const [, VERIFIED] = PROMISE_STATUSES, [CONTRADICTED_SUPPORT] = SUPPORT_REJECTIONS;
  const rejectedBefore = report.counts?.promiseSupport?.rejected?.[CONTRADICTED_SUPPORT];
  const promiseSupport = plain(report.counts?.promiseSupport) && promised?.lowered > 0
    ? { ...report.counts.promiseSupport,
      verified: promised.promises.filter((p) => p?.status === VERIFIED).length,
      rejected: { ...report.counts.promiseSupport.rejected,
        [CONTRADICTED_SUPPORT]: (Number.isSafeInteger(rejectedBefore) ? rejectedBefore : 0) + promised.lowered } }
    : null;
  const assembled = { ...report, coverage, coverageBeforeUnrecorded: coverage, codeCoverage, coverageFacts: facts, gaps,
    findings, findingFunnel, withheld,
    ...(promised ? { promises: promised.promises } : {}),
    codeFindingCandidates, rejectedCodeFindings, rejectedNarrative, codeChallenges,
    // M33 brittleness M4: present only when a joint edit finding proposed a disclosure, so no other report moves.
    ...(disclosures.proposed > 0 ? { disclosureChallenges } : {}),
    rejectedNarrativeWindows: [...rejectedNarrativeWindows].sort((a, b) => a - b), rejectedNarrativeUnplaced,
    rejectedFindings: [...report.rejectedFindings, ...rejectedSessionFindings],
    counts: { ...report.counts, rejectedFindings: report.rejectedFindings.length + rejectedSessionFindings.length,
      findingsMerged: (report.counts?.findingsMerged ?? 0) + merged,
      receiptsRepaired: (report.counts?.receiptsRepaired ?? 0) + receiptsRepaired,
      ...(promised ? { promisesAsFindings: (Number.isSafeInteger(report.counts?.promisesAsFindings)
        && report.counts.promisesAsFindings >= 0 ? report.counts.promisesAsFindings : 0) + promised.asFindings } : {}),
      ...(promiseSupport ? { promiseSupport } : {}),
      ...(disclosures.proposed > 0 ? { disclosures } : {}) },
    codeCoverageFacts: { placed: [...placed].sort(), snapshotFiles: snapshot.files.length,
      usableResults, attemptedCalls, windowRequests, chunkRequests, overBudgetRequests,
      unreviewable: unreviewable.map(({ path, reason, bytes }) => ({ path, reason, bytes })) },
    codeJudgment: { attemptedCalls, usableResults, rejectedItems: rejectedCodeFindings.length,
      reasons: [...new Set([...failures, ...rejectedCodeFindings.map((r) => r.reason)])].sort() },
    instrument: { ...report.instrument, codeReview: CODE_REVIEW_VERSION,
      baseOid: frozenPr?.baseOid ?? null, diffBaseOid: snapshot.baseOid, headOid: snapshot.headOid,
      challenge: CHALLENGE_PROFILE },
  };
  return Object.assign(assembled, honestStatuses(assembled));
}
