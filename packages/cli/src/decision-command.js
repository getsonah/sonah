// D69 f (g), the page review (2026-10-08): `sonah decision` records your answer to one decision of a session review —
// (D71 S4: to any row of its checklist the session page prints an id under: a decision, a finding, a claim, a
// statement written into a file, a requirement or a failure row; the closed refusal names below keep their words) —
// accept it, ask to change it, or ask for clarification, always with your reason — so a person who disagrees with a
// decision on the session page can say so somewhere. The page prints the command once, with the session's redacted
// hash (redact/index.js `sliceHash`) and ROW_ID, REPORT and YOUR REASON as the parts to replace, and under each row only
// the row's short id (sonah.session-page/14); the answer is shown under that row the next time the page is made
// (`sonah review --format html` reads it back).
//
//   sonah decision accept|change|clarify SESSION_HASH DECISION_ID --report FILE --reason TEXT
//
// The answer is appended to the same owner-only (0600) file every decision review uses (decision-reviews.js), keyed by
// the session hash and the full ledger decision id. DECISION_ID is the id the page prints (its first 12 hex digits) or
// the whole id; it is resolved against the report given, which must hold exactly one decision with it: an id the report
// does not hold is refused, never recorded. The command reads the report and nothing else, calls no model and sends
// nothing anywhere; what it prints is the verb and the short id, never the reason or any report text.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { strictJson } from '../../slicer/src/strict-json.js';
import { DECISION_REVIEW_VERBS, acceptableReason, recordDecisionReview } from './decision-reviews.js';
import { answerableRowIds, ROW_ID } from '../../evidence/src/checklist.js';

export const DECISION_COMMAND_USAGE = 'usage: sonah decision accept|change|clarify SESSION_HASH DECISION_ID --report FILE '
  + '--reason TEXT';
/** Why an answer was not recorded, a closed vocabulary: the report is not a readable review report; it holds no
 *  decision with that id, or more than one; the reason is empty, too long, or not trimmed; the file could not be
 *  written. */
export const DECISION_COMMAND_REFUSALS = Object.freeze(['report_unreadable', 'decision_not_in_report', 'decision_ambiguous',
  'reason_rejected', 'not_recorded']);
const [REPORT_UNREADABLE, NOT_IN_REPORT, AMBIGUOUS, REASON_REJECTED, NOT_RECORDED] = DECISION_COMMAND_REFUSALS;
const SESSION_HASH = /^[0-9a-f]{64}$/;
const DECISION_ID = ROW_ID;
/** An id as the page prints it (12 hex digits) or any longer prefix of the whole id, with or without `sha256:`. */
const ID_PREFIX = /^(?:sha256:)?[0-9a-f]{12,64}$/;
const usage = () => Object.assign(new Error('usage'), { code: 'usage' });

/** The command line after `decision`, or a `usage` error: a verb, a session hash, a decision id, then `--report` and
 *  `--reason`, each once with a value. Nothing else is accepted. */
export function parseDecisionArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 7) throw usage();
  const [verb, hash, id, ...flags] = argv;
  if (!DECISION_REVIEW_VERBS.includes(verb) || !SESSION_HASH.test(hash ?? '') || !ID_PREFIX.test(id ?? '')) throw usage();
  const values = {};
  for (let i = 0; i < flags.length; i += 2) {
    const name = { '--report': 'report', '--reason': 'reason' }[flags[i]];
    const value = flags[i + 1];
    if (!name || Object.hasOwn(values, name) || typeof value !== 'string' || !value.trim()) throw usage();
    values[name] = value;
  }
  if (!values.report || values.reason === undefined) throw usage();
  return { verb, hash, id: id.startsWith('sha256:') ? id : `sha256:${id}`, report: values.report, reason: values.reason.trim() };
}

/** The one row id in this report that starts with `prefix`, or a refusal. D71 (S4): every checklist row the session
 *  page prints an id under — a decision, a finding, a claim, a statement written into a file, and a checklist
 *  requirement or failure row by its computed id (checklist.js `answerableRowIds`) — not only a decision. */
export function resolveDecisionId(report, prefix) {
  const ids = answerableRowIds(report).filter((id) => DECISION_ID.test(id));
  const matches = ids.filter((id) => id.startsWith(prefix));
  if (matches.length === 1) return { id: matches[0] };
  return { refusal: matches.length ? AMBIGUOUS : NOT_IN_REPORT };
}

/**
 * Run `sonah decision`. Resolves the exit code: 0 recorded, 1 refused (a closed code on stderr), 2 usage, 3 the answer
 * could not be written. `write` and `error` are injectable for tests.
 */
export async function runDecisionCommand(argv, { write = (text) => process.stdout.write(text),
  error = (text) => process.stderr.write(text) } = {}) {
  let args;
  try { args = parseDecisionArgs(argv); } catch { error(`${DECISION_COMMAND_USAGE}\n`); return 2; }
  const refuse = (code) => { error(`sonah decision: ${code}\n`); return code === NOT_RECORDED ? 3 : 1; };
  let report;
  try {
    const parsed = strictJson(await readFile(resolve(args.report), 'utf8'));
    report = parsed.json && parsed.strict ? parsed.value : null;
  } catch { report = null; }
  if (report === null || typeof report !== 'object' || Array.isArray(report) || !Array.isArray(report.decisions))
    return refuse(REPORT_UNREADABLE);
  const found = resolveDecisionId(report, args.id);
  if (found.refusal) return refuse(found.refusal);
  if (!acceptableReason(args.reason)) return refuse(REASON_REJECTED);
  if (!await recordDecisionReview({ hash: args.hash, decisionId: found.id, verb: args.verb, reason: args.reason }))
    return refuse(NOT_RECORDED);
  write(`recorded: ${args.verb} ${found.id.slice('sha256:'.length, 'sha256:'.length + 12)}\n`);
  return 0;
}
