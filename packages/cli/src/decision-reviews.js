// Human dispositions belong to an individual grounded choice. A session-level verb, a model
// identifier or a changed choice must never carry an earlier acceptance onto a different one.
import { constants } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DIGEST_PATTERN } from '../../evidence/contracts/canonical.js';

export const DECISION_REVIEW_VERBS = Object.freeze(['accept', 'change', 'clarify']);
export const DECISION_REVIEW_REASON_LIMIT = 2000;
const HASH = /^[0-9a-f]{64}$/;
// D69 f (g): a ledger decision id (evidence/src/session.js `decisionIdentity`), the identity an M33 report's decision
// carries and the session page shows. A v2 record keys an answer by it, under the redacted session hash.
const DECISION_ID = DIGEST_PATTERN;
const HOME = () => process.env.SONAH_HOME ?? join(homedir(), '.sonah');
const FILE = () => join(HOME(), 'decision-reviews.ndjsonl');
/** A reason a record may carry: words, trimmed, at most the limit. D90 (owner decision 2026-10-15): it is kept as the
 *  person wrote it; nothing is refused for what a redactor would have masked. */
export function acceptableReason(reason) {
  return typeof reason === 'string' && reason.trim() === reason && reason.length > 0
    && reason.length <= DECISION_REVIEW_REASON_LIMIT;
}
/** v2 (D69 f (g)): an M33 report's decision by its ledger id. A v1 record (a legacy tree's choice by `decisionKey`) left
 *  by an older build is not valid here: it is neither written nor loaded. */
function validRecord(v) {
  if (v === null || typeof v !== 'object') return false;
  return v.v === 2 && DECISION_ID.test(v.decisionId ?? '') && v.decisionKey === undefined
    && HASH.test(v.hash ?? '') && DECISION_REVIEW_VERBS.includes(v.verb) && acceptableReason(v.reason)
    && typeof v.ts === 'string' && Number.isFinite(Date.parse(v.ts));
}
function ownedFile(stat) {
  return stat.isFile() && stat.nlink === 1 && (typeof process.getuid !== 'function' || stat.uid === process.getuid());
}

/** Append a reasoned disposition to a decision of an M33 report, by its ledger decision id (a v2 record). False means it
 *  was not stored; callers must leave it pending. */
export async function recordDecisionReview({ hash, decisionId, verb, reason } = {}) {
  if (typeof reason !== 'string') return false;
  const row = { v: 2, ts: new Date().toISOString(), hash, decisionId, verb, reason: reason.trim() };
  if (!validRecord(row)) return false;
  let file;
  try {
    await mkdir(HOME(), { recursive: true, mode: 0o700 });
    file = await open(FILE(), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
    if (!ownedFile(await file.stat())) return false;
    await file.chmod(0o600);
    await file.writeFile(JSON.stringify(row) + '\n', 'utf8');
    return true;
  } catch { return false; }
  finally { await file?.close(); }
}

/** Latest valid record by append order: Map<session hash, Map<decision id, record>>. */
export async function loadDecisionReviews() {
  const reviews = new Map();
  let file;
  try {
    file = await open(FILE(), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await file.stat();
    if (!ownedFile(stat) || (stat.mode & 0o077)) return reviews;
    const text = await file.readFile('utf8');
    for (const line of text.split('\n')) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (!validRecord(row)) continue;
      if (!reviews.has(row.hash)) reviews.set(row.hash, new Map());
      reviews.get(row.hash).set(row.decisionId, row);
    }
  } catch { /* missing or unreadable review history leaves choices pending */ }
  finally { await file?.close(); }
  return reviews;
}

/** D69 f (g): the latest answer to each decision of one session's M33 report (v2 records), as the session page takes
 *  them: ledger decision id -> `{ verb, reason }`. */
export function answersFor(hash, reviews = new Map()) {
  return new Map([...(reviews.get(hash) ?? new Map())].filter(([, row]) => row.v === 2 && row.hash === hash)
    .map(([id, row]) => [id, { verb: row.verb, reason: row.reason }]));
}
