// The audit of Sonah's absence sentences (D100; the owner's pick, 2026-10-17: "a product-wide audit of absence
// sentences"). A person read every fixed sentence of the word tables (the modules the style linter reads:
// style-lint.js `WORD_MODULE_DIRS`, `WORD_MODULES_NAMED`) and put each table key in one class:
//   absence  it states, as Sonah's own word, that the recording, the session or the code lacks something, or that
//            something did not happen or is not so. It stands only beside code that proves it (ABSENCE_REGISTRY), or,
//            for words a model request carries, it is held for the owner (ABSENCE_HELD).
//   sonah    it states what Sonah, its session review or its code review did not or could not read, find, check, keep,
//            show or run, or a negative judgment it says one of them made. Sonah's own record proves it.
//   other    it states no negative fact about the recording, the session or the code: a label, a heading, a count, a
//            positive fact, a contradiction that a recorded result shows, an instruction, the person's own machine.
// The class is decided by reading, never by a word of the sentence: no keyword or phrase rule is in code. The census
// keeps each key's class and a fingerprint of its rendered texts (every fixture of a function), so a sentence added or
// changed fails the audit until a person reads it again and records its class (absence-audit.test.js). Where no code
// proves an absence, the sentence says what Sonah found, holds or could not read instead.
//
// Pure data and pure helpers: no disk, clock, network or model. The test reads the files the proofs name.
import { createHash } from 'node:crypto';

/** The closed classes of the census. */
export const AUDIT_CLASSES = Object.freeze(['absence', 'sonah', 'other']);

/**
 * D100 (review of A1c): the closed reaches of an absence. A sentence claims that something is missing, or is not so,
 * over one reach; a proof's code checks over some. A sentence stands only on a proof that checks the reach its words
 * claim (`scope_unproved` otherwise), so a field that one record types never stands behind "the recording does not
 * show". Each reach names the kinds of proof (ABSENCE_PROOFS `kind`) whose code can check over it:
 *   call       one call, result, write or message: what its own record types or holds (a denial, a stop, a result of
 *              its own, a cut);
 *   recorder   what a recorder version marks at all;
 *   lineage    whose recording a row is in (a helper's, the main thread's);
 *   recording  every row of the recording's lineage: no row of it shows the thing (only a search of them checks it);
 *   code       the files and lines of the code that Sonah read, and the code review's trace;
 *   system     what the file system or git answered;
 *   judgment   a review model's judgment that code admits only after its quote grounds and its check holds;
 *   review     D115 (the owner: "for the hn5, start work now"): one published row of a review — what it cites as code
 *              kept it after its checks (its receipts and the kinds of text they name), and where the report model
 *              placed it. It says nothing of what the recording holds beyond that row.
 * The reach a sentence claims is read by a person, as its class is, and recorded beside each proof in
 * ABSENCE_REGISTRY; a sentence that changes fails the census until a person reads it, and its reach, again.
 */
export const ABSENCE_SCOPES = Object.freeze({ call: Object.freeze(['recorder']), recorder: Object.freeze(['recorder']),
  lineage: Object.freeze(['recorder']), recording: Object.freeze(['search']), code: Object.freeze(['search']),
  system: Object.freeze(['system']), judgment: Object.freeze(['gate']), review: Object.freeze(['report']) });

/**
 * The closed registry of proofs: the code that makes an absence sentence true, by id. `where` names each declaration
 * (`[file, name]`) the proof rests on; the test checks that the file declares it. `scopes` are the reaches its code
 * checks over (ABSENCE_SCOPES), each one its kind can reach. Kinds:
 *   recorder  a field the recorder typed, a recorder version whose code was read, or the recorder's own lineage;
 *   search    a verbatim search of what was recorded or read;
 *   system    an answer of the file system or git;
 *   gate      a judgment of a review model that code admits only after its quote grounds verbatim and its check holds
 *             (the meaning stays the model's; code checks structure and quotes);
 *   report    D115: a field that code itself set on a published row of a review after its checks, or the place the report
 *             model gave that row: Sonah's own record of the review, read back from the report.
 */
export const ABSENCE_PROOFS = Object.freeze({
  typed_denial: Object.freeze({ kind: 'recorder', where: [['packages/evidence/src/ledger.js', 'resultOutcome'],
    ['packages/evidence/src/session.js', 'REFUSED_DENIALS']],
  scopes: Object.freeze(['call']),
  proves: 'did not run, refused before it ran: only a call whose recorder typed a denial kind of the closed list on it' }),
  // D127 (B10d): a compaction of the agent's context and the tokens it dropped, as the recorder typed them on the
  // compaction's own boundary row.
  typed_compaction: Object.freeze({ kind: 'recorder', where: [['packages/slicer/src/events.js', 'compactedOf'],
    ['packages/render/report-model.js', 'compactionsOf']],
  scopes: Object.freeze(['call']),
  proves: 'compacted the agent\'s context here and dropped N of its M tokens: only a Claude Code compaction boundary row '
    + '(`compact_boundary`), at its place, with the counts that row typed (`preTokens`, `postTokens`), N their difference; '
    + 'with no typed counts, the compaction alone' }),
  typed_stop: Object.freeze({ kind: 'recorder', where: [['packages/evidence/src/ledger.js', 'STOPPED_OUTCOME_FORMS'],
    ['packages/evidence/src/session.js', 'STOPPED_DENIALS'], ['packages/slicer/src/events.js',
      'STOPPED_NOTIFICATION_STATUSES']],
  scopes: Object.freeze(['call']),
  proves: 'stopped or cancelled before it finished: only a typed interrupt, a stopped denial kind, a result typed '
    + 'cancelled, or a notice typed stopped or killed' }),
  background_end_absent: Object.freeze({ kind: 'search', where: [['packages/slicer/src/background-ends.js',
    'readBackgroundEnds'], ['packages/evidence/src/ledger.js', 'PROVED_NO_END_FORM']],
  scopes: Object.freeze(['recording']),
  proves: 'no end recorded: only a background run with no linked notice whose task id is in no later row of its '
    + 'lineage that the agent did not write, and in no row before its launch (D99)' }),
  untyped_refusal_recorder: Object.freeze({ kind: 'recorder', where: [['packages/slicer/src/events.js',
    'CLAUDE_UNTYPED_DENIAL_RECORDER']],
  scopes: Object.freeze(['recorder']),
  proves: 'the recorder does not mark which: only a failed call of a recorder version at or below the one whose code '
    + 'was read, which types no refusal (the result text that it records can still say which, so no sentence says that '
    + 'the recording does not)' }),
  shell_write_result: Object.freeze({ kind: 'recorder', where: [['packages/evidence/src/ledger.js', 'actionOutcome']],
  scopes: Object.freeze(['call']),
  proves: 'no terminal status recorded of this write: the slicer parsed it from a command, so it has no result of its '
    + 'own (the recorder records the results of calls), and its command was typed failed or stopped. It proves '
    + 'nothing about whether the write happened: a later record can show that' }),
  helper_lineage: Object.freeze({ kind: 'recorder', where: [['packages/evidence/src/ledger.js', 'helperStatement']],
  scopes: Object.freeze(['lineage']),
  proves: 'you did not see it: the words or the edit are in a verified helper recording, which the harness does not '
    + 'show you' }),
  message_lineage: Object.freeze({ kind: 'recorder', where: [['packages/evidence/src/checklist.js', 'checkedFailure']],
  scopes: Object.freeze(['lineage']),
  proves: 'not a message of the agent\'s to you: the cited event is not the main thread\'s commentary, by its kind and '
    + 'lineage' }),
  elision_kind: Object.freeze({ kind: 'recorder', where: [['packages/redact/index.js', 'ASK_MIDDLE'],
    ['packages/evidence/adapters/sonah-ledger.js', 'ASK_STRIP_KINDS']],
  scopes: Object.freeze(['call']),
  proves: 'cut short: the record of the message carries a cut, Sonah\'s by its closed kinds, the recorder\'s by any '
    + 'other' }),
  os_gone: Object.freeze({ kind: 'system', where: [['packages/cli/src/code-snapshot.js', 'GONE']],
  scopes: Object.freeze(['system']),
  proves: 'not there any more: the file system answered ENOENT or ENOTDIR for the path' }),
  code_quote_search: Object.freeze({ kind: 'search', where: [['packages/evidence/src/code-pass.js',
    'groundCodeReceipt'], ['packages/evidence/src/code-pass.js', 'groundFinding']],
  scopes: Object.freeze(['code']),
  proves: 'the lines do not hold the quote, or no step quotes the lines that a finding is about: the quote was found '
    + 'verbatim in the file read and no occurrence overlaps the named lines, or they are no lines of the file '
    + '(groundCodeReceipt); or the lines that the finding is about are no lines of the file, or overlap no lines where '
    + 'a code step of its trace grounded its quote (groundFinding)' }),
  git_remote_refs: Object.freeze({ kind: 'system', where: [['packages/cli/src/repo-links.js', 'onRemote']],
  scopes: Object.freeze(['system']),
  proves: 'git does not show the commit on the remote: git ran, and no remote-tracking branch of that remote holds it '
    + '(said as what git showed, never as a fact about GitHub)' }),
  judged_ask_shortfall: Object.freeze({ kind: 'gate', where: [['packages/evidence/src/checklist.js',
    'checkedRequirement']],
  scopes: Object.freeze(['judgment']),
  proves: 'not done or partly done: only when the session review\'s quote of what is missing grounds verbatim after '
    + 'the ask, and its check upheld it' }),
  judged_unasked: Object.freeze({ kind: 'gate', where: [['packages/evidence/src/ledger.js',
    'checkedInstructionAbsence']],
  scopes: Object.freeze(['judgment']),
  proves: 'you did not ask for this: only when your messages before the decision are complete and every check that '
    + 'the session review lists grounds' }),
  judged_passed_over: Object.freeze({ kind: 'gate', where: [['packages/evidence/src/checklist.js', 'checkedFailure']],
  scopes: Object.freeze(['judgment']),
  proves: 'the agent did not act on it or tell you: only when the cited response is the closing message of the turn '
    + 'after the failure, with no message of yours between' }),
  // D113 (0.3.0-beta.5): the session's own change. A path is touched by a recorded write of the session only when a
  // write, edit or delete of the session or its helpers that the recording shows, whose effect is landed or unknown,
  // names it (codeSnapshotPlan), by its name or by its real place (sessionsOwnChange; D117: in another repository, by its
  // real place there, readPlaceBase).
  recorded_writes_search: Object.freeze({ kind: 'search', where: [['packages/evidence/src/code-pass.js',
    'codeSnapshotPlan'], ['packages/cli/src/code-snapshot.js', 'sessionsOwnChange'],
  ['packages/cli/src/code-snapshot.js', 'readPlaceBase']],
  scopes: Object.freeze(['recording']),
  proves: 'no write of the session touched it, or none could have changed a file: no write, edit or delete of the '
    + 'session or its helpers that the recording shows, whose effect is landed or unknown (session.js effectOf), names '
    + 'the path by its name or its real place' }),
  judged_code_finding: Object.freeze({ kind: 'gate', where: [['packages/evidence/src/code-pass.js',
    'readFindingVerdict']],
  scopes: Object.freeze(['judgment']),
  proves: 'an ask that the code does not meet: only a finding that a second reviewer\'s check found again' }),
  judged_contradiction: Object.freeze({ kind: 'gate', where: [['packages/evidence/src/run-review.js',
    'groundNarrative'], ['packages/evidence/src/written.js', 'readWrittenStatement']],
  scopes: Object.freeze(['judgment']),
  proves: 'false: only a claim or a written statement that a grounded recorded result contradicts, upheld by its '
    + 'check' }),
  // D115 (the owner: "for the hn5, start work now"): the session review's rows, said only as far as the row reaches.
  review_row_cites: Object.freeze({ kind: 'report', where: [['packages/evidence/src/checklist.js',
    'checkedRequirement'], ['packages/evidence/src/ledger.js', 'REQUIREMENT_FACTS'],
  ['packages/render/report-model.js', 'citesOnlyAgentWords']],
  scopes: Object.freeze(['review']),
  proves: 'what one published row of the session review cites as doing an ask: code publishes a not-checked row with '
    + 'no deliverable (checkedRequirement), and a done row with the deliverable it grounded in the kind of text that it '
    + 'names, the agent\'s message when that kind is commentary (citesOnlyAgentWords). It proves nothing of what else '
    + 'the recording holds' }),
  row_shape: Object.freeze({ kind: 'report', where: [['packages/render/session-story.js', 'readableRequirement']],
  scopes: Object.freeze(['review']),
  proves: 'Sonah could not read the row: a requirement row of the report that is not an object with a text, a status of '
    + 'the closed lists and an instruction receipt, which no reader reads' }),
  row_unplaced: Object.freeze({ kind: 'report', where: [['packages/render/session-story.js', 'storyFacts'],
    ['packages/render/report-model.js', 'candidatesOf']],
  scopes: Object.freeze(['review']),
  proves: 'Sonah could not place the row among the asks of your prompt: a row of the report that the asks of your '
    + 'prompt (storyFacts: your messages and the files that you attached to them) do not read, which candidatesOf '
    + 'places under what Sonah could not check' }),
  brief_lineage: Object.freeze({ kind: 'recorder', where: [['packages/evidence/src/code-context.js', 'askSourceOf']],
  scopes: Object.freeze(['lineage']),
  proves: 'an agent wrote it into a helper\'s brief: the ask\'s instruction receipt cites an instruction of a helper\'s '
    + 'session that the recorder\'s lineage records with its parent agent\'s authority, never your message' }),
});

/**
 * D115 (the owner: "for the hn5, start work now"): the sentences of class `sonah` that say what a published row of the
 * session review cites, or what Sonah could do with such a row (read it, place it, list it), read so by a person. The
 * truth check of real reports found three of them false of the session: "Sonah found no recorded result or change for
 * it" (no search ran; the recording held the results), "The session review found nothing that does this ask before the
 * recording ended" (its row cites nothing; the agent did the ask) and "Sonah could not read 13 asks of the session
 * review" (Sonah read them: an agent's briefs to a helper). D100 took Sonah's own record as the proof of every `sonah`
 * sentence without naming it. Each key here stands, as an absence does, only beside a registered proof that checks the
 * reach its words claim (ABSENCE_REGISTRY): `unregistered` otherwise.
 */
export const REVIEW_ROW_KEYS = Object.freeze({
  'packages/evidence/src/review.js': Object.freeze(['CHECKLIST_REQUIREMENT_FACT_WORDS.no_deliverable_by_end']),
  'packages/render/report-words.js': Object.freeze(['REPORT_PROMPT_WORDS.agentOnly', 'REPORT_NOT_CHECKED_PARTS.agentOnly',
    'REPORT_NOT_CHECKED_WORDS.unreadAsks', 'REPORT_NOT_CHECKED_WORDS.unplacedAsks', 'REPORT_NOT_CHECKED_WORDS.briefAsks']),
});

/** Why an absence sentence may stand without a proof here: the closed reasons, each for the owner to settle.
 *   request_words  words a model request carries (their entry passes the style linter's `request-bytes`): a rewrite
 *                  moves the bytes of the requests that carry them, so stored answers would not replay.
 *   unreached      words of a table that a request carries (`request-bytes`, pinned whole by the style linter's test),
 *                  in a form that no request carries and no reader shows: an outcome form that `resultOutcome` never
 *                  returns, where a request (prompt.js, through `resultOutcome`) is the only reader of an outcome's
 *                  words. The test checks both by reading the code. */
export const HELD_REASONS = Object.freeze(['request_words', 'unreached']);

/** The fingerprint of a key's rendered texts, in their fixture order. */
export const fingerprintOf = (texts) => createHash('sha256').update(texts.join('\u0000')).digest('hex').slice(0, 16);

/**
 * What the audit finds wrong, `[{ problem, module, key, texts?, fingerprint? }]`, for `tables` (`Map` module ->
 * `Map` key -> its rendered texts) against `census`, `registry` and `held`:
 *   unread       a key no person read: a new sentence;
 *   changed      a key whose texts changed since a person read them;
 *   stale        a key the census holds and no table does;
 *   unregistered an absence key, or a key of REVIEW_ROW_KEYS (D115), with no proof and no held reason;
 *   not_absence  a key the registry names whose class is not absence and that REVIEW_ROW_KEYS does not list, or a key
 *                the held list names whose class is not absence;
 *   row_class    (D115) a key of REVIEW_ROW_KEYS that the census does not hold in class sonah;
 *   both         a key both registered and held;
 *   scope_unproved  (D100, review of A1c) a key whose words claim a reach that the proof named beside it does not
 *                check (`proof`, `scope`): the proof exists, but its code looks less far than the words say;
 *   proof_scope  a proof (`key`, module `proofs`) that names a reach its kind of code cannot check (ABSENCE_SCOPES);
 *   class_unknown, proof_unknown, held_unknown, scope_unknown  a value outside its closed list.
 * Pure.
 */
export function auditProblems(tables, { census = READ_CENSUS, registry = ABSENCE_REGISTRY, held = ABSENCE_HELD,
  proofs = ABSENCE_PROOFS, rows = REVIEW_ROW_KEYS } = {}) {
  const out = [];
  const add = (problem, module, key, extra = {}) => out.push({ problem, module, key, ...extra });
  for (const [module, keys] of tables) for (const [key, texts] of keys) {
    const read = census[module]?.[key];
    if (!read) add('unread', module, key, { texts, fingerprint: fingerprintOf(texts) });
    else if (read[1] !== fingerprintOf(texts)) add('changed', module, key, { texts, fingerprint: fingerprintOf(texts) });
  }
  for (const [module, keys] of Object.entries(census)) for (const [key, [cls]] of Object.entries(keys)) {
    if (!tables.get(module)?.has(key)) add('stale', module, key);
    if (!AUDIT_CLASSES.includes(cls)) add('class_unknown', module, key);
    const proven = Object.hasOwn(registry[module] ?? {}, key), kept = Object.hasOwn(held[module] ?? {}, key);
    // D115: a sentence about a row of the session review (REVIEW_ROW_KEYS, class sonah) is registered as an absence is.
    const row = cls === 'sonah' && (rows[module] ?? []).includes(key);
    if ((cls === 'absence' || row) && !proven && !kept) add('unregistered', module, key);
    if ((cls !== 'absence' && !row && proven) || (cls !== 'absence' && kept)) add('not_absence', module, key);
    if (proven && kept) add('both', module, key);
  }
  for (const [module, keys] of Object.entries(rows))
    for (const key of keys) if (census[module]?.[key]?.[0] !== 'sonah') add('row_class', module, key);
  for (const [id, proof] of Object.entries(proofs))
    for (const scope of Array.isArray(proof?.scopes) && proof.scopes.length ? proof.scopes : [null])
      if (!Object.hasOwn(ABSENCE_SCOPES, scope) || !ABSENCE_SCOPES[scope].includes(proof.kind))
        add('proof_scope', 'proofs', id, { scope });
  for (const [module, keys] of Object.entries(registry)) for (const [key, claims] of Object.entries(keys)) {
    if (!census[module]?.[key]) add('not_absence', module, key);
    const pairs = claims !== null && typeof claims === 'object' && !Array.isArray(claims) ? Object.entries(claims) : [];
    if (!pairs.length || pairs.some(([id]) => !Object.hasOwn(proofs, id))) { add('proof_unknown', module, key); continue; }
    // The reach the words claim, as a person read it, must be one the proof's code checks.
    for (const [proof, scope] of pairs) {
      if (!Object.hasOwn(ABSENCE_SCOPES, scope)) add('scope_unknown', module, key, { proof, scope });
      else if (!proofs[proof].scopes?.includes(scope)) add('scope_unproved', module, key, { proof, scope });
    }
  }
  for (const [module, keys] of Object.entries(held)) for (const [key, reason] of Object.entries(keys)) {
    if (!census[module]?.[key]) add('not_absence', module, key);
    if (!HELD_REASONS.includes(reason)) add('held_unknown', module, key);
  }
  return out;
}

// ---- the registry, the held list and the census (D100, as read on 2026-10-17) ----------------------------------------

/** Each absence key and the proofs that make it true (every form of a function key, each by its own proof), each with the
 *  reach (ABSENCE_SCOPES) that the words it proves claim, as a person read them. */
export const ABSENCE_REGISTRY = Object.freeze({
  'packages/evidence/src/review.js': Object.freeze({
    'ATTENTION_WORDS.unasked': Object.freeze({ judged_unasked: 'judgment' }),
    // D113 amended (its second review): the PR comment's count of the findings about code outside the evaluated session.
    'ATTENTION_WORDS.codeFindingsOutside': Object.freeze({ recorded_writes_search: 'recording' }),
    'ATTENTION_WORDS.passedOver': Object.freeze({ judged_passed_over: 'judgment' }),
    'CHECKLIST_FAILURE_REASON_WORDS.response_not_shown_to_human': Object.freeze({ message_lineage: 'lineage' }),
    'CHECKLIST_FAILURE_REASON_WORDS.write_command_not_run_or_failed': Object.freeze({
      typed_denial: 'call', typed_stop: 'call' }),
    'CHECKLIST_FAILURE_WORDS.passed-over': Object.freeze({ judged_passed_over: 'judgment' }),
    'CHECKLIST_OUTCOME_WORDS.failed-or-refused': Object.freeze({ untyped_refusal_recorder: 'recorder' }),
    'CHECKLIST_OUTCOME_WORDS.did-not-run': Object.freeze({ typed_denial: 'call' }),
    'CHECKLIST_OUTCOME_WORDS.no-terminal-status': Object.freeze({
      background_end_absent: 'recording', typed_stop: 'call' }),
    'CHECKLIST_REQUIREMENT_REASON_WORDS.write_command_not_run_or_failed': Object.freeze({
      typed_denial: 'call', typed_stop: 'call' }),
    'COVERAGE_SENTENCE.instructions_elided': Object.freeze({ elision_kind: 'call' }),
    'COVERAGE_SENTENCE.instructions_refusal_untyped': Object.freeze({ untyped_refusal_recorder: 'recorder' }),
    'FAILURE_SECTION_WORDS.intro': Object.freeze({
      typed_denial: 'call', typed_stop: 'call', background_end_absent: 'recording' }),
    'SHELL_WRITE_OUTCOME_WORDS.command-stopped': Object.freeze({ typed_stop: 'call' }),
    // D115: what the row cites (no deliverable), and that the session review did not check it: one row's reach.
    'CHECKLIST_REQUIREMENT_FACT_WORDS.no_deliverable_by_end': Object.freeze({ review_row_cites: 'review' }),
  }),
  'packages/evidence/src/code-report.js': Object.freeze({
    'CODE_REPORT_WORDS.causes.anchor_off_quote': Object.freeze({ code_quote_search: 'code' }),
    // D113: the files that changed outside this session's recorded writes, and a session with no such write.
    'CODE_REPORT_WORDS.changedOutside': Object.freeze({ recorded_writes_search: 'recording' }),
    // D113 amended: a file outside the evaluated session, by the same search: the tag, the line that names them when the
    // code review was given them, and what it saw of them.
    'CODE_REPORT_WORDS.outsideTag': Object.freeze({ recorded_writes_search: 'recording' }),
    'CODE_REPORT_WORDS.outsideFiles': Object.freeze({ recorded_writes_search: 'recording' }),
    'CODE_REPORT_WORDS.outsideSeen': Object.freeze({ recorded_writes_search: 'recording' }),
    // D113 amended (its review): why an ask not met or a claim the code contradicts on such a file is withheld.
    'CODE_REPORT_WORDS.outsideTie.ask_not_met': Object.freeze({ recorded_writes_search: 'recording' }),
    'CODE_REPORT_WORDS.outsideTie.claim_false': Object.freeze({ recorded_writes_search: 'recording' }),
    // D117: the same, of another git repository the session wrote to, in D113 amended's words: not reviewed, or given to
    // the code review; each outside the evaluated session.
    'CODE_REPORT_WORDS.placeChangedOutside': Object.freeze({ recorded_writes_search: 'recording' }),
    'CODE_REPORT_WORDS.placeOutsideFiles': Object.freeze({ recorded_writes_search: 'recording' }),
    'CODE_REPORT_WORDS.noWrite': Object.freeze({ recorded_writes_search: 'recording' }),
    // D118 (a): the same reason, on the first screen.
    'CODE_REPORT_WORDS.notReviewedReasons.no_write': Object.freeze({ recorded_writes_search: 'recording' }),
    'CODE_REPORT_WORDS.states.deleted': Object.freeze({ os_gone: 'system' }),
    'CODE_REPORT_WORDS.kinds.ask_not_met': Object.freeze({ judged_code_finding: 'judgment' }),
  }),
  'packages/evidence/src/ledger.js': Object.freeze({
    'RESULT_OUTCOME_WORDS.did-not-run.denial': Object.freeze({ typed_denial: 'call' }),
    'RESULT_OUTCOME_WORDS.no-terminal-status.background': Object.freeze({ background_end_absent: 'recording' }),
    'RESULT_OUTCOME_WORDS.no-terminal-status.interrupted': Object.freeze({ typed_stop: 'call' }),
    'RESULT_OUTCOME_WORDS.no-terminal-status.cancelled': Object.freeze({ typed_stop: 'call' }),
    'RESULT_OUTCOME_WORDS.no-terminal-status.command-failed': Object.freeze({ shell_write_result: 'call' }),
    'RESULT_OUTCOME_WORDS.no-terminal-status.command-stopped': Object.freeze({
      shell_write_result: 'call', typed_stop: 'call' }),
    'RESULT_OUTCOME_WORDS.failed-or-refused.untyped': Object.freeze({ untyped_refusal_recorder: 'recorder' }),
    'STOPPED_WORDS': Object.freeze({ typed_stop: 'call' }),
    'shellWriteWords': Object.freeze({ typed_stop: 'call' }),
  }),
  'packages/render/report-words.js': Object.freeze({
    // D127 (B10d): what the agent's context dropped at a compaction, only from the counts its boundary row typed.
    'REPORT_PROMPT_WORDS.compaction': Object.freeze({ typed_compaction: 'call' }),
    'REPORT_DID_WORDS.unconfirmed': Object.freeze({ typed_stop: 'call' }),
    // D113 amended: an item about code outside the evaluated session, their count, the count line's tag, and the files
    // list's line of the files outside it, each by the recorded writes' search that places a file outside it.
    'REPORT_ITEM_WORDS.outsideSession': Object.freeze({ recorded_writes_search: 'recording' }),
    'REPORT_COUNT_WORDS.outside': Object.freeze({ recorded_writes_search: 'recording' }),
    'REPORT_COUNT_WORDS.outsideLabel': Object.freeze({ recorded_writes_search: 'recording' }),
    'REPORT_DID_WORDS.outsideSession': Object.freeze({ recorded_writes_search: 'recording' }),
    'REPORT_DID_WORDS.handling.passed-over': Object.freeze({ judged_passed_over: 'judgment' }),
    'REPORT_DISCLOSURE_WORDS.claim.helper_internal': Object.freeze({ helper_lineage: 'lineage' }),
    'REPORT_DISCLOSURE_WORDS.edit.helper_internal': Object.freeze({ helper_lineage: 'lineage' }),
    'REPORT_GAP_WORDS.instruction_omitted': Object.freeze({ elision_kind: 'call' }),
    'REPORT_HEADER_WORDS.refusedAfterEdit': Object.freeze({ typed_denial: 'call' }),
    'REPORT_HEADER_WORDS.unclearAfterEdit': Object.freeze({ untyped_refusal_recorder: 'recorder' }),
    'REPORT_HEADER_WORDS.notOnGitHub.new': Object.freeze({ git_remote_refs: 'system' }),
    'REPORT_HEADER_WORDS.notOnGitHub.old': Object.freeze({ git_remote_refs: 'system' }),
    'REPORT_HEADER_WORDS.notOnGitHub.both': Object.freeze({ git_remote_refs: 'system' }),
    'REPORT_ITEM_WORDS.whatMissing': Object.freeze({ judged_ask_shortfall: 'judgment' }),
    'REPORT_ITEM_WORDS.checkedAgainst': Object.freeze({ judged_unasked: 'judgment' }),
    'REPORT_ITEM_WORDS.notAsked': Object.freeze({ judged_unasked: 'judgment' }),
    'REPORT_KIND_LABELS.claim': Object.freeze({ judged_contradiction: 'judgment' }),
    'REPORT_KIND_LABELS.written': Object.freeze({ judged_contradiction: 'judgment' }),
    'REPORT_KIND_WORDS.ask_not_done': Object.freeze({ judged_ask_shortfall: 'judgment' }),
    'REPORT_KIND_WORDS.ask_partly_done': Object.freeze({ judged_ask_shortfall: 'judgment' }),
    'REPORT_KIND_WORDS.code_ask_not_met': Object.freeze({ judged_code_finding: 'judgment' }),
    'REPORT_KIND_WORDS.failure_passed_over': Object.freeze({ judged_passed_over: 'judgment' }),
    'REPORT_KIND_WORDS.decision_unasked': Object.freeze({ judged_unasked: 'judgment' }),
    'REPORT_OUTCOME_WORDS.did-not-run.denial': Object.freeze({ typed_denial: 'call' }),
    'REPORT_OUTCOME_WORDS.no-terminal-status.background': Object.freeze({ background_end_absent: 'recording' }),
    'REPORT_OUTCOME_WORDS.no-terminal-status.interrupted': Object.freeze({ typed_stop: 'call' }),
    'REPORT_OUTCOME_WORDS.no-terminal-status.cancelled': Object.freeze({ typed_stop: 'call' }),
    'REPORT_OUTCOME_WORDS.no-terminal-status.command-stopped': Object.freeze({ typed_stop: 'call' }),
    'REPORT_OUTCOME_WORDS.failed-or-refused.untyped': Object.freeze({ untyped_refusal_recorder: 'recorder' }),
    'REPORT_PROMPT_PARTS.partly': Object.freeze({ judged_ask_shortfall: 'judgment' }),
    'REPORT_PROMPT_PARTS.notDone': Object.freeze({ judged_ask_shortfall: 'judgment' }),
    'REPORT_PROMPT_WORDS.status.partly': Object.freeze({ judged_ask_shortfall: 'judgment' }),
    'REPORT_PROMPT_WORDS.status.notDone': Object.freeze({ judged_ask_shortfall: 'judgment' }),
    'REPORT_RESULT_PARTS.did-not-run': Object.freeze({ typed_denial: 'call' }),
    'REPORT_RESULT_PARTS.no-terminal-status': Object.freeze({ background_end_absent: 'recording' }),
    'REPORT_RESULT_PARTS.stopped': Object.freeze({ typed_stop: 'call' }),
    'REPORT_WHAT_WORDS.ask_not_done': Object.freeze({ judged_ask_shortfall: 'judgment' }),
    'REPORT_WHAT_WORDS.ask_partly_done': Object.freeze({ judged_ask_shortfall: 'judgment' }),
    'REPORT_WHAT_WORDS.failure.failed-or-refused': Object.freeze({ untyped_refusal_recorder: 'recorder' }),
    'REPORT_WHAT_WORDS.failure.did-not-run': Object.freeze({ typed_denial: 'call' }),
    'REPORT_WHAT_WORDS.failure.no-terminal-status': Object.freeze({ background_end_absent: 'recording' }),
    'REPORT_WHAT_WORDS.failure.stopped': Object.freeze({ typed_stop: 'call' }),
    'REPORT_WHAT_WORDS.failureTail': Object.freeze({ judged_passed_over: 'judgment' }),
    // D115: the session review's rows, said only as far as the row, its place in the report and its lineage reach.
    'REPORT_PROMPT_WORDS.agentOnly': Object.freeze({ review_row_cites: 'review' }),
    'REPORT_NOT_CHECKED_PARTS.agentOnly': Object.freeze({ review_row_cites: 'review' }),
    'REPORT_NOT_CHECKED_WORDS.unreadAsks': Object.freeze({ row_shape: 'review' }),
    'REPORT_NOT_CHECKED_WORDS.unplacedAsks': Object.freeze({ row_unplaced: 'review' }),
    'REPORT_NOT_CHECKED_WORDS.briefAsks': Object.freeze({ brief_lineage: 'lineage', row_unplaced: 'review' }),
  }),
  'packages/cli/src/session-review-command.js': Object.freeze({
    // D113: the terminal's count of the paths that changed outside this session's recorded writes.
    'CODE_SNAPSHOT_WORDS.changedOutside': Object.freeze({ recorded_writes_search: 'recording' }),
    // D117: the same, of another git repository the session wrote to.
    'CODE_SNAPSHOT_WORDS.placeChangedOutside': Object.freeze({ recorded_writes_search: 'recording' }),
    // D113's review: the terminal's run-state line of a session with no write that could have changed a file, as the
    // page says it.
    'RUN_STATE_WORDS.codePass.noWrite': Object.freeze({ recorded_writes_search: 'recording' }),
  }),
  'packages/cli/src/report-output.js': Object.freeze({
    'REPORT_OUTPUT_WORDS.notPushed.new': Object.freeze({ git_remote_refs: 'system' }),
    'REPORT_OUTPUT_WORDS.notPushed.old': Object.freeze({ git_remote_refs: 'system' }),
    'REPORT_OUTPUT_WORDS.notPushed.both': Object.freeze({ git_remote_refs: 'system' }),
  }),
});

/** The absence keys held for the owner, each with its closed reason (HELD_REASONS). */
export const ABSENCE_HELD = Object.freeze({
  'packages/evidence/src/ledger.js': Object.freeze({
    // An action's form (`actionOutcome`) that resultOutcome never returns: no request carries it and no reader shows it.
    'RESULT_OUTCOME_WORDS.no-terminal-status.none': 'unreached',
    'RESULT_OUTCOME_WORDS.output-no-status.output': 'request_words',
    'RESULT_OUTCOME_WORDS.output-no-status.unread': 'request_words',
  }),
});

/** Every key of every word table, as read: `[class, fingerprint of its rendered texts]`. */
export const READ_CENSUS = Object.freeze({
  'packages/evidence/src/review.js': Object.freeze({
    'ASK_CODE_WORDS.label': ['other', '3d2006711d4cf001'],
    'ASK_CODE_WORDS.status.done': ['other', '60840219ba2f2b5e'],
    'ASK_CODE_WORDS.status.addressed': ['other', '60840219ba2f2b5e'],
    'ASK_CODE_WORDS.status.partly-done': ['sonah', 'dc0870cbac7dfa8f'],
    'ASK_CODE_WORDS.status.partly-addressed': ['sonah', 'dc0870cbac7dfa8f'],
    'ASK_CODE_WORDS.status.not-done': ['sonah', '66e3308fddba4469'],
    'ASK_CODE_WORDS.status.open': ['sonah', '66e3308fddba4469'],
    'ASK_CODE_WORDS.status.not-checked': ['sonah', '446bb81543748b1c'],
    'ASK_CODE_WORDS.notMet': ['sonah', '3371bee831a51d31'],
    'ASK_CODE_WORDS.bearsOn': ['other', '5413be92fc743168'],
    'ASK_CODE_WORDS.withheld': ['sonah', '7be8646021a55963'],
    'ASK_CODE_WORDS.question': ['other', '141d7c9dbc2a4927'],
    'ASK_CODE_WORDS.unconfirmed': ['sonah', '678d17c6173dbb51'],
    'ASK_CODE_WORDS.withStatus': ['sonah', '7332bf514a25f086'],
    'ATTENTION_WORDS.notActing': ['other', '44239b8f792a6cc7'],
    'ATTENTION_WORDS.unasked': ['absence', '163a48e653d3ba72'],
    'ATTENTION_WORDS.chose': ['other', '6331b634bc502074'],
    'ATTENTION_WORDS.whetherAsked': ['sonah', '35d61cf3a8ab100b'],
    'ATTENTION_WORDS.pivots': ['other', '646b242ce57af45d'],
    'ATTENTION_WORDS.asksNotDone': ['sonah', 'a1ab604e3d61c1f2'],
    'ATTENTION_WORDS.asksCodeFinding': ['other', '9871c52ec6263439'],
    'ATTENTION_WORDS.contradicted': ['other', '60b10b295caca30b'],
    'ATTENTION_WORDS.codeContradicted': ['other', '8af6f1d06f114b45'],
    'ATTENTION_WORDS.passedOver': ['absence', 'dbe13321769b8365'],
    'ATTENTION_WORDS.forbidden': ['other', '9b69e72e674654a1'],
    'ATTENTION_WORDS.writtenContradicted': ['other', 'a2f4079628f18434'],
    'ATTENTION_WORDS.codeFindings': ['other', 'b0cbc3451c33dea6'],
    // D113 amended (its second review): the PR comment's count of the findings of the code review about code outside the
    // evaluated session, apart from the session's own: it states that the code is outside the evaluated session.
    'ATTENTION_WORDS.codeFindingsOutside': ['absence', '242f83b68f100436'],
    'ATTENTION_WORDS.notCovered': ['sonah', '705a225cd12631d6'],
    'ATTENTION_WORDS.folded': ['sonah', '0fefd06ce4c9d7ba'],
    'ATTENTION_WORDS.none': ['sonah', 'f5701cbcf089750a'],
    'CHECKLIST_CLAIM_REASON_WORDS.challenge_unsettled': ['sonah', 'd01733af02cec707'],
    'CHECKLIST_CLAIM_REASON_WORDS.challenge_unexecuted': ['sonah', 'baa4ec41dcd57d60'],
    'CHECKLIST_CONTRADICTION_WORDS.result': ['other', '87cf80e043244e07'],
    'CHECKLIST_CONTRADICTION_WORDS.human_message': ['other', '1967b89e318cb564'],
    'CHECKLIST_CONTRADICTION_WORDS.file_content': ['other', '4140fb2c416cc5de'],
    'CHECKLIST_CONTRADICTION_WORDS.project_instructions': ['other', 'a0c8e2e2c5913d07'],
    'CHECKLIST_CONTRADICTION_WORDS.own_written': ['other', '3b68ed77dbe69577'],
    'CHECKLIST_FAILURE_REASON_WORDS.response_ungrounded': ['sonah', '54639547d2c04bba'],
    'CHECKLIST_FAILURE_REASON_WORDS.response_not_after': ['other', '191c0e62fa4b6a32'],
    'CHECKLIST_FAILURE_REASON_WORDS.response_other_agent': ['other', 'd74a30cba1d9a41f'],
    'CHECKLIST_FAILURE_REASON_WORDS.response_not_shown_to_human': ['absence', 'ae6c20c508573514'],
    'CHECKLIST_FAILURE_REASON_WORDS.turn_end_not_cited': ['sonah', 'ecfe79eadcfc2bc1'],
    'CHECKLIST_FAILURE_REASON_WORDS.failure_unreviewed': ['sonah', '7422e19d175bd13e'],
    'CHECKLIST_FAILURE_REASON_WORDS.challenge_refuted': ['sonah', 'ed60f0ebcafbf5be'],
    'CHECKLIST_FAILURE_REASON_WORDS.challenge_unsettled': ['sonah', 'd01733af02cec707'],
    'CHECKLIST_FAILURE_REASON_WORDS.challenge_unexecuted': ['sonah', 'baa4ec41dcd57d60'],
    'CHECKLIST_FAILURE_REASON_WORDS.write_command_not_run_or_failed': ['absence', 'e74db44726313089'],
    'CHECKLIST_FAILURE_WORDS.passed-over': ['absence', '5021342fa21b7a5d'],
    'CHECKLIST_FAILURE_WORDS.told-human': ['other', '02d2c04cb95acf71'],
    'CHECKLIST_FAILURE_WORDS.acted-on': ['other', 'a3e830a0692daecc'],
    'CHECKLIST_FAILURE_WORDS.not-checked': ['sonah', 'd16948e73a680090'],
    // D101 (read 2026-10-17, when D100 and D101 were joined): each cause's words say what the session review gave or
    // named, or what Sonah did not show, find, place or check; none states an absence of the recording.
    'CHECKLIST_GROUNDING_CAUSE_WORDS.receipt_malformed': ['sonah', '7bde850f9d832582'],
    'CHECKLIST_GROUNDING_CAUSE_WORDS.role_not_allowed': ['sonah', '7426a7c5392e4835'],
    'CHECKLIST_GROUNDING_CAUSE_WORDS.quote_too_short': ['sonah', 'a23811f0148caf4a'],
    'CHECKLIST_GROUNDING_CAUSE_WORDS.quote_over_limit': ['sonah', 'e3805e9d054a93d9'],
    'CHECKLIST_GROUNDING_CAUSE_WORDS.event_missing': ['sonah', '2a346c2c6a322eb2'],
    'CHECKLIST_GROUNDING_CAUSE_WORDS.role_not_event_kind': ['sonah', 'b79c9fd09eacc16a'],
    'CHECKLIST_GROUNDING_CAUSE_WORDS.session_mismatch': ['other', '82161cefc56f6aa0'],
    'CHECKLIST_GROUNDING_CAUSE_WORDS.event_not_shown': ['sonah', '44f31bbd675abd7a'],
    'CHECKLIST_GROUNDING_CAUSE_WORDS.synthetic_marker': ['sonah', 'ae97147a16ad8ea5'],
    'CHECKLIST_GROUNDING_CAUSE_WORDS.not_found': ['sonah', '7c955822a265eecb'],
    'CHECKLIST_GROUNDING_CAUSE_WORDS.not_anchor_session': ['sonah', '72ef8f890f4d1ecd'],
    'CHECKLIST_GROUNDING_CAUSE_WORDS.not_after': ['sonah', '4da4f36efb173972'],
    'CHECKLIST_OUTCOME_WORDS.ran-failed': ['other', '3ec6b2de021a8261'],
    'CHECKLIST_OUTCOME_WORDS.failed-or-refused': ['absence', 'b12d203660a1088c'],
    'CHECKLIST_OUTCOME_WORDS.did-not-run': ['absence', '9360943b43489fac'],
    'CHECKLIST_OUTCOME_WORDS.no-terminal-status': ['absence', '6646eb4f5fdd9ec9'],
    'CHECKLIST_OUTCOME_WORDS.end-unread': ['sonah', '93d4f02a97666ddd'],
    'CHECKLIST_QUOTE_ANCHOR_WORDS.requirement': ['other', '3be5f28cf025989a'],
    'CHECKLIST_QUOTE_ANCHOR_WORDS.failure': ['other', '616b41ef3627670b'],
    // D115: read again with new words, what the row cites and what the session review did not check (sonah, registered
    // on its row: REVIEW_ROW_KEYS). Its earlier words claimed the whole recording up to its end.
    'CHECKLIST_REQUIREMENT_FACT_WORDS.no_deliverable_by_end': ['sonah', 'acc411d31d6afd9d'],
    'CHECKLIST_REQUIREMENT_REASON_WORDS.deliverable_ungrounded': ['sonah', '1566bf479532080a'],
    'CHECKLIST_REQUIREMENT_REASON_WORDS.deliverable_not_after': ['other', '900297b1cbf62542'],
    'CHECKLIST_REQUIREMENT_REASON_WORDS.check_not_completed': ['sonah', '4eeaf43e6554e9f6'],
    'CHECKLIST_REQUIREMENT_REASON_WORDS.check_end_unread': ['sonah', 'c89371487ad39ef6'],
    'CHECKLIST_REQUIREMENT_REASON_WORDS.check_end_unchecked': ['sonah', '13c88773f1802c9f'],
    'CHECKLIST_REQUIREMENT_REASON_WORDS.shortfall_ungrounded': ['sonah', 'd9cb3fbaa268c510'],
    'CHECKLIST_REQUIREMENT_REASON_WORDS.ask_unreviewed': ['sonah', '0ccec790dcad9d41'],
    'CHECKLIST_REQUIREMENT_REASON_WORDS.challenge_refuted': ['sonah', '382b2abe28e83726'],
    'CHECKLIST_REQUIREMENT_REASON_WORDS.challenge_unsettled': ['sonah', 'd01733af02cec707'],
    'CHECKLIST_REQUIREMENT_REASON_WORDS.challenge_unexecuted': ['sonah', 'baa4ec41dcd57d60'],
    'CHECKLIST_REQUIREMENT_REASON_WORDS.write_command_not_run_or_failed': ['absence', 'eeb183f63b3af36d'],
    'COVERAGE_SENTENCE.no_windows': ['sonah', '8dbe742adf42a0a7'],
    'COVERAGE_SENTENCE.no_actions': ['sonah', '8a7f47ed0971da48'],
    'COVERAGE_SENTENCE.windows_incomplete': ['sonah', '3cee6e7f4f67950b'],
    'COVERAGE_SENTENCE.instructions_elided': ['absence', '43d67433b04113c9'],
    'COVERAGE_SENTENCE.instructions_withheld': ['sonah', '2b81fa397f214bfb'],
    'COVERAGE_SENTENCE.instructions_capped': ['sonah', 'fa3655739f2d214e'],
    'COVERAGE_SENTENCE.instructions_stripped': ['sonah', 'e9dcb15bf9a8647e'],
    'COVERAGE_SENTENCE.instructions_nontext': ['sonah', '46b807983ef6a656'],
    'COVERAGE_SENTENCE.instructions_nontext_unplaced': ['sonah', '6c29ad121bef151f'],
    'COVERAGE_SENTENCE.labels_legacy_recorder': ['sonah', '74cfada93f81f922'],
    'COVERAGE_SENTENCE.interruptions_untyped': ['sonah', '893dbf448effb841'],
    'COVERAGE_SENTENCE.commands_args_unrecorded': ['sonah', '1b89f3a2b29a37c4'],
    'COVERAGE_SENTENCE.answers_unrecorded': ['sonah', '68ad59b53c476cfd'],
    'COVERAGE_SENTENCE.origins_unknown': ['sonah', '82a1275af043350f'],
    'COVERAGE_SENTENCE.notifications_unmatched': ['sonah', 'd21c53f2df0ee5bd'],
    'COVERAGE_SENTENCE.ends_unread': ['sonah', 'd7fbde162a826efc'],
    'COVERAGE_SENTENCE.ends_unchecked': ['sonah', 'ef49fdc4f1d2e3d3'],
    'COVERAGE_SENTENCE.instructions_refusal_untyped': ['absence', 'ccf39be7ee81f5d9'],
    'COVERAGE_SENTENCE.instructions_refusal_session_unknown': ['sonah', 'b7c48c1a65f8104f'],
    'COVERAGE_SENTENCE.human_interaction_unknown': ['sonah', 'cb453e799a389055'],
    // D126 (N0): the part before the compaction a session opens on, not read, by its reason: what Sonah found or read.
    'COVERAGE_SENTENCE.instructions_earlier_missing': ['sonah', 'de5ca22ade904b2e'],
    'COVERAGE_SENTENCE.instructions_earlier_ambiguous': ['sonah', '16a809c3c73116a1'],
    'COVERAGE_SENTENCE.instructions_earlier_unread': ['sonah', '2222a9a70e84c46e'],
    'COVERAGE_SENTENCE.instructions_earlier_cycle': ['sonah', 'e90240ebf1d7d2b1'],
    'COVERAGE_SENTENCE.delegations_unlinked': ['sonah', 'c7fa1ecccbb9512d'],
    'COVERAGE_SENTENCE.delegations_ambiguous': ['other', '95ec1fd508dac8ec'],
    'COVERAGE_SENTENCE.briefs_encrypted': ['sonah', '824470e81ba95794'],
    'COVERAGE_SENTENCE.messages_encrypted': ['sonah', '12ad141ff65a1293'],
    // D119: each kind that the inventory cause summed, said apart in one unit; the rest counted by kind.
    'COVERAGE_SENTENCE.workflow_runs_unread': ['sonah', '3b33be71e0307308'],
    'COVERAGE_SENTENCE.workflow_entries_unread': ['sonah', 'da4c1f0770510380'],
    'COVERAGE_SENTENCE.workflow_calls_unlaunched': ['sonah', '71b0054c68854052'],
    'COVERAGE_SENTENCE.helper_captures_incomplete': ['sonah', '3fa8e6d2ada25c87'],
    'COVERAGE_SENTENCE.call_inputs_unread': ['sonah', '2c4d474715bf4736'],
    'COVERAGE_SENTENCE.native_calls_unaccounted': ['sonah', '1bef2fe3f108d1a7'],
    'COVERAGE_SENTENCE.incomplete_inventory': ['sonah', '0452cf9b13f8ad56'],
    'COVERAGE_SENTENCE.observations_incomplete': ['sonah', '4df8dbd5b4d1b858'],
    'COVERAGE_SENTENCE.source_clipped': ['sonah', 'f1e200164af25da1'],
    'COVERAGE_SENTENCE.reports_capped': ['sonah', '22450277fa68a421'],
    'COVERAGE_SENTENCE.statements_capped': ['sonah', '168973cba840cd37'],
    'COVERAGE_SENTENCE.bodies_capped': ['sonah', '536a8442593c092c'],
    'COVERAGE_SENTENCE.unsupported_message': ['sonah', 'a6890f3301ddfeaa'],
    'COVERAGE_SENTENCE.unrecorded_body': ['sonah', '1c9c79fa33fb48e1'],
    'COVERAGE_SENTENCE.write_outcome_unknown': ['sonah', '52b14c68cff10e0a'],
    'COVERAGE_SENTENCE.command_outcome_unknown': ['sonah', 'f9e689a6e264728c'],
    'COVERAGE_SENTENCE.input_limit': ['sonah', 'e518199171a60a31'],
    'COVERAGE_SENTENCE.carry_capped': ['sonah', '7631c75bfac439ac'],
    'COVERAGE_SENTENCE.other_gap': ['sonah', 'e4937cc88442c19b'],
    'COVERAGE_SENTENCE.code_unreviewable': ['sonah', 'e0fec134bd94490c'],
    'COVERAGE_SENTENCE.pr_hunks_withheld': ['sonah', 'f0a67b9755593d3f'],
    'COVERAGE_SENTENCE.pr_files_incomplete': ['sonah', '3262b68716ebc003'],
    // D104 (read 2026-10-17, when D100 and D104 were joined): what Sonah first showed the session review only in part.
    'COVERAGE_SENTENCE.results_seen_in_part': ['sonah', '5050c30eef512440'],
    'FAILURE_SECTION_WORDS.intro': ['absence', '525a2abc4ac9cbce'],
    'FAILURE_SECTION_WORDS.none': ['sonah', '7ba1d069a5b69196'],
    'FOLDED_SECTION_WORDS.heading': ['sonah', 'ea64a56891363533'],
    'FOLDED_SECTION_WORDS.summary': ['sonah', 'ec3b68858f4d10c8'],
    'FOLDED_SECTION_WORDS.lead': ['sonah', '765c551a8833682a'],
    'FOLDED_SECTION_WORDS.groups.asksNotChecked': ['sonah', '80be233405e8a5a0'],
    'FOLDED_SECTION_WORDS.groups.claimsOpen': ['sonah', 'db5ab90e3fb501a5'],
    'FOLDED_SECTION_WORDS.groups.claimsIncomplete': ['sonah', '8cf8e0a81d927339'],
    'FOLDED_SECTION_WORDS.groups.failuresNotChecked': ['sonah', 'ce71a3cb859280d5'],
    'FOLDED_SECTION_WORDS.groups.writtenOpen': ['sonah', '0cdad34f271a1593'],
    'FOLDED_SECTION_WORDS.here': ['sonah', 'e3412f70a50d282f'],
    'FOLDED_SECTION_WORDS.show': ['sonah', '9d2e410d8e6cb776'],
    'SHELL_WRITE_OUTCOME_WORDS.command-failed': ['sonah', '3e9fc3a48960a7be'],
    'SHELL_WRITE_OUTCOME_WORDS.command-stopped': ['absence', '848c097e80374f86'],
  }),
  'packages/evidence/src/code-report.js': Object.freeze({
    'CODE_REPORT_WORDS.heading': ['other', 'e7418aafa488b2aa'],
    'CODE_REPORT_WORDS.label': ['other', '2f59a576e289b4f9'],
    'CODE_REPORT_WORDS.footer': ['sonah', '40b600c01851e75f'],
    'CODE_REPORT_WORDS.outcomes.contradicted-by-code': ['other', '3950107e8006fcf5'],
    'CODE_REPORT_WORDS.how': ['other', '11be6e9461f9fd24'],
    'CODE_REPORT_WORDS.howConfirm': ['other', 'afe17412670004cc'],
    'CODE_REPORT_WORDS.questionsChecked': ['sonah', '14da0321a9fd1d1e'],
    'CODE_REPORT_WORDS.rulesLinesUnknown': ['sonah', '20f43c8a74ea3f99'],
    'CODE_REPORT_WORDS.seenGroups.hunks_only': ['sonah', '3e9e2f33504e2679'],
    'CODE_REPORT_WORDS.seenGroups.in_part': ['sonah', 'd1278a72be0a44c9'],
    'CODE_REPORT_WORDS.seenGroups.lines_unknown': ['sonah', 'dc49821f94d28312'],
    'CODE_REPORT_WORDS.seenGroups.whole': ['other', '5d5766cf2d787016'],
    'CODE_REPORT_WORDS.seenGroups.whole_not_before': ['sonah', 'c47ff8d4a0183668'],
    'CODE_REPORT_WORDS.shownFiles': ['sonah', '908033e2c212b0cb'],
    'CODE_REPORT_WORDS.states.left_out': ['sonah', '1495c40bb567f439'],
    'CODE_REPORT_WORDS.states.other_repository': ['other', 'e9c1b726fbf2118b'],
    'CODE_REPORT_WORDS.states.outside_writer_root': ['other', '14ac9d2867a4895a'],
    'CODE_REPORT_WORDS.unseenShown': ['sonah', 'f42685c26fabc998'],
    // D117: read again, with the working directory's repository named when another place holds files of the change.
    'CODE_REPORT_WORDS.base': ['sonah', 'c822344514905d00'],
    'CODE_REPORT_WORDS.ownBase': ['sonah', '34db175ff75586f8'],
    // D113's review: read again with its display bound (the first names, then how many more).
    // D113 amended: read again with the tag (outside the evaluated session); the tag, the line of the files the code
    // review was given and what it saw of them, read: each states that a file is outside the evaluated session.
    'CODE_REPORT_WORDS.changedOutside': ['absence', '71c026b0e0c6790d'],
    'CODE_REPORT_WORDS.outsideTag': ['absence', '12ca066287786acf'],
    'CODE_REPORT_WORDS.outsideFiles': ['absence', '804bdcf5bda5f9a2'],
    'CODE_REPORT_WORDS.outsideSeen': ['absence', '5f9ed7b88bcd966c'],
    // D113 amended (its review): why an ask not met or a claim the code contradicts, anchored in a file outside the
    // evaluated session, is withheld: each states that a file is outside the evaluated session.
    'CODE_REPORT_WORDS.outsideTie.ask_not_met': ['absence', '0a7317fcf8fcff6d'],
    'CODE_REPORT_WORDS.outsideTie.claim_false': ['absence', 'a3570bc1ce16206f'],
    // D117: each other repository or folder the session wrote to, and where the change's files lie. Merged with D113
    // amended: another repository's files named apart, read again with the tag, not reviewed or given to the code review.
    'CODE_REPORT_WORDS.placeBase': ['sonah', 'addfb3aab0494b04'],
    'CODE_REPORT_WORDS.placeEdits': ['sonah', '26b3892992616ecd'],
    // D124's review: the working folder's own repository given with --code-repo, read by its own rule (what Sonah reads).
    'CODE_REPORT_WORDS.givenHere': ['sonah', '278292d8c696480f'],
    'CODE_REPORT_WORDS.placeChangedOutside': ['absence', '5ee730546b3240df'],
    'CODE_REPORT_WORDS.placeOutsideFiles': ['absence', '98d3bf7b3b2c00cb'],
    'CODE_REPORT_WORDS.filesWhere': ['sonah', '42b944025cb6cf41'],
    'CODE_REPORT_WORDS.placeOfFile': ['other', '72b4107680247aea'],
    // D117 amended (the owner, 2026-10-18): the folders of no repository the session wrote to, which Sonah lists and did
    // not review; its writes not resolved, which Sonah cannot place and counts apart; and that Sonah does not yet see
    // every edit of helper agents or of scripts after a cd. Each says what Sonah did, could not tell or does not see.
    'CODE_REPORT_WORDS.folders': ['sonah', '9ff02dd83d284740'],
    'CODE_REPORT_WORDS.unresolved': ['sonah', 'c72e0dfb704493f6'],
    'CODE_REPORT_WORDS.unseenEdits': ['sonah', '680ef5a71b601d17'],
    'CODE_REPORT_WORDS.noWrite': ['absence', 'cb9d0c8f1c9d5191'],
    'CODE_REPORT_WORDS.noWrittenChange': ['sonah', '9f452e03f196459d'],
    // D123 (the beta.5 end-to-end smoke): no write of the session that Sonah can read, beside shell commands whose writes
    // it does not yet see: what Sonah found, never that the session wrote nothing.
    'CODE_REPORT_WORDS.noSeenWrite': ['sonah', '2f4c3308eef6e30a'],
    'CODE_REPORT_WORDS.files': ['sonah', 'eeebab5c6629b7e3'],
    // D105: the code review did not run, because its input was too large to send — Sonah's own record of a call it
    // did not make.
    'CODE_REPORT_WORDS.tooLarge': ['sonah', '9fcf9bdf915321eb'],
    'CODE_REPORT_WORDS.noAnswer': ['sonah', '26f91ad53490601b'],
    'CODE_REPORT_WORDS.earlierFiles': ['sonah', '970fecf82c9dad3c'],
    'CODE_REPORT_WORDS.noRoot': ['sonah', '59d9299ab34cbb0e'],
    'CODE_REPORT_WORDS.notRun.code_step_backend': ['sonah', '6a47029f8580ecc1'],
    // D118 (a): the first screen's no-code sentence, its closed reasons and the folder's label.
    'CODE_REPORT_WORDS.notReviewed': ['sonah', 'a922d242eef531f8'],
    'CODE_REPORT_WORDS.notReviewedReasons.step_off': ['sonah', '549d58058f1e47da'],
    'CODE_REPORT_WORDS.notReviewedReasons.backend': ['sonah', '7295eb2bc05f3c4e'],
    'CODE_REPORT_WORDS.notReviewedReasons.no_folder': ['sonah', '7c3ea08c4aeac36a'],
    'CODE_REPORT_WORDS.notReviewedReasons.no_write': ['absence', 'f5b98ca0026cc73e'],
    // D123: the same, on the first screen, with what you can do.
    'CODE_REPORT_WORDS.notReviewedReasons.no_seen_write': ['sonah', '6cac7cdb7e538e37'],
    // D124's review: the same with a repository given with --code-repo: what Sonah found there, and no way out again.
    'CODE_REPORT_WORDS.notReviewedReasons.no_seen_write_given': ['sonah', 'bae3c3fcf3d5a685'],
    'CODE_REPORT_WORDS.notReviewedReasons.no_written_change': ['sonah', '24350af1105cb607'],
    'CODE_REPORT_WORDS.notReviewedReasons.no_file': ['sonah', 'a8c8ddf7f59b5d14'],
    'CODE_REPORT_WORDS.notReviewedReasons.none_shown': ['sonah', 'c0b6c9cc9d69826e'],
    'CODE_REPORT_WORDS.notReviewedReasons.too_large': ['sonah', '570c911136d2bf8b'],
    'CODE_REPORT_WORDS.notReviewedReasons.no_answer': ['sonah', '712a091118f0f89d'],
    'CODE_REPORT_WORDS.notReviewedReasons.none_seen': ['sonah', 'effcb94a75e18648'],
    // D122 (a review low of D118): a record of an earlier code step that made no request and did not record why.
    'CODE_REPORT_WORDS.notReviewedReasons.unknown': ['sonah', '1f5667e4c3c92383'],
    'CODE_REPORT_WORDS.notReviewedFolder': ['other', '2766aafa590593bb'],
    'CODE_REPORT_WORDS.noFile': ['sonah', '4c382f7599adafe9'],
    // D111's second review: it names no list, since the counts of the item-by-item check can be among the lines after it
    // (no part of what the code review did not cover); a coverage short only by those counts prints no coverage line.
    'CODE_REPORT_WORDS.coverage.partial': ['sonah', '8e100c64f9817b3d'],
    'CODE_REPORT_WORDS.coverage.missing': ['sonah', '81ef5276df6d9170'],
    'CODE_REPORT_WORDS.besideGroup': ['other', '61049bdadd3b9945'],
    'CODE_REPORT_WORDS.restGroup': ['other', 'ae75aede1c175917'],
    'CODE_REPORT_WORDS.questionsGroup': ['other', '3f5d4bac62efed8a'],
    'CODE_REPORT_WORDS.footerGroup': ['sonah', '36af9118fb5c85a3'],
    'CODE_REPORT_WORDS.finding': ['other', '0392899d1ebf8f82'],
    'CODE_REPORT_WORDS.codeNow': ['other', '444be6b4da13b541'],
    'CODE_REPORT_WORDS.codeBefore': ['other', '850875bdfe80df25'],
    'CODE_REPORT_WORDS.sessionSaid': ['other', 'b33ce342229d6363'],
    'CODE_REPORT_WORDS.input': ['other', 'd88848c95122cbf6'],
    'CODE_REPORT_WORDS.trace': ['other', 'a14349a9a33e6710'],
    'CODE_REPORT_WORDS.foundBy': ['other', '6c1458561521a3c1'],
    'CODE_REPORT_WORDS.concerns': ['other', 'b707cacce1159da1'],
    'CODE_REPORT_WORDS.checkLabel': ['other', '58b32f4ccd734390'],
    'CODE_REPORT_WORDS.checkHolds': ['other', '642ed913890d71d6'],
    'CODE_REPORT_WORDS.checkConfirmed': ['other', '66f99486f19e88a1'],
    'CODE_REPORT_WORDS.checkUnconfirmed': ['sonah', '903c4a21c968f5b7'],
    'CODE_REPORT_WORDS.premiseSources.repository': ['other', 'c9ba1ebdf3580141'],
    'CODE_REPORT_WORDS.premiseSources.language': ['other', '8c46b3e8c2231146'],
    'CODE_REPORT_WORDS.premiseSources.outside': ['sonah', '6d0a57bc0bffb85f'],
    'CODE_REPORT_WORDS.fromFinding': ['other', 'aa2222121c0bd088'],
    'CODE_REPORT_WORDS.fromFindingWords': ['sonah', 'b73d2376d23263f0'],
    'CODE_REPORT_WORDS.withheldLabel': ['sonah', '7f5ad98195ddf9d5'],
    'CODE_REPORT_WORDS.withheldNoText': ['sonah', '2e0c57a4e3b1f4a4'],
    'CODE_REPORT_WORDS.withheldWhat.finding': ['other', 'c6d2e5b5f87fdd4d'],
    'CODE_REPORT_WORDS.withheldWhat.question': ['other', '7614e87098267809'],
    'CODE_REPORT_WORDS.withheldReasons.malformed': ['sonah', '7748730fd68cc232'],
    'CODE_REPORT_WORDS.withheldReasons.evidence_grounding_failed': ['sonah', '954267f068e838a4'],
    'CODE_REPORT_WORDS.withheldReasons.out_of_scope': ['sonah', '0dde1bca08befb16'],
    'CODE_REPORT_WORDS.withheldReasons.verify_refuted': ['sonah', 'fa546987560555b0'],
    'CODE_REPORT_WORDS.withheldReasons.verify_cannot_tell': ['sonah', '4e65ff375a64e4ed'],
    'CODE_REPORT_WORDS.withheldReasons.verify_unexecuted': ['sonah', 'f56ca32b97e0d56a'],
    'CODE_REPORT_WORDS.withheldReasons.false_premise': ['sonah', 'e89c85212fd39441'],
    'CODE_REPORT_WORDS.withheldReasons.request_failed': ['sonah', '3738e042550d9d22'],
    'CODE_REPORT_WORDS.withheldReasons.request_too_large': ['sonah', '3a4c8c3cf5f2dc29'],
    'CODE_REPORT_WORDS.unrepairedReasons.malformed': ['sonah', '0e6354f446c53029'],
    'CODE_REPORT_WORDS.unrepairedReasons.evidence_grounding_failed': ['sonah', '817ba650b48c0d60'],
    // D107 (F3a, read 2026-10-17, read again after each of its two reviews): whether an item of the one repair matched
    // an item, by identity, one to one; each says only what Sonah compared, could not compare, did not check or could
    // not match, which Sonah's own record proves.
    'CODE_REPORT_WORDS.unrepaired.unmatched.finding': ['sonah', 'b5e5f6e513e3c552'],
    'CODE_REPORT_WORDS.unrepaired.unmatched.question': ['sonah', 'd6776f55155fa695'],
    'CODE_REPORT_WORDS.unrepaired.uncompared.finding': ['sonah', '4a3bd59d8393ec4b'],
    'CODE_REPORT_WORDS.unrepaired.uncompared.question': ['sonah', '6d4fc2d32f0bea72'],
    'CODE_REPORT_WORDS.unrepaired.ambiguous.finding': ['sonah', 'e681237eea5df778'],
    'CODE_REPORT_WORDS.unrepaired.ambiguous.question': ['sonah', '39707adc34f2ea54'],
    'CODE_REPORT_WORDS.unrepaired.matched_past_limit.finding': ['sonah', '23fd5288954246dc'],
    'CODE_REPORT_WORDS.unrepaired.matched_past_limit.question': ['sonah', '163099fceb621e39'],
    'CODE_REPORT_WORDS.unrepaired.unnamed.finding': ['sonah', '9df342d20777fff1'],
    'CODE_REPORT_WORDS.unrepaired.unnamed.question': ['sonah', '80570a5c56de5c02'],
    'CODE_REPORT_WORDS.unrepaired.unplaced.finding': ['sonah', '8015b17084fbd347'],
    'CODE_REPORT_WORDS.unrepaired.brought': ['sonah', 'b2de17922aaaf3d1'],
    'CODE_REPORT_WORDS.unrepaired.failed': ['sonah', '98a786098afc724a'],
    'CODE_REPORT_WORDS.unrepaired.spent': ['sonah', '5b0286560000f005'],
    'CODE_REPORT_WORDS.unrepaired.unasked': ['sonah', '8eb17cbd14c40bfb'],
    'CODE_REPORT_WORDS.unrepaired.too_large': ['sonah', 'f56d9619b2d892da'],
    // D111 (F3b): a finding of the code review's accounting, for which Sonah asks no repair (the fate record proves it).
    // Its review read it again with the check named by the kinds in scope.
    'CODE_REPORT_WORDS.unrepaired.accounted': ['sonah', 'd97dd2a2bf6038d6'],
    // An earlier report's (code-pass/10), read at the beta.2 release check and kept for those reports, byte for byte.
    'CODE_REPORT_WORDS.unrepaired.different.finding': ['sonah', 'f587b5748899bffa'],
    'CODE_REPORT_WORDS.unrepaired.different.question': ['sonah', '237911adbf4bdf5c'],
    'CODE_REPORT_WORDS.unrepaired.absent.finding': ['sonah', '17b60691fa973ffe'],
    'CODE_REPORT_WORDS.unrepaired.absent.question': ['sonah', '37bb46adc46ac3fa'],
    'CODE_REPORT_WORDS.unrepaired.repeated.finding': ['sonah', '2b7d055a9efbbc9f'],
    'CODE_REPORT_WORDS.unrepaired.repeated.question': ['sonah', '0124abf65801bbb8'],
    'CODE_REPORT_WORDS.refutations.incorrect': ['sonah', '0b1e28eea1c388e7'],
    'CODE_REPORT_WORDS.refutations.step_unsupported': ['sonah', 'c7e42bead7c339bb'],
    'CODE_REPORT_WORDS.refutations.mitigation_shown': ['sonah', '05289734f611bede'],
    'CODE_REPORT_WORDS.refutations.input_unreachable': ['sonah', 'd843786800f576e1'],
    'CODE_REPORT_WORDS.refutations.rests_on_unshown_code': ['sonah', '3cda3e2b40fba52b'],
    'CODE_REPORT_WORDS.refutations.out_of_scope': ['sonah', '4021130e27e0d17a'],
    'CODE_REPORT_WORDS.refutations.unverifiable': ['sonah', 'a1188a1d90fa6941'],
    'CODE_REPORT_WORDS.refutations.not_against_goal': ['sonah', 'b1afe9ab53c9d374'],
    'CODE_REPORT_WORDS.causes.key_missing': ['sonah', '674887f31a73a91a'],
    'CODE_REPORT_WORDS.causes.key_outside_contract': ['other', '6a17cbf777b1d300'],
    'CODE_REPORT_WORDS.causes.value_outside_list': ['other', 'b5228dc96e0797b1'],
    // D107's review (read 2026-10-17): a list past its most items gives this cause too.
    'CODE_REPORT_WORDS.causes.text_over_limit': ['other', '7b23cf4a88e040e9'],
    'CODE_REPORT_WORDS.causes.dossier_key_unknown': ['sonah', '88130f2f8c2faaac'],
    'CODE_REPORT_WORDS.causes.ask_key_required': ['other', '1b4953ae398603d2'],
    'CODE_REPORT_WORDS.causes.claim_key_required': ['other', '23a5c852fdab0b19'],
    'CODE_REPORT_WORDS.causes.quote_ungrounded': ['sonah', '6f4ce4f7500b8a64'],
    'CODE_REPORT_WORDS.causes.anchor_off_quote': ['absence', 'd1ffe6d7289af4d1'],
    'CODE_REPORT_WORDS.causes.file_not_readable': ['sonah', '3b3cd8881e9159c5'],
    'CODE_REPORT_WORDS.causes.out_of_scope': ['sonah', '0dde1bca08befb16'],
    // D122 (d) (read 2026-10-19): what Sonah could not tell of a relative path that more than one place of the change
    // holds.
    'CODE_REPORT_WORDS.causes.path_ambiguous': ['sonah', 'a5d7e87df01507fa'],
    'CODE_REPORT_WORDS.causes.shape': ['sonah', '450be7de0ad6f07b'],
    'CODE_REPORT_WORDS.causes.receipt_ungrounded': ['sonah', 'b9767f2a7e5e6b63'],
    'CODE_REPORT_WORDS.causes.support_off_anchor': ['sonah', 'bb08adbf23c8b957'],
    'CODE_REPORT_WORDS.causes.support_off_trace': ['sonah', '85ad61c5d9675733'],
    'CODE_REPORT_WORDS.causes.refutation_uncited': ['sonah', '9265d4c60fd568c0'],
    'CODE_REPORT_WORDS.kinds.bug': ['other', '4cd693d9f484f47b'],
    'CODE_REPORT_WORDS.kinds.missed_case': ['other', '68747d36b552ca8f'],
    'CODE_REPORT_WORDS.kinds.weak_test': ['other', '03d8cec17f6062ec'],
    'CODE_REPORT_WORDS.kinds.contract_break': ['other', 'f9eff82a4de5d062'],
    'CODE_REPORT_WORDS.kinds.ask_not_met': ['absence', '38265e5f9a30397e'],
    'CODE_REPORT_WORDS.kinds.rule_break': ['other', '4ff37898222cc532'],
    'CODE_REPORT_WORDS.kinds.claim_false': ['other', '7c3ad0ecdf813104'],
    'CODE_REPORT_WORDS.lenses.behaviour': ['other', 'aafe609f4f899a24'],
    'CODE_REPORT_WORDS.lenses.tests': ['other', '59830ebc3a418411'],
    'CODE_REPORT_WORDS.lenses.contracts': ['other', 'b094db7ce2f99cbc'],
    'CODE_REPORT_WORDS.lenses.ask': ['other', '3be5f28cf025989a'],
    'CODE_REPORT_WORDS.lenses.rules': ['other', 'c53b0f3aaea46bbe'],
    'CODE_REPORT_WORDS.lenses.claims': ['other', '7192af478c13bfd3'],
    'CODE_REPORT_WORDS.states.not_shown': ['sonah', '57f1a79c689e5279'],
    'CODE_REPORT_WORDS.states.binary': ['other', '9a3a45d01531a20e'],
    'CODE_REPORT_WORDS.states.credential_path': ['sonah', 'e14c6383f8f15bbe'],
    'CODE_REPORT_WORDS.states.harness_home': ['sonah', 'ab814b3504371e48'],
    'CODE_REPORT_WORDS.states.oversize': ['other', 'fe6dcce7e94d1d3e'],
    'CODE_REPORT_WORDS.states.changed_since_session': ['other', '4c6ad4570ce35ab9'],
    'CODE_REPORT_WORDS.states.deleted': ['absence', '446c2f32dca2b93b'],
    'CODE_REPORT_WORDS.states.outside_root': ['other', '6c182693ae820f4d'],
    'CODE_REPORT_WORDS.states.unreadable': ['sonah', '89440de5d02fd691'],
    'CODE_REPORT_WORDS.footerKinds.listed_by_name': ['sonah', 'f192870c62f3ddde'],
    'CODE_REPORT_WORDS.footerKinds.clipped': ['sonah', '1bd187086b4ce738'],
    'CODE_REPORT_WORDS.footerKinds.withheld': ['sonah', '5df5ed6b08b8dd52'],
    'CODE_REPORT_WORDS.footerKinds.failed': ['sonah', '2e2430a0940e0fcb'],
    // D117: read again, with Sonah's own folders among the places whose writes Sonah counts but did not review.
    'CODE_REPORT_WORDS.footerKinds.outside_root': ['sonah', '25f2b1f80a67bf77'],
    'CODE_REPORT_WORDS.footerKinds.source_changed': ['sonah', 'd6c3b72bfb69ae49'],
    'CODE_REPORT_WORDS.changedSince': ['sonah', '613ff955b24d0be7'],
    // D105: what Sonah left out of the code review's input, and what the code review saw short of whole (the request's
    // manifest and the review's reading record prove each); a file's line ranges state no negative fact.
    'CODE_REPORT_WORDS.footerKinds.too_large': ['sonah', '0f14e4de84a43a63'],
    'CODE_REPORT_WORDS.footerKinds.commands_left_out': ['sonah', 'e42649854857f4dd'],
    // D111 (F3b): the items in scope that the code review's item-by-item check did not examine in a way that Sonah could
    // use (its entries prove it: each counted item is `not_examined` or `missing`): what that check gave Sonah, never that
    // an ask is not done, that a statement or a decision is wrong, or that no other check of the code review covers it
    // (D111's review: a published finding can follow from a counted item).
    'CODE_REPORT_WORDS.unaccounted.ask.person': ['sonah', 'c53e917e6f63a27a'],
    'CODE_REPORT_WORDS.unaccounted.ask.helper_brief': ['sonah', '75c37d212371b51d'],
    'CODE_REPORT_WORDS.unaccounted.ask.other': ['sonah', '29f311a0d515e978'],
    'CODE_REPORT_WORDS.unaccounted.written_claim': ['sonah', '30158e97e5853131'],
    'CODE_REPORT_WORDS.unaccounted.not_acting': ['sonah', 'b4cb838f5104eb97'],
    'CODE_REPORT_WORDS.seenInPart': ['sonah', '140182e49db415d5'],
    'CODE_REPORT_WORDS.hunksOnly': ['sonah', 'c74b5f1086bab774'],
    // D105 (its review): a file of the change the code review saw whole as it is now, whose hunks' rows on the earlier
    // side the request did not show (the manifest proves it, and no Read shows a file as it was): what the code review
    // did not see, never that the change lacks anything.
    'CODE_REPORT_WORDS.wholeNotBefore': ['sonah', '913e5628c344ade4'],
    'CODE_REPORT_WORDS.rulesInPart': ['sonah', 'bba4ba5acaa30660'],
    'CODE_REPORT_WORDS.rulesNotSeen': ['sonah', 'dca6c05f5b4c4a9f'],
    // D105: a file the code review read whose lines Sonah could not tell (the reading record proves the read, by a Read
    // that did not fail; a failed one is kept apart and proves none): said as what Sonah could not tell, never as a file
    // it did not see.
    'CODE_REPORT_WORDS.linesUnknown': ['sonah', '2b223e65c356d45b'],
    'CODE_REPORT_WORDS.linesOf': ['other', '7c33df025e147401'],
    'CODE_REPORT_WORDS.outsideLine': ['sonah', '59e3850475f1d81b'],
    'CODE_REPORT_WORDS.homeLine': ['sonah', '66bd76737e3b9c8a'],
    'CODE_REPORT_WORDS.parts.review': ['other', '8994d23554901273'],
    'CODE_REPORT_WORDS.parts.repair': ['other', '49294791779ba4fa'],
    'CODE_REPORT_WORDS.parts.verify': ['other', '0a7e245c177c09cf'],
    'CODE_REPORT_WORDS.parts.batch': ['other', '238cd16f10e2edad'],
    'CODE_REPORT_WORDS.parts.account': ['other', '64d3369a4812e52e'],
    'CODE_REPORT_WORDS.parts.check': ['other', 'f4312cd5515196f9'],
    'CODE_REPORT_WORDS.parts.lens': ['other', 'ab7b1c84c8e979c9'],
    'CODE_REPORT_WORDS.parts.check_challenge': ['other', 'fcc1e69846e0de52'],
    'CODE_REPORT_WORDS.parts.finding_challenge': ['other', 'b7ff35c299985d56'],
    'CODE_REPORT_WORDS.quoteUnchecked': ['sonah', '9dc13fc7e608ded4'],
    'CODE_REPORT_WORDS.noFindings': ['sonah', '57e5c1e0b6c4ff63'],
    'CODE_REPORT_WORDS.proposedNone': ['sonah', '7c3e869134856fb9'],
    'CODE_REPORT_WORDS.notPublished': ['sonah', '219c968198f05b36'],
    'CODE_REPORT_WORDS.rowKinds.promises': ['other', 'f77b9be93619f981'],
    'CODE_REPORT_WORDS.rowKinds.writtenClaims': ['other', '4272f2379f76120a'],
    'CODE_REPORT_WORDS.rowKinds.findings': ['other', 'db7efc101226d10d'],
    'CODE_REPORT_WORDS.rowKinds.requirements': ['other', 'fded2c87d5b5b43f'],
    'CODE_REPORT_WORDS.rowKinds.decisions': ['other', 'b28d4acc0a004e98'],
    'CODE_REPORT_WORDS.rowKinds.failures': ['other', '616b41ef3627670b'],
    'CODE_REPORT_WORDS.rowKinds.pivots': ['other', '3f7d80944160dc4f'],
  }),
  'packages/evidence/src/ledger.js': Object.freeze({
    'RESULT_OUTCOME_WORDS.ran-exit-0.exit': ['other', '34fce92958932f0f'],
    'RESULT_OUTCOME_WORDS.ran-completed.typed': ['other', '0ff26ae44de0c45f'],
    'RESULT_OUTCOME_WORDS.ran-failed.exit': ['other', 'c6a7194406e1f3fb'],
    'RESULT_OUTCOME_WORDS.ran-failed.flag': ['other', '8222a127543c8195'],
    'RESULT_OUTCOME_WORDS.ran-failed.typed': ['other', 'a15ed68fa14fe301'],
    'RESULT_OUTCOME_WORDS.did-not-run.denial': ['absence', 'd930c93872ea15dd'],
    'RESULT_OUTCOME_WORDS.no-terminal-status.background': ['absence', 'f2f8fac228d09e11'],
    'RESULT_OUTCOME_WORDS.no-terminal-status.none': ['absence', '327c95f44d7fc1ff'],
    'RESULT_OUTCOME_WORDS.no-terminal-status.interrupted': ['absence', '99723baee8b968e1'],
    'RESULT_OUTCOME_WORDS.no-terminal-status.cancelled': ['absence', '2997e74044b29841'],
    'RESULT_OUTCOME_WORDS.no-terminal-status.command-failed': ['absence', '955a8fabf98ec0a6'],
    'RESULT_OUTCOME_WORDS.no-terminal-status.command-stopped': ['absence', '101be7459e20f54a'],
    'RESULT_OUTCOME_WORDS.failed-or-refused.untyped': ['absence', 'a461d975ea269ae3'],
    'RESULT_OUTCOME_WORDS.output-no-status.output': ['absence', '1674704e2b1d9e97'],
    'RESULT_OUTCOME_WORDS.output-no-status.unread': ['absence', '950af68203f493e6'],
    'RESULT_OUTCOME_WORDS.end-unread.background': ['sonah', 'dd8c70b99d78ac5d'],
    'RESULT_OUTCOME_WORDS.end-unread.unchecked': ['sonah', 'dd8c70b99d78ac5d'],
    'STOPPED_WORDS': ['absence', '3f64ae2cd4029ae2'],
    'shellWriteWords': ['absence', 'c38a623c6edf86c3'],
  }),
  'packages/render/report-words.js': Object.freeze({
    'REPORT_ANSWER_WORDS.accept': ['other', '5fa95309fd7fd714'],
    'REPORT_ANSWER_WORDS.change': ['other', 'c937cf61cf63ef68'],
    'REPORT_ANSWER_WORDS.clarify': ['other', '4eecaa8cfade2afd'],
    'REPORT_CAUSE_WORDS.no_windows': ['sonah', 'ec5608d80d7492bf'],
    'REPORT_CAUSE_WORDS.windows_incomplete': ['sonah', '9a6dbb98d3db8c45'],
    'REPORT_CAUSE_WORDS.input_limit': ['sonah', 'ab98007a9aefd9be'],
    'REPORT_CAUSE_WORDS.carry_capped': ['sonah', '26dfa76a94f1c62c'],
    // D119: counted by kind, said as what Sonah holds.
    'REPORT_CAUSE_WORDS.incomplete_inventory': ['sonah', '1045995b276c999a'],
    'REPORT_CAUSE_WORDS.observations_incomplete': ['sonah', 'b209aae8a82d05db'],
    'REPORT_CAUSE_WORDS.unsupported_message': ['sonah', '809c590a89586414'],
    'REPORT_CAUSE_WORDS.write_outcome_unknown': ['sonah', 'c6f48a679d0a873c'],
    'REPORT_CAUSE_WORDS.command_outcome_unknown': ['sonah', 'f1e113b796e3a115'],
    'REPORT_COLUMN_REASON_WORDS.instructions_partial': ['sonah', '5c03c7d5f1477e79'],
    'REPORT_COLUMN_REASON_WORDS.column_unchecked': ['sonah', '57a8137eb2eeb9d3'],
    'REPORT_COLUMN_REASON_WORDS.ambiguous_authority': ['sonah', 'd09bdee106021e03'],
    'REPORT_COLUMN_REASON_WORDS.receipt_rejected': ['sonah', 'f644194f3f06f861'],
    'REPORT_COLUMN_REASON_WORDS.unsettled': ['sonah', '609247e07cf5a877'],
    'REPORT_COLUMN_REASON_WORDS.unreviewed_scope': ['sonah', '59d84ea7e112ace4'],
    'REPORT_COLUMN_REASON_WORDS.decision_column_refuted': ['sonah', 'cab87458b46dbc67'],
    'REPORT_CONTRADICTION_SOURCES.result': ['other', '8528efba24211256'],
    'REPORT_CONTRADICTION_SOURCES.human_message': ['other', 'd181309388e6c2de'],
    'REPORT_CONTRADICTION_SOURCES.file_content': ['other', '88993f7176362932'],
    'REPORT_CONTRADICTION_SOURCES.project_instructions': ['other', '704014d3e8dc4b7f'],
    'REPORT_CONTRADICTION_SOURCES.own_written': ['other', 'c0b1197a514ceb75'],
    'REPORT_COUNT_WORDS.tier': ['other', 'db52fb70776f3dae'],
    'REPORT_COUNT_WORDS.folded': ['other', '7b6aa0e3b08fdc7a'],
    'REPORT_COUNT_WORDS.prompt': ['other', 'e82b97d54a0df042'],
    'REPORT_COUNT_WORDS.noAsk': ['sonah', '58298dae5aab9785'],
    'REPORT_COUNT_WORDS.mustActLead': ['other', '611791d7de1d8842'],
    'REPORT_COUNT_WORDS.more': ['other', '5c111c59c74a1ee5'],
    'REPORT_COUNT_WORDS.emptyTiers': ['sonah', '14f0f366acaf5dd3'],
    // D133 (R2): the sentence after it, read apart: a caution about what the count means, no negative fact.
    'REPORT_COUNT_WORDS.notCorrect': ['other', 'fcafa7052216299a'],
    // D113 amended: the items about code outside the evaluated session, and the tag after a label.
    'REPORT_COUNT_WORDS.outside': ['absence', '93f1e899d8f79762'],
    'REPORT_COUNT_WORDS.outsideLabel': ['absence', '7e6c2bbb92dde9b4'],
    'REPORT_DID_WORDS.fileTypes.added': ['other', '11507a0e2f5e69d5'],
    'REPORT_DID_WORDS.fileTypes.deleted': ['other', '1185f37d33b0f89e'],
    'REPORT_DID_WORDS.fileTypes.modified': ['other', 'd67e2e944994496c'],
    'REPORT_DID_WORDS.filesByAsk': ['other', '36426a1cdd689198'],
    'REPORT_DID_WORDS.askGroup': ['other', 'a4785ad8a0ba2a2b'],
    'REPORT_DID_WORDS.noAskGroup': ['sonah', '394df59324253911'],
    'REPORT_DID_WORDS.moreFiles': ['sonah', '915fa112a4ca3b9d'],
    'REPORT_DID_WORDS.outside': ['other', 'be5faaceb8bce786'],
    'REPORT_DID_WORDS.notInChange': ['sonah', 'a0266f784a263cf8'],
    // D118 (b): the paths the recording does not resolve, counted apart.
    'REPORT_DID_WORDS.unresolved': ['sonah', '6b0d0793bce1bc29'],
    // D113 amended: the files list's line of the files outside the evaluated session.
    'REPORT_DID_WORDS.outsideSession': ['absence', '9702577551cc2d7a'],
    'REPORT_DID_WORDS.unconfirmed': ['absence', '9fc4a18fe738d4d6'],
    'REPORT_DID_WORDS.moreRuns': ['other', '0128aa317c5e8c1c'],
    'REPORT_DID_WORDS.runsCut': ['sonah', 'c366a0dc88b040d3'],
    'REPORT_DID_WORDS.neverRan': ['sonah', '1e682f44d8d1c319'],
    'REPORT_DID_WORDS.noRuns': ['sonah', 'a174cb3323a8a49d'],
    'REPORT_DID_WORDS.uncoveredExit': ['other', '3509f6a5551dbb39'],
    'REPORT_DID_WORDS.handling.acted-on': ['other', 'de9f37b9b74c5cdb'],
    'REPORT_DID_WORDS.handling.told-human': ['other', '2c4663a04ad6f36f'],
    'REPORT_DID_WORDS.handling.passed-over': ['absence', '8d55635a4f220a7a'],
    'REPORT_DID_WORDS.handling.not-checked': ['sonah', '62849b956e0e29ae'],
    'REPORT_DID_WORDS.claimStatus.checked': ['other', 'e61a3d78c65133c7'],
    'REPORT_DID_WORDS.claimStatus.contradicted': ['other', '1af293e87a0170d4'],
    'REPORT_DID_WORDS.claimStatus.contradictedByCode': ['other', '06b692c04a958c4e'],
    'REPORT_DID_WORDS.claimStatus.notChecked': ['sonah', '62849b956e0e29ae'],
    'REPORT_DID_WORDS.claimStatus.incomplete': ['sonah', 'a276f504f9179c21'],
    'REPORT_DID_WORDS.moreClaims': ['sonah', 'b266f2ee475373f0'],
    'REPORT_DID_WORDS.noClaims': ['sonah', '62dc0ae003ddb12a'],
    'REPORT_DID_WORDS.written': ['other', 'b0e3e280447a1f5b'],
    'REPORT_DID_WORDS.noLeftOut': ['sonah', 'e79cb1a7752ee1ad'],
    'REPORT_DID_WORDS.noSettled': ['sonah', 'c039008bcc2a5b89'],
    'REPORT_DID_WORDS.noFiles': ['sonah', 'ee27f100cb4f742a'],
    // D123: the empty Files section where no git base names a repository, and where Sonah found no write that it can read
    // beside shell commands: what Sonah found or does not see.
    'REPORT_DID_WORDS.noFilesHere': ['sonah', 'bf7c34880e9838a3'],
    'REPORT_DID_WORDS.noSeenFiles': ['sonah', 'abd4446d0f1e9de9'],
    'REPORT_DISCLOSURE_WORDS.claim.self_corrected': ['other', '82817c73ac18c3bb'],
    'REPORT_DISCLOSURE_WORDS.claim.helper_internal': ['absence', 'fa04ba63943d3959'],
    'REPORT_DISCLOSURE_WORDS.claim.disclosed': ['other', '1243a64614a0a7b5'],
    'REPORT_DISCLOSURE_WORDS.edit.self_corrected': ['other', '7f50539322785d10'],
    'REPORT_DISCLOSURE_WORDS.edit.disclosed': ['other', '1243a64614a0a7b5'],
    'REPORT_DISCLOSURE_WORDS.edit.helper_internal': ['absence', 'da7abb45bbbc654f'],
    'REPORT_FOOTER_WORDS.provenance': ['other', '3fc93dbb89545c4c'],
    'REPORT_FOOTER_WORDS.legend': ['other', '26f583f9d25dae5f'],
    'REPORT_FOOTER_WORDS.legendCodeReview': ['other', '6e582de3443fc0a0'],
    'REPORT_FOOTER_WORDS.legendSessionReview': ['other', '3e67e7c68683ca0c'],
    'REPORT_FOOTER_WORDS.triageLegend': ['sonah', 'f0fe6e71c3188ed5'],
    'REPORT_FOOTER_WORDS.youMeans': ['other', 'ea8ebe9cada1ea1c'],
    'REPORT_FOOTER_WORDS.share': ['other', '9111463aeb68682a'],
    'REPORT_FOOTER_WORDS.answerIntro': ['other', 'df029e4c863734a6'],
    'REPORT_FOOTER_WORDS.answerParts': ['other', 'c681158a1d865db6'],
    'REPORT_FOOTER_WORDS.answerReport': ['other', 'b210fe8609f5d5d8'],
    'REPORT_FOOTER_WORDS.answerCommand': ['other', '313e31623bbe4e33'],
    // D129 (C7): what the review cost, from its run record: Sonah's own calls ("no model calls" is a fact about Sonah's
    // run, counted by its usage record, never about the recording), and the usage limits in the footer's words.
    'REPORT_FOOTER_WORDS.usage': ['sonah', '553686bfb5517f32'],
    'REPORT_FOOTER_WORDS.usageRuns': ['sonah', 'b273121b8f901e0b'],
    'REPORT_LIMIT_WORDS.five_hour': ['other', '4e7d3a6498490fef'],
    'REPORT_LIMIT_WORDS.seven_day': ['other', 'e890697bda076c04'],
    'REPORT_LIMIT_WORDS.seven_day_overage_included': ['other', 'a74fcf9a8eca5fce'],
    'REPORT_LIMIT_WORDS.other': ['other', '40215e47340331fa'],
    'REPORT_GAP_WORDS.decide_unsettled': ['sonah', 'de3fd39258dc57fd'],
    'REPORT_GAP_WORDS.window_incomplete': ['sonah', '101361227c116acd'],
    'REPORT_GAP_WORDS.proposal_unreadable': ['sonah', 'daaf5fa1428b2eda'],
    'REPORT_GAP_WORDS.reading_capped': ['sonah', 'cd26404a3414fccf'],
    'REPORT_GAP_WORDS.review_unattributed': ['sonah', '73bc04e58d9b027d'],
    'REPORT_GAP_WORDS.no_reviewable_event': ['sonah', 'd73e3bc5b6f199f0'],
    'REPORT_GAP_WORDS.gap_declared': ['sonah', '1383b1ca0d377966'],
    'REPORT_GAP_WORDS.instruction_omitted': ['absence', '3ce12f40296c44a4'],
    'REPORT_GAP_WORDS.delegation_unlinked': ['sonah', '20628959801f0371'],
    'REPORT_GAP_WORDS.gap_unplaced': ['sonah', 'b6fc96b9fe09f472'],
    'REPORT_GAP_WORDS.limit_unattributed': ['sonah', '525513dbdf6d6ecd'],
    'REPORT_HEADER_WORDS.review': ['other', '276c2dd1e99366ec'],
    'REPORT_HEADER_WORDS.filesChanged': ['other', '657c0f89019732e2'],
    'REPORT_HEADER_WORDS.change': ['other', '32ebc86c88a4a71a'],
    'REPORT_HEADER_WORDS.commands': ['other', '4253b50ef4d9cc73'],
    'REPORT_HEADER_WORDS.commit': ['other', '6c5161927a41e54e'],
    'REPORT_HEADER_WORDS.notCommitted': ['other', '35568bed5a8d89aa'],
    'REPORT_HEADER_WORDS.runsAfterEdit': ['other', '828aba51f13011c1'],
    'REPORT_HEADER_WORDS.results': ['other', 'e42926f39b84b602'],
    'REPORT_HEADER_WORDS.noRunAfterEdit': ['sonah', '843aa544078de3ce'],
    'REPORT_HEADER_WORDS.refusedAfterEdit': ['absence', '5e6c4d590d662069'],
    'REPORT_HEADER_WORDS.unclearAfterEdit': ['absence', '3b9c67b43008d512'],
    'REPORT_HEADER_WORDS.reviewIncomplete': ['sonah', 'ec3c29ad8c9232fe'],
    // D126 and D127 (B10d): beside the title, the recordings Sonah read (positive), or the part Sonah did not read.
    'REPORT_HEADER_WORDS.continued': ['other', '25655e7f09aa92c0'],
    'REPORT_HEADER_WORDS.continuedUnread': ['sonah', '5f8f9db7a1439996'],
    // D133 (R2): the short line beside the title when Sonah did not read the earlier part: a positive fact of the session.
    'REPORT_HEADER_WORDS.continuedPart': ['other', '4d6387e20e796633'],
    'REPORT_HEADER_WORDS.notCheckedLead': ['sonah', '4788f4a16b3c8c4b'],
    // D118 (a): beside the first screen's no-code sentence, with no code step that ran.
    'REPORT_HEADER_WORDS.noCodeImpact': ['sonah', 'e6fdf4bf5a94c92c'],
    'REPORT_HEADER_WORDS.noGitHubRemote': ['sonah', 'ae49d38f2dd98e32'],
    'REPORT_HEADER_WORDS.notOnGitHub.new': ['absence', '7c694862ddb1ecac'],
    'REPORT_HEADER_WORDS.notOnGitHub.old': ['absence', '8e90f66c6105106e'],
    'REPORT_HEADER_WORDS.notOnGitHub.both': ['absence', 'a255407dcc1d7dfb'],
    'REPORT_ITEM_WORDS.impact': ['other', 'f687f79b0668b83d'],
    'REPORT_ITEM_WORDS.action': ['other', '7d9fda4ea8538475'],
    'REPORT_ITEM_WORDS.where': ['other', '02cc020f791cdbd4'],
    'REPORT_ITEM_WORDS.agentSaid': ['other', 'e0ee2b22ea277a30'],
    'REPORT_ITEM_WORDS.agentTold': ['other', 'effa1fbb9c1d292b'],
    'REPORT_ITEM_WORDS.youSaid': ['other', '2d557eaf73cb5649'],
    'REPORT_ITEM_WORDS.youAsked': ['other', '5e7e460da3f80eea'],
    'REPORT_ITEM_WORDS.agentDid': ['other', 'ebd9b4d47ff61941'],
    'REPORT_ITEM_WORDS.evidence': ['other', '03867aea70acaf4c'],
    'REPORT_ITEM_WORDS.why': ['other', '462b89efbab7d5cc'],
    'REPORT_ITEM_WORDS.forExample': ['other', '652744a2ab28954b'],
    'REPORT_ITEM_WORDS.codeNow': ['other', '3f91758b8c47624f'],
    'REPORT_ITEM_WORDS.codeBefore': ['other', '579b1e3d572c4275'],
    'REPORT_ITEM_WORDS.trace': ['other', 'c3ef49a37b6acf62'],
    'REPORT_ITEM_WORDS.check': ['other', '2b564dc214699b51'],
    'REPORT_ITEM_WORDS.restsOn': ['other', 'c83d391afe09f06a'],
    'REPORT_ITEM_WORDS.restsOutside': ['sonah', '15de1dac95bbd1ea'],
    'REPORT_ITEM_WORDS.rowId': ['other', '9b8d43a6e2e69cb7'],
    'REPORT_ITEM_WORDS.yourAnswer': ['other', 'adceb15c665f2cad'],
    'REPORT_ITEM_WORDS.codeWritten': ['other', '1330a5c1d9fc87c5'],
    'REPORT_ITEM_WORDS.recordedResult': ['other', '7a253f2dc0df83d2'],
    'REPORT_ITEM_WORDS.changeShows': ['other', 'a073bc30206dcbed'],
    'REPORT_ITEM_WORDS.whatDoes': ['other', '0622b41fb0bd459c'],
    'REPORT_ITEM_WORDS.whatMissing': ['absence', '01f8d06d355a2116'],
    'REPORT_ITEM_WORDS.otherSites': ['other', '9a5dff17a743d64b'],
    'REPORT_ITEM_WORDS.checkedAgainst': ['absence', '6b43af867e425189'],
    'REPORT_ITEM_WORDS.referredFrom': ['other', '8f69644e3209a6cd'],
    'REPORT_ITEM_WORDS.helperSaid': ['other', '94ffd0ba97b7a707'],
    'REPORT_ITEM_WORDS.turnEnded': ['other', '2689bc5d5060520c'],
    'REPORT_ITEM_WORDS.claimsList': ['other', '8a6ebfdb825e30e8'],
    'REPORT_ITEM_WORDS.run': ['other', '32d8c6c9dff6239c'],
    'REPORT_ITEM_WORDS.item': ['other', '608b5cfa8e3731f1'],
    'REPORT_ITEM_WORDS.breach.wrote': ['other', '423890819396143b'],
    'REPORT_ITEM_WORDS.breach.ran': ['other', 'd6e19d4002dc1ae0'],
    'REPORT_ITEM_WORDS.breach.removed': ['other', '3bbf7dcd06a4e404'],
    'REPORT_ITEM_WORDS.notAsked': ['absence', 'abdb2a7183feea1e'],
    // D113 amended: an item about code outside the evaluated session.
    'REPORT_ITEM_WORDS.outsideSession': ['absence', '236576967798de80'],
    'REPORT_ITEM_WORDS.askedUnknown': ['sonah', 'ac8c3f9404794fe4'],
    'REPORT_ITEM_WORDS.asked': ['other', 'ea7c0e8229c00afe'],
    'REPORT_ITEM_WORDS.quoteMissing': ['sonah', '18d592aa8be6c24e'],
    'REPORT_ITEM_WORDS.seeItem': ['other', 'a7044da202a9efd8'],
    'REPORT_ITEM_WORDS.noFinding': ['sonah', 'afbedb610932f914'],
    'REPORT_ITEM_WORDS.noFindingRest': ['sonah', 'dd6cf143f72d1304'],
    'REPORT_ITEM_WORDS.noLinkUncommitted': ['sonah', 'a69fceca719be350'],
    'REPORT_ITEM_WORDS.unchangedLines': ['sonah', 'b270ebb63e8a9dbc'],
    'REPORT_ITEM_WORDS.morePlaces': ['other', '064c73c4dd412777'],
    'REPORT_ITEM_WORDS.onGitHub': ['other', 'b7f78ab602e84290'],
    'REPORT_ITEM_WORDS.members': ['other', '2ea1a7d0a31ccaaa'],
    'REPORT_KIND_LABELS.ask': ['other', '1e08e48ff6d99916'],
    'REPORT_KIND_LABELS.place': ['other', '837abd95b45edb95'],
    'REPORT_KIND_LABELS.claim': ['absence', '8ed154ecc7286239'],
    'REPORT_KIND_LABELS.edit': ['other', 'de5b554564948994'],
    'REPORT_KIND_LABELS.written': ['absence', '09c6b6e1ce4c0526'],
    'REPORT_KIND_LABELS.failure': ['other', '714bd8e3806ea157'],
    'REPORT_KIND_LABELS.decision': ['other', 'ee447e272ca1eeba'],
    'REPORT_KIND_LABELS.question': ['other', '32303716b88fbfeb'],
    'REPORT_KIND_LABELS.pivot': ['other', '5ee8379f562f26a7'],
    'REPORT_KIND_LABELS.item': ['other', 'cc7ff3eb6fcf9cba'],
    'REPORT_KIND_LABELS.ofItem': ['other', '58f5c351a6e3a489'],
    'REPORT_KIND_WORDS.ask_not_done': ['absence', 'bd890228753e1158'],
    'REPORT_KIND_WORDS.ask_partly_done': ['absence', 'b60af8a27689d101'],
    'REPORT_KIND_WORDS.code_ask_not_met': ['absence', '4601e12a78c1aa67'],
    'REPORT_KIND_WORDS.claim_contradicted': ['other', '23cbf4e5b662f18b'],
    'REPORT_KIND_WORDS.code_claim_false': ['other', '1e755b7e543dc8e2'],
    'REPORT_KIND_WORDS.edit_against_instruction': ['other', 'de5b554564948994'],
    'REPORT_KIND_WORDS.code_bug': ['other', '660a147894ab4999'],
    'REPORT_KIND_WORDS.code_finding_unconfirmed': ['sonah', '95cd70e5b8e8ee18'],
    'REPORT_KIND_WORDS.code_contract': ['other', 'd7dde149d1134117'],
    'REPORT_KIND_WORDS.written_contradicted': ['other', '455c7b626f709920'],
    'REPORT_KIND_WORDS.code_weak_test': ['other', '83cb72f2259f48c1'],
    'REPORT_KIND_WORDS.failure_passed_over': ['absence', 'ee19f5139ad749d3'],
    'REPORT_KIND_WORDS.decision_not_acting': ['other', '93367cd9226a0823'],
    'REPORT_KIND_WORDS.decision_unasked': ['absence', '791b4ef777905185'],
    'REPORT_KIND_WORDS.code_question': ['other', 'ac7f9b1b41e91006'],
    'REPORT_KIND_WORDS.decision_chose': ['other', '1690cf25d0cc9c8a'],
    'REPORT_KIND_WORDS.pivot': ['other', '5ee8379f562f26a7'],
    'REPORT_KIND_WORDS.decision_whether_asked': ['sonah', '24b8800569034d06'],
    'REPORT_KIND_WORDS.code_question_finding': ['other', 'a6be012901de1ccb'],
    'REPORT_KIND_WORDS.claim_corrected': ['other', '73808da718a2d886'],
    'REPORT_KIND_WORDS.edit_undone': ['other', 'a874577f839ea2bf'],
    'REPORT_KIND_WORDS.claim_not_checked': ['sonah', '8cf814bdb1c02b64'],
    'REPORT_KIND_WORDS.claim_incomplete': ['sonah', 'a89797f013a9014e'],
    'REPORT_KIND_WORDS.written_not_checked': ['sonah', '6b9a219c4542be64'],
    'REPORT_KIND_WORDS.code_finding_legacy': ['other', 'd37d597524c4769b'],
    'REPORT_LEVEL_WORDS.high': ['other', '6ef7c9b15ecdd690'],
    'REPORT_LEVEL_WORDS.medium': ['other', 'c082456a7766e23a'],
    'REPORT_LEVEL_WORDS.low': ['other', '6c1ff09db3a73dc4'],
    'REPORT_NOT_CHECKED_PARTS.asks': ['sonah', '3e35b17f83d15b3f'],
    // D115: read again, what the session review cited (sonah, registered on its row: REVIEW_ROW_KEYS).
    'REPORT_NOT_CHECKED_PARTS.agentOnly': ['sonah', 'aad35160aa221bc0'],
    'REPORT_NOT_CHECKED_PARTS.claims': ['sonah', '149f5f24bde90949'],
    'REPORT_NOT_CHECKED_PARTS.written': ['sonah', '5ae398a6c0f4a08b'],
    'REPORT_NOT_CHECKED_PARTS.unseenFiles': ['sonah', '6a40df9f12bd2a49'],
    'REPORT_NOT_CHECKED_PARTS.messages': ['sonah', 'e890edb20ee36131'],
    'REPORT_NOT_CHECKED_PARTS.more': ['sonah', '00bb03b6983ccc86'],
    'REPORT_NOT_CHECKED_WORDS.sessionReview': ['other', '4227fbe4244d8630'],
    'REPORT_NOT_CHECKED_WORDS.codeReview': ['other', '4972140d87a71621'],
    'REPORT_NOT_CHECKED_WORDS.complete': ['other', '57143cc7ce1fbf51'],
    'REPORT_NOT_CHECKED_WORDS.incomplete': ['sonah', '74d79720305d675b'],
    'REPORT_NOT_CHECKED_WORDS.messagesNotReviewed': ['sonah', 'aea70fb329a6b304'],
    'REPORT_NOT_CHECKED_WORDS.requirementsRejected': ['sonah', '367fded204acd6ca'],
    'REPORT_NOT_CHECKED_WORDS.claimsRejected': ['sonah', '1b51b9b9cb152f21'],
    'REPORT_NOT_CHECKED_WORDS.triageDropped': ['sonah', '64e68b84fe07451a'],
    'REPORT_NOT_CHECKED_WORDS.triageOfWithheld': ['sonah', 'fe4fee49d376833b'],
    'REPORT_NOT_CHECKED_WORDS.triagePartly': ['sonah', 'f1ad4a05a5d1a070'],
    // D115: said now only of a row whose shape Sonah cannot read; an ask of a helper's brief, and one that Sonah read and
    // could not place, are said so (2 sonah in). All three registered on their rows (REVIEW_ROW_KEYS).
    'REPORT_NOT_CHECKED_WORDS.unreadAsks': ['sonah', '81597ff337a2aa60'],
    'REPORT_NOT_CHECKED_WORDS.unplacedAsks': ['sonah', '9aee206065ef7c95'],
    'REPORT_NOT_CHECKED_WORDS.briefAsks': ['sonah', 'd4221bfa62e87471'],
    'REPORT_NOT_CHECKED_WORDS.unreadRows': ['sonah', '7426c1b021625808'],
    'REPORT_NOT_CHECKED_WORDS.unreadRow': ['other', '2036860ea92df76f'],
    'REPORT_NOT_CHECKED_WORDS.noId': ['sonah', '9b606082060f3a89'],
    'REPORT_NOT_CHECKED_WORDS.rowKinds.requirements': ['other', '2f2fc7f2e9ce13b0'],
    'REPORT_NOT_CHECKED_WORDS.rowKinds.decisions': ['other', '86ae35d58a6aa3b5'],
    'REPORT_NOT_CHECKED_WORDS.rowKinds.pivots': ['other', '3ce89a5c2104939a'],
    'REPORT_NOT_CHECKED_WORDS.rowKinds.writtenClaims': ['other', '086d4cfd65545f75'],
    'REPORT_NOT_CHECKED_WORDS.rowKinds.findings': ['other', '8bf18252cb6dadd5'],
    'REPORT_NOT_CHECKED_WORDS.rowKinds.failures': ['other', '16d34b5e7bcb341e'],
    'REPORT_NOT_CHECKED_WORDS.rowKinds.promises': ['other', 'dd1b3c312cf7d816'],
    'REPORT_NOT_CHECKED_WORDS.rowKinds.codePass.findings': ['other', '16e86cb7180e5e0f'],
    'REPORT_NOT_CHECKED_WORDS.rowKinds.codePass.questions': ['other', 'a274657ede70b8ef'],
    'REPORT_NOT_CHECKED_WORDS.rowKinds.codePass.withheld': ['other', 'ac11118711f72a8c'],
    'REPORT_NOT_CHECKED_WORDS.rowKinds.codePass.unconfirmed': ['other', '036ecb319e872680'],
    'REPORT_NOT_CHECKED_WORDS.encryptedBriefs': ['sonah', '9d0357d7a57e8683'],
    'REPORT_NOT_CHECKED_WORDS.encryptedMessages': ['sonah', '43f663d41c7a83e1'],
    'REPORT_NOT_CHECKED_WORDS.gapsUntied': ['sonah', 'b2aba0434a676560'],
    'REPORT_NOT_CHECKED_WORDS.gapsOfMessage': ['sonah', 'f6f8a82861249014'],
    'REPORT_NOT_CHECKED_WORDS.withheldNoText': ['sonah', '2e0c57a4e3b1f4a4'],
    'REPORT_NOT_CHECKED_WORDS.withheldWhy': ['sonah', 'b83ace80fbaa8609'],
    'REPORT_NOT_CHECKED_WORDS.checkSaid': ['other', '14a7fd63efbd5825'],
    'REPORT_NOT_CHECKED_WORDS.rowsNotShown': ['sonah', '5492bb735b4f41bb'],
    'REPORT_NOT_CHECKED_WORDS.asksThere': ['sonah', '2b6a6f6d297fe403'],
    'REPORT_NOT_CHECKED_WORDS.claimsThere': ['sonah', '57026cb020356adc'],
    'REPORT_NOT_CHECKED_WORDS.writtenThere': ['sonah', 'b06cfc85a7d592bd'],
    'REPORT_NOT_CHECKED_WORDS.notRunLines': ['sonah', '548d5d8f0c9b546e'],
    'REPORT_OUTCOME_WORDS.ran-exit-0.exit': ['other', '956bfd9f43302b7c'],
    'REPORT_OUTCOME_WORDS.ran-completed.typed': ['sonah', 'b1123e06b5cb6bcf'],
    'REPORT_OUTCOME_WORDS.ran-failed.exit': ['other', '273a33448140dda9'],
    'REPORT_OUTCOME_WORDS.ran-failed.flag': ['sonah', 'd11495847f709344'],
    'REPORT_OUTCOME_WORDS.ran-failed.typed': ['sonah', '90635b5786db1437'],
    'REPORT_OUTCOME_WORDS.did-not-run.denial': ['absence', '607c9dbcef4ec6ca'],
    'REPORT_OUTCOME_WORDS.no-terminal-status.background': ['absence', 'ecd4a93047cb7969'],
    'REPORT_OUTCOME_WORDS.no-terminal-status.none': ['sonah', '72ab08b934125d5c'],
    'REPORT_OUTCOME_WORDS.no-terminal-status.interrupted': ['absence', '3f64ae2cd4029ae2'],
    'REPORT_OUTCOME_WORDS.no-terminal-status.cancelled': ['absence', '3adf5c94259829ac'],
    'REPORT_OUTCOME_WORDS.no-terminal-status.command-failed': ['sonah', '8af6ecb15871001e'],
    'REPORT_OUTCOME_WORDS.no-terminal-status.command-stopped': ['absence', 'd1674f90220d0454'],
    'REPORT_OUTCOME_WORDS.failed-or-refused.untyped': ['absence', 'c90bc05092e6650c'],
    'REPORT_OUTCOME_WORDS.output-no-status.output': ['sonah', '07f03b59b33c4da4'],
    'REPORT_OUTCOME_WORDS.output-no-status.unread': ['sonah', '2c1c3294e6bd5b56'],
    'REPORT_OUTCOME_WORDS.end-unread.background': ['sonah', '85941b800d31e83d'],
    'REPORT_OUTCOME_WORDS.end-unread.unchecked': ['sonah', '13698e064f659c2e'],
    'REPORT_PROMPT_PARTS.done': ['other', '3a9219ff26dcf98a'],
    'REPORT_PROMPT_PARTS.doneCode': ['other', '36087a6ae98fa9e3'],
    'REPORT_PROMPT_PARTS.partly': ['absence', 'f2758ed52548f059'],
    'REPORT_PROMPT_PARTS.notDone': ['absence', '5bc3d14527bb3ca7'],
    'REPORT_PROMPT_PARTS.notChecked': ['sonah', '33ac74e35abf201a'],
    'REPORT_PROMPT_PARTS.notCheckedCode': ['sonah', '8d09f2e3deae7286'],
    'REPORT_PROMPT_WORDS.status.done': ['other', '11a6767d5674c7e4'],
    'REPORT_PROMPT_WORDS.status.partly': ['absence', '1afdeec8fabc72c3'],
    'REPORT_PROMPT_WORDS.status.notDone': ['absence', '0df2acbef651ceda'],
    'REPORT_PROMPT_WORDS.status.notChecked': ['sonah', 'd16948e73a680090'],
    'REPORT_PROMPT_WORDS.coverage': ['sonah', '2151906bf476a859'],
    // D115: read again, what the session review cited as doing the ask (sonah, registered on its row). Its earlier words
    // ("Sonah found no recorded result or change for it") named a search that Sonah never ran.
    'REPORT_PROMPT_WORDS.agentOnly': ['sonah', 'c255d589798db1ca'],
    'REPORT_PROMPT_WORDS.codeFinding': ['other', '99a41bd8eb4b8561'],
    // D125 amended (the owner: "go for option 3"): the note on a not-checked ask that the code review found to hold in
    // the code — the code review's verdict and where Sonah found its quotes (other), and that Sonah did not check it
    // (sonah: Sonah's own record, no check of the verdict runs).
    'REPORT_PROMPT_WORDS.codeHolds': ['other', 'c666899fa59bdfe9'],
    'REPORT_PROMPT_WORDS.codeHoldsUnchecked': ['sonah', '8fc2770b054f1365'],
    'REPORT_PROMPT_WORDS.withheldFinding': ['sonah', 'c1cb83eb1266c1ba'],
    'REPORT_PROMPT_WORDS.withheldSee': ['other', '2fde8352b52959d6'],
    'REPORT_PROMPT_WORDS.codeQuestion': ['other', '21c63dd35a8687e8'],
    'REPORT_PROMPT_WORDS.unconfirmedFinding': ['sonah', '451d10f2209f6498'],
    'REPORT_PROMPT_WORDS.unlocated': ['sonah', 'fd27786aa4c8e19a'],
    // D127 (B10d): a compaction and what the agent's context dropped, by the recorder's typed counts (an absence of
    // context, proved by the boundary row's own fields: `typed_compaction`); (N1) the first compaction after an ask.
    'REPORT_PROMPT_WORDS.compaction': ['absence', '2d6859831346bada'],
    'REPORT_PROMPT_WORDS.beforeCompaction': ['other', '1eb65a657887ad9d'],
    'REPORT_PROMPT_WORDS.overlaps': ['other', 'a7571bff01830fc0'],
    'REPORT_PROMPT_WORDS.attached': ['other', '9a2b0d1cdcb085ca'],
    'REPORT_PROMPT_WORDS.fromAttached': ['other', '2362d327532118df'],
    'REPORT_PROMPT_WORDS.pasted': ['sonah', '2424ee0154629a13'],
    'REPORT_PROMPT_WORDS.withheldMessage': ['sonah', 'bfb2aae3df4cb7f7'],
    'REPORT_PROMPT_WORDS.askLine': ['other', 'ea7c0e8229c00afe'],
    'REPORT_RECORDING_KINDS.claude': ['other', 'e8cab3e38bffcaaa'],
    'REPORT_RECORDING_KINDS.codex': ['other', 'f73efbfdc6d5ed6e'],
    'REPORT_RECORDING_KINDS.cursor': ['other', '54343043559b1cd9'],
    'REPORT_RECORDING_KINDS.other': ['other', '80e8dd1a5a05f707'],
    'REPORT_REFUSAL_WORDS.user-rejected': ['other', '83c874d33e8bff73'],
    'REPORT_REFUSAL_WORDS.permission-rule': ['other', '32aad9cff3178de8'],
    'REPORT_REFUSAL_WORDS.automode-blocked': ['other', '600fb0a8d22e9a5d'],
    'REPORT_REFUSAL_WORDS.automode-unavailable': ['other', '600fb0a8d22e9a5d'],
    'REPORT_REFUSAL_WORDS.automode-parsing-error': ['other', '600fb0a8d22e9a5d'],
    'REPORT_RESULT_PARTS.ran-exit-0': ['other', 'e10f9bef649a52f5'],
    'REPORT_RESULT_PARTS.ran-completed': ['sonah', 'dfdd08de5bbb37fb'],
    'REPORT_RESULT_PARTS.ran-failed': ['other', 'a856832b5c584e23'],
    'REPORT_RESULT_PARTS.failed-or-refused': ['other', '4d43f25107fd1eb2'],
    'REPORT_RESULT_PARTS.did-not-run': ['absence', 'f0fcdc5c0eb3dfce'],
    'REPORT_RESULT_PARTS.no-terminal-status': ['absence', 'b5443456394b4129'],
    'REPORT_RESULT_PARTS.stopped': ['absence', '36b5ba4e6ef06ef4'],
    'REPORT_RESULT_PARTS.no-result': ['sonah', '027d0d07b1b17e38'],
    'REPORT_RESULT_PARTS.output-no-status': ['sonah', '4a18e6d853352242'],
    'REPORT_RESULT_PARTS.end-unread': ['sonah', '48802aece50630b1'],
    // D104 (read 2026-10-17, when D100 and D104 were joined): the mark's label and places, and what Sonah left out.
    'REPORT_SEEN_WORDS.label': ['other', '172e1d25485908ba'],
    'REPORT_SEEN_WORDS.lead': ['sonah', '6c94c039e6d54704'],
    'REPORT_SEEN_WORDS.ofRun': ['other', 'ca2b2d846602c235'],
    'REPORT_SEEN_WORDS.atEvent': ['other', '45c28f3739fb9c62'],
    'REPORT_SEEN_WORDS.aResult': ['other', '4ba8ecfcfd3e711a'],
    'REPORT_SEEN_WORDS.cut': ['sonah', '35ac6e36d8aceb9f'],
    'REPORT_SECTION_WORDS.prompt': ['other', 'e1d7ff5c54f764a3'],
    'REPORT_SECTION_WORDS.promptCounted': ['other', '8896a27b27f89751'],
    'REPORT_SECTION_WORDS.tier': ['other', '9d7aaef55a7cf4a1'],
    'REPORT_SECTION_WORDS.did': ['other', 'b4ef4d966fc6c461'],
    // D123: read again with no count of files (where Sonah found no write that it can read beside shell commands).
    'REPORT_SECTION_WORDS.didCounted': ['other', 'ccea5af13c0589c6'],
    'REPORT_SECTION_WORDS.notChecked': ['sonah', 'ea64a56891363533'],
    'REPORT_SECTION_WORDS.notCheckedCounted': ['sonah', '2b792edd4d23f3d6'],
    'REPORT_SECTION_WORDS.files': ['other', 'abc7e9892806b047'],
    'REPORT_SECTION_WORDS.runs': ['other', 'b6176c8d36ee95c7'],
    'REPORT_SECTION_WORDS.claims': ['other', '1c85c12229a417dd'],
    'REPORT_SECTION_WORDS.leftOut': ['other', '0dfa0d2b0d934ebd'],
    'REPORT_SECTION_WORDS.settled': ['other', '22b971941231b1e4'],
    'REPORT_SECTION_WORDS.answer': ['other', '7e6bb3320c236835'],
    'REPORT_SECTION_WORDS.withheld': ['sonah', '6b769c3c477bd62e'],
    'REPORT_SECTION_WORDS.closingLines': ['sonah', '9f0bda6ff43d9777'],
    'REPORT_SECTION_WORDS.noAskMessages': ['sonah', '0699cfabd49b552a'],
    'REPORT_SECTION_WORDS.wholeMessage': ['other', 'c6274ed63020e79e'],
    'REPORT_TIER_WHY.byDefault': ['other', '92a409daf713537b'],
    'REPORT_TIER_WHY.tied': ['other', 'f47ef59452b3098c'],
    'REPORT_TIER_WHY.kept': ['other', 'fc74fcc828660708'],
    'REPORT_TIER_WHY.bounded': ['sonah', '5971ab01ead777cf'],
    'REPORT_TIER_WHY.refused': ['sonah', '11baac912b6b64e3'],
    'REPORT_TIER_WHY.held': ['other', '5cce894c3f60f376'],
    'REPORT_TIER_WHY.tiedHere': ['other', '2607a29ec3e8fb53'],
    'REPORT_TIER_WORDS.must_act': ['other', 'b78ac834ac3e2267'],
    'REPORT_TIER_WORDS.must_know': ['other', '5b58b83abb12e4a9'],
    'REPORT_TIER_WORDS.good_to_know': ['other', 'aab7685123cf4b02'],
    'REPORT_TRIM_WORDS.trimmed': ['sonah', 'dfdd7273198d719d'],
    'REPORT_TRIM_WORDS.listsTrimmed': ['sonah', '5c227958727814d5'],
    'REPORT_TRIM_WORDS.messagesTrimmed': ['sonah', '8d265dd69fcbab02'],
    'REPORT_TRIM_WORDS.mdShortened': ['sonah', '51473847a92e75c1'],
    'REPORT_TRIM_WORDS.mdStillLong': ['sonah', 'dd09492ee344206d'],
    'REPORT_TRIM_WORDS.pageWhole': ['other', '0ed9fef7d55dc8d8'],
    'REPORT_TYPE_WORDS.fix': ['other', '21f1595b614ffc31'],
    'REPORT_TYPE_WORDS.decide': ['other', '30fddb9fe4315e8f'],
    'REPORT_TYPE_WORDS.read': ['other', '9b9a8d05a7ec353b'],
    'REPORT_TYPE_WORDS.verify': ['other', 'eea2745e2867a677'],
    'REPORT_WHAT_WORDS.ask_not_done': ['absence', '398e197243cfe3ef'],
    'REPORT_WHAT_WORDS.ask_partly_done': ['absence', '3a658f5ad7e92340'],
    'REPORT_WHAT_WORDS.contradicts': ['other', 'f61e44ee5c74f77f'],
    'REPORT_WHAT_WORDS.contradictsWritten': ['other', 'bce93db14f228dab'],
    'REPORT_WHAT_WORDS.editAgainst': ['other', 'fd63d328272dd80a'],
    'REPORT_WHAT_WORDS.failureLead': ['other', '559aead08264d579'],
    'REPORT_WHAT_WORDS.failureCall': ['other', '7edb360f06acaef2'],
    'REPORT_WHAT_WORDS.aCallLead': ['other', '8c2a14d845f46c17'],
    'REPORT_WHAT_WORDS.failure.ran-failed': ['other', '2a559fcf5764e8e5'],
    'REPORT_WHAT_WORDS.failure.failed-or-refused': ['absence', '8c91e8d39b89c219'],
    'REPORT_WHAT_WORDS.failure.did-not-run': ['absence', '1a76e145cb6d7a37'],
    'REPORT_WHAT_WORDS.failure.no-terminal-status': ['absence', '4bef057386e41629'],
    'REPORT_WHAT_WORDS.failure.stopped': ['absence', '3c6694b924f2a262'],
    'REPORT_WHAT_WORDS.failure.no-result': ['sonah', 'aaf7faa13e67f468'],
    'REPORT_WHAT_WORDS.failure.other': ['sonah', 'cb17bd2cdd5765c5'],
    'REPORT_WHAT_WORDS.failureTail': ['absence', 'b3cdc92ea18ab6ff'],
    'REPORT_WHAT_WORDS.notActing': ['other', '878ed1397f557589'],
    'REPORT_WHAT_WORDS.decided': ['other', 'edc2886db0fa1d1a'],
    'REPORT_WHAT_WORDS.choseHow': ['other', 'ee8233ad41568d07'],
    'REPORT_WHAT_WORDS.notActingAbout': ['other', 'c00c4d5c30a123a3'],
    'REPORT_WHAT_WORDS.notActingDecision': ['other', '0c74fdb3c600512b'],
    'REPORT_WHAT_WORDS.decidedOn': ['other', 'dc542f9f7f813471'],
    'REPORT_WHAT_WORDS.choseHowOn': ['other', '6e7750efea16a66b'],
    'REPORT_WHAT_WORDS.pivotFrom': ['other', 'b181416fe3a6c3f7'],
    'REPORT_WHAT_WORDS.pivotTo': ['other', '663ea1bfffe5038f'],
    'REPORT_WHAT_WORDS.pivotUnnamed': ['other', 'f0c0f400ac7940c2'],
    'REPORT_WHAT_WORDS.claimNotChecked': ['sonah', '70f61680bf7ca950'],
    'REPORT_WHAT_WORDS.claimIncomplete': ['sonah', 'b6ab90eab570311d'],
    'REPORT_WHAT_WORDS.writtenNotChecked': ['sonah', '644a521f81bb30e7'],
    'REPORT_WHAT_WORDS.noTitle': ['sonah', '50fe8746f3c8cfc0'],
    'REPORT_WHAT_WORDS.aFile': ['other', '7365d029861e32c5'],
  }),
  'packages/render/session-story.js': Object.freeze({
    'REPORT_MD_WORDS.status': ['other', '920e413c7d411b61'],
    'REPORT_MD_WORDS.asked': ['other', '578519a132112999'],
    'REPORT_MD_WORDS.note': ['other', 'ee5ea001172c297b'],
    'REPORT_MD_WORDS.coverage': ['sonah', '2013715cf24a38c2'],
    'REPORT_MD_WORDS.coverageAsks': ['sonah', 'f5f4439820f5ccfd'],
    'REPORT_MD_WORDS.wholeMessage': ['other', '00b4f7fc18e54f33'],
    'REPORT_MD_WORDS.messageStart': ['other', '711b9c14727341f0'],
    'REPORT_MD_WORDS.messagesNotShown': ['sonah', '25c9c78ad65d2828'],
    'REPORT_MD_WORDS.kindCount': ['other', '63dff3734a86266e'],
  }),
  'packages/cli/src/local-page.js': Object.freeze({
    'LOCAL_PAGE_OPEN_FIX': ['sonah', '9c813c7e1d17c9a0'],
    'LOCAL_PAGE_WORDS.line': ['other', '74b53e15f6a7d21d'],
  }),
  'packages/cli/src/pr-sharing.js': Object.freeze({
    'PR_SHARING_FIXES.publication_disabled': ['other', '096ff634651d03e1'],
    'PR_SHARING_FIXES.stale_revision': ['other', 'd9db1c36d6d0a4f8'],
    'PR_SHARING_FIXES.operation_uncertain': ['other', 'cc45ea2228cbec05'],
    'PR_SHARING_FIXES.operation_busy': ['other', 'd7b362c09d055e49'],
    'PR_SHARING_FIXES.operation_conflict': ['other', '5a0ce98786b7b5b1'],
    'PR_SHARING_FIXES.operation_store_failed': ['other', 'ca914755afb188dc'],
    'PR_SHARING_WORDS.readFirst': ['other', '756793fc9da744f4'],
    'PR_SHARING_WORDS.confirm': ['other', 'fc2b4bf547d18adc'],
    'PR_SHARING_WORDS.failed': ['sonah', '2bb3f6613e6cd3c8'],
    'PR_SHARING_WORDS.fix': ['other', '8983695aa4e075cb'],
    'PR_SHARING_WORDS.otherFix': ['other', '3d817a234d996453'],
    'PR_SHARING_WORDS.again': ['other', '7ef5350a39422b56'],
    'PR_SHARING_WORDS.preview': ['other', 'bc0ff9b81d480fe1'],
    'PR_SHARING_WORDS.posts': ['other', 'a6bb0dd8ee8fb1a0'],
    'PR_SHARING_WORDS.notPosted': ['sonah', '6269b0a67d3913bd'],
    'PR_SHARING_WORDS.needsTerminal': ['other', 'f7704604be3875c0'],
    'PR_SHARING_WORDS.posted': ['other', '8ae7695115907a2a'],
  }),
  'packages/cli/src/report-output.js': Object.freeze({
    'REPORT_OUTPUT_WORDS.mdWritten': ['other', 'f7e5a26f2eda28bd'],
    'REPORT_OUTPUT_WORDS.ghLine': ['other', 'ec7c39433c246671'],
    'REPORT_OUTPUT_WORDS.tooLong': ['sonah', '741d577f2dd21545'],
    'REPORT_OUTPUT_WORDS.notPushed.new': ['absence', '6bb596d1651acc1a'],
    'REPORT_OUTPUT_WORDS.notPushed.old': ['absence', 'dd66c69b4e4e4a8d'],
    'REPORT_OUTPUT_WORDS.notPushed.both': ['absence', '9b9020254579483c'],
    'REPORT_OUTPUT_WORDS.rerun': ['other', '14b1e533d5191657'],
    'REPORT_OUTPUT_WORDS.outputInRepository': ['other', 'e6420dac03919f92'],
  }),
  'packages/cli/src/session-review-command.js': Object.freeze({
    'ANSWER_REUSE_WORDS.session': ['other', '85e45abc60f5de21'],
    'ANSWER_REUSE_WORDS.code': ['other', '79cb4d6d285c6efe'],
    'CODE_PASS_NO_ROOT': ['sonah', '3f23c616ac487857'],
    'CODE_SNAPSHOT_WORDS.head': ['sonah', '432af0f902eeefda'],
    // D113 amended: read again with the tag, and whether the code review is given them apart. Its review: read again,
    // given only if there is room for them. D117: read again with the working directory's repository named.
    'CODE_SNAPSHOT_WORDS.changedOutside': ['absence', '01f4a259ba5cfb0d'],
    'CODE_SNAPSHOT_WORDS.gitBase': ['sonah', 'bf43d57681959810'],
    'CODE_SNAPSHOT_WORDS.noBase': ['sonah', '2c87ef6d859d2c06'],
    'CODE_SNAPSHOT_WORDS.noBaseHere': ['sonah', 'ace0f7f864666d05'],
    'CODE_SNAPSHOT_WORDS.tail': ['other', 'a435f5c9e35dfc56'],
    // D117's review: `tail` when no git repository holds the working directory: what the code review can read.
    'CODE_SNAPSHOT_WORDS.tailFolder': ['other', '7becefee61f8b74f'],
    'CODE_SNAPSHOT_WORDS.place': ['other', '15a7f354aab82b15'],
    'CODE_SNAPSHOT_WORDS.placeChangedOutside': ['absence', '134aa6b504759137'],
    // D117's review: read again with the working directory named when no repository holds it; how many of the places
    // the agents read, a count code computes (`agentsRead`).
    'CODE_SNAPSHOT_WORDS.tailPlaces': ['other', 'bafaf1c66039bb38'],
    // D117 amended: the dry run's folders of no repository and writes not resolved, as the page's.
    'CODE_SNAPSHOT_WORDS.folders': ['sonah', '88e989352effd913'],
    'CODE_SNAPSHOT_WORDS.unresolved': ['sonah', 'fd7e3fd007f3786f'],
    'CODE_STEP_BACKEND_LINE': ['sonah', 'afd8156fe0ae5a59'],
    'CODE_STEP_SOURCE_WORDS.flag.on': ['other', 'f70ae295960f0d7f'],
    'CODE_STEP_SOURCE_WORDS.flag.off': ['other', '8e92dd161ed35a39'],
    'CODE_STEP_SOURCE_WORDS.config': ['other', '55cb2b4e424d05d5'],
    'CODE_STEP_SOURCE_WORDS.default': ['other', '6d244abe081bd72f'],
    'CODE_STEP_WORDS.off': ['sonah', '49d4c5b251769650'],
    'CODE_STEP_WORDS.turnOff': ['other', 'cedc6ae45edeb65c'],
    'CODE_STEP_WORDS.gated': ['sonah', '1c3c846db3f5eb40'],
    // D117's review: read again with the working directory named when no repository holds it.
    'CODE_STEP_WORDS.noChange': ['sonah', '8f80f9243458ea3c'],
    // D111 (F3b): read again with its new sentence, the accounting's calls: a count of calls, no negative fact. Its review
    // read it again with the items named by the kinds in scope: no negative fact. D117's review: read again with the
    // other folders its agents read (a count) and the working directory named when no repository holds it.
    'CODE_STEP_WORDS.on': ['other', '5e25f6445d560ddc'],
    'DRY_RUN_WORDS.nothing': ['sonah', 'edd6713d8ea12cc9'],
    'DRY_RUN_WORDS.session': ['other', '141b3885b8c797d4'],
    'DRY_RUN_WORDS.over': ['sonah', '69146f93cbeebe12'],
    'DRY_RUN_WORDS.recording': ['other', 'faf6a93fbfc23e22'],
    'DRY_RUN_WORDS.knownGaps': ['other', '2d0dece166b5589a'],
    'NO_SESSION_WORDS.none': ['sonah', 'b143ef6bcbb11f34'],
    // D126 (N0): the terminal's line for a session that opens on a compaction: read with it (positive), or not.
    'CONTINUED_RECORDING_WORDS.read': ['other', '0e3eac7f48152cc1'],
    'CONTINUED_RECORDING_WORDS.unread': ['sonah', '1fb595c0b36980b7'],
    'NO_SESSION_WORDS.searched': ['other', 'fbf2517f1fbe8e5d'],
    'NO_SESSION_WORDS.elsewhere': ['other', '3bce1f48db9eb58a'],
    'REPLAY_UNREAD': ['sonah', '83ff3f1c4300db5b'],
    'REPLAY_WORDS.stored': ['other', '8602c0818c2b401e'],
    // D111 (F3b): read again with the accounting's calls: a count of calls, no negative fact. Its review read it again
    // with the items named by the kinds in scope: no negative fact.
    'REPLAY_WORDS.code': ['other', '57171e3490b52c90'],
    'REPLAY_WORDS.noCode': ['sonah', '41e6323be1a25c66'],
    'REVIEW_FIX_DEFAULT': ['other', '744f5f63bd8cd6aa'],
    'REVIEW_FIX_WORDS.session_not_found': ['other', '8b6cb82af4bdcdaa'],
    'REVIEW_FIX_WORDS.output_exists': ['other', '824d8d42038a3e35'],
    'REVIEW_FIX_WORDS.output_folder_missing': ['other', '1f55397b6643062f'],
    'REVIEW_FIX_WORDS.output_folder_unwritable': ['other', 'efdee78c7de3b206'],
    'REVIEW_FIX_WORDS.unsupported_backend': ['other', '6ce01f5f455c9233'],
    'REVIEW_FIX_WORDS.invalid_model': ['other', '7fce32e6f9387005'],
    'REVIEW_FIX_WORDS.explicit_api_model_required': ['other', 'ad4500105f6969fc'],
    'REVIEW_FIX_WORDS.anthropic_key_missing': ['other', 'aeccbabeca44e84f'],
    'REVIEW_FIX_WORDS.review_in_progress': ['other', 'd64824cdc08e6d4f'],
    'REVIEW_FIX_WORDS.review_state_invalid': ['other', 'ccd04d8c71cbc869'],
    'REVIEW_FIX_WORDS.review_interrupted': ['other', '42c485e213fb54d8'],
    'REVIEW_FIX_WORDS.model_unavailable': ['other', 'eebd0e16ff5b99ac'],
    'REVIEW_FIX_WORDS.checkpoint_failed': ['other', 'e13dd4898e7fbf0f'],
    'REVIEW_FIX_WORDS.github_auth_missing': ['other', '685c41021d8086ee'],
    'REVIEW_FIX_WORDS.publication_disabled': ['other', '096ff634651d03e1'],
    'REVIEW_FIX_WORDS.github_unavailable': ['other', '85dbde5bc134bd03'],
    'REVIEW_FIX_WORDS.github_response_invalid': ['other', 'e44138b5e039c943'],
    'REVIEW_FIX_WORDS.config_invalid': ['sonah', '1fe3908ceb785f2f'],
    'REVIEW_FIX_WORDS.state_dir_holds_root': ['sonah', 'ea92baeae4c5d976'],
    'REVIEW_FIX_WORDS.code_repo_not_found': ['sonah', '53718eea0c0b309f'],
    'REVIEW_FIX_WORDS.code_repo_not_git': ['sonah', 'f389e8799a8c6003'],
    'RUN_STATE_WORDS.complete': ['other', 'eebbf6457e46a7f6'],
    'RUN_STATE_WORDS.incomplete': ['sonah', '85554bb9dd4b57d6'],
    'RUN_STATE_WORDS.failed': ['sonah', '5d28a90f4498a814'],
    'RUN_STATE_WORDS.code.complete': ['other', '4a466171e3265cb0'],
    'RUN_STATE_WORDS.code.partial': ['sonah', 'b3c2267cf4893194'],
    'RUN_STATE_WORDS.code.missing': ['sonah', 'f18f692f807911de'],
    'RUN_STATE_WORDS.session.complete': ['other', 'eebbf6457e46a7f6'],
    'RUN_STATE_WORDS.session.incomplete': ['sonah', '64df366eed4ae23e'],
    'RUN_STATE_WORDS.codePass.complete': ['other', '98f701b2abfa9078'],
    'RUN_STATE_WORDS.codePass.partial': ['sonah', '4482673e35ffabd9'],
    'RUN_STATE_WORDS.codePass.missing': ['sonah', 'f18f692f807911de'],
    'RUN_STATE_WORDS.codePass.incomplete': ['sonah', '64df366eed4ae23e'],
    'RUN_STATE_WORDS.codePass.noFile': ['sonah', '943b31fd814aee93'],
    // D113's review: the terminal's words of an empty change, by why, as the page says them: no write of the session
    // that could have changed a file (the recorded writes' search), and none of its writes in the change (what Sonah
    // found).
    'RUN_STATE_WORDS.codePass.noWrite': ['absence', '27789fa6745b9662'],
    'RUN_STATE_WORDS.codePass.noWrittenChange': ['sonah', 'd3a38488360a3c6d'],
    // D123: the terminal's words of no write that Sonah can read beside shell commands, as the page says them.
    'RUN_STATE_WORDS.codePass.noSeenWrite': ['sonah', '4dc12b9f313bf799'],
    'RUN_STATE_WORDS.codePass.backend': ['sonah', '1fb79ae0b67adf57'],
    // D105: Sonah's own record of a review request it did not send, because it was too large to send.
    'RUN_STATE_WORDS.codePass.tooLarge': ['sonah', '3c6ae3b0c040980d'],
    // D111's second review: a coverage short of complete only by the items that its item-by-item check did not examine
    // in a way that Sonah could use (code-report.js `codeReviewCoverage`); Sonah's own record of that check.
    'RUN_STATE_WORDS.codePass.unaccounted': ['sonah', 'f57d928afb5bc254'],
    'RUN_STATE_WORDS.codePassApart': ['other', 'd1a62d94b0e56c3e'],
    'RUN_STATE_WORDS.parts.session': ['other', '8c8cfc45a0a5a82e'],
    'RUN_STATE_WORDS.parts.code': ['other', '355d1adb91f7556a'],
    'RUN_STATE_WORDS.parts.codePass': ['other', '2e3f334c20a5a97c'],
    'RUN_STATE_WORDS.how': ['other', 'dd24da2c636d2260'],
    'RUN_STATE_WORDS.line': ['other', 'b0e55fef6089b94b'],
    // D118 (a): "complete" names what is missing when no code was reviewed.
    'RUN_STATE_WORDS.completeNoCode': ['sonah', 'ba41b87cd3f54d11'],
    'SAVED_COMMENT_WORDS.target': ['other', 'cfe20223aa010bfa'],
    'SAVED_COMMENT_WORDS.after': ['other', 'c67533d523fb1496'],
    'SAVED_COMMENT_WORDS.none': ['sonah', '93cdb2c5db23843f'],
    'SAVED_COMMENT_WORDS.noReview': ['sonah', '7212e2266b8c0251'],
    'SAVED_COMMENT_WORDS.unreadable': ['sonah', '8ebe8c386b489d0a'],
    'SAVED_COMMENT_WORDS.lead': ['sonah', '40e27d1e02b0ba78'],
    'WORKING_FOLDER_WORDS.refused': ['sonah', '203fe4812ee00326'],
    'WORKING_FOLDER_WORDS.fix': ['other', '7a49f66e9d8a61f7'],
    'sessionReviewUsage': ['other', 'eaa69061f9ae5895'],
  }),
  'packages/github/publication.js': Object.freeze({
    'CHECK_TITLES.complete': ['other', 'a11477790b308f7c'],
    'CHECK_TITLES.incomplete': ['sonah', '853f7f5247eae092'],
    // D122 (a review low of D118): the check's title when the run finished and no code was reviewed.
    'CHECK_TITLES.completeNoCode': ['sonah', 'dce1ddac0d143121'],
    'PUBLICATION_WORDS.title': ['other', '12f9c6111b945962'],
    'PUBLICATION_WORDS.notCovered': ['sonah', 'dad7ed85e81be99b'],
    'PUBLICATION_WORDS.noCause': ['sonah', 'c25787f1ef5eef6c'],
    'PUBLICATION_WORDS.attention': ['other', '40337c08218e641a'],
    'PUBLICATION_WORDS.advisory': ['other', '4e96e7a292d3b360'],
    'PUBLIC_RUN_WORDS.complete': ['sonah', 'e7531b080eeec38f'],
    'PUBLIC_RUN_WORDS.incomplete': ['sonah', '612f3c0817c6eee6'],
  }),
});
