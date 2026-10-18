// The report's fixed words (D97): one set of tables for the HTML page and the Markdown report,
// written to the style guide (docs/STYLE.md: at most 20 words a sentence, the active voice, one term for each thing,
// no semicolons, no idioms). Only counts, numbers, paths and the recorded or reviews' own words fill the slots; no
// model writes any of these sentences.
//
// Pure: no disk, clock, network or model. Each table is frozen. `STYLE_KINDS`, `STYLE_FIXTURES` and `STYLE_ALLOW` tell the
// style linter (packages/render/test/style-lint.js) how to read each table.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const verb = (n, one, many) => (n === 1 ? one : many);

/** The report's three tiers, by REPORT_TIERS member: the section headings. */
export const REPORT_TIER_WORDS = Object.freeze({ must_act: 'Must act', must_know: 'Must know',
  good_to_know: 'Good to know' });
/** An item's type, its first word (REPORT_ITEM_TYPES). */
export const REPORT_TYPE_WORDS = Object.freeze({ fix: 'Fix', decide: 'Decide', read: 'Read', verify: 'Verify' });
/** The recording's kind, by the session's adapter, on the header's size line. */
export const REPORT_RECORDING_KINDS = Object.freeze({ claude: 'Claude Code recording', codex: 'Codex recording',
  cursor: 'Cursor recording', other: 'Recording' });

/** The header (D97). */
export const REPORT_HEADER_WORDS = Object.freeze({
  review: 'Sonah review',
  // The files the recording's own writes changed (the session review's facts), with their lines.
  filesChanged: (n, counts) => `${plural(n, 'file')} changed, ${counts}`,
  // D109 (its review): the files of the change that the code step reviews (code-pass.js `codeChangeTally`, or an earlier
  // report's list), the count the coverage line says. Never "changed" by the recording: with git the change runs from the
  // start commit to the files as they are now, so it can hold work done before or after the session.
  change: (n, counts = null) => `a change of ${plural(n, 'file')}${counts ? `, ${counts}` : ''}`,
  commands: (n) => plural(n, 'command'),
  commit: (short) => `commit ${short}`,
  notCommitted: (n) => `${plural(n, 'changed file')} ${verb(n, 'differs', 'differ')} from the last commit.`,
  runsAfterEdit: (n) => `After its last edit, the agent ran ${plural(n, 'command')}.`,
  results: (parts) => `Results: ${parts}.`,
  // D100 (the audit of absence sentences): said as what Sonah found. A command in a record Sonah could not read is no
  // command Sonah found, so these words never say that the agent ran none.
  noRunAfterEdit: 'Sonah found no command that the agent ran after its last edit.',
  refusedAfterEdit: (n) => `The recording shows ${plural(n, 'command')} after the agent's last edit as refused before `
    + `${verb(n, 'it', 'they')} ran.`,
  // D100: the recorder version types no refusal (slicer CLAUDE_UNTYPED_DENIAL_RECORDER), which is all that is proved:
  // the result text that it records can still say which. So the words name the recorder, never the recording.
  unclearAfterEdit: (n) => `After the agent's last edit, ${plural(n, 'command')} failed or the harness refused `
    + `${verb(n, 'it', 'them')}. The recorder does not mark which.`,
  reviewIncomplete: 'Sonah did not finish its review of this session.',
  notCheckedLead: 'Sonah did not check:',
  noCodeStep: 'Sonah did not review the code, so the items show no impact and no action.',
  noGitHubRemote: 'Sonah found no GitHub remote for this repository, so the report has no code links.',
  // True at any later time, also after you push (the flow the CLI suggests): said of when Sonah wrote the report. By
  // the side whose links are missing, each naming only those: `new` the code as the agent left it (HEAD), `old` the code
  // before the session (the start commit: an old-side place, a deleted file), `both` one commit that both sides need.
  // D100 (the audit of absence sentences): said as what git showed Sonah (its remote-tracking branches), never as a
  // fact about GitHub: git here may not know a push made from elsewhere.
  notOnGitHub: Object.freeze({
    new: (short) => `When Sonah wrote this report, git did not show commit ${short} on GitHub. The report has no links `
      + 'to the code as the agent left it.',
    old: (short) => `When Sonah wrote this report, git did not show commit ${short} on GitHub. The report has no links `
      + 'to the code as it was before the session.',
    both: (short) => `When Sonah wrote this report, git did not show commit ${short} on GitHub, so the report has no `
      + 'code links.',
  }),
});
/** The parts of the header's results sentence, by RESULT_OUTCOME_CLASSES member, in the order the header names them.
 *  No part holds a comma: the sentence joins its parts with commas, so a comma inside one would split it in two. */
export const REPORT_RESULT_PARTS = Object.freeze({
  'ran-exit-0': (n) => `${n} exited with code 0`,
  // D100 (the audit of absence sentences): a completion typed by a task notice can name its exit code in the notice's
  // own words, which Sonah does not read: said as what Sonah read, never that no exit code is recorded.
  'ran-completed': (n) => `${n} completed with no exit code that Sonah read`,
  'ran-failed': (n) => `${n} failed`,
  'failed-or-refused': (n) => `${n} failed or the harness refused ${verb(n, 'it', 'them')}`,
  'did-not-run': (n) => `${n} did not run`,
  // D100 (the audit of absence sentences): only a background run whose recording the slicer proved holds no end of it.
  'no-terminal-status': (n) => `${n} ${verb(n, 'has', 'have')} no recorded end`,
  // D99 (F1 guard): a run the record typed as stopped before it finished, or cancelled, has a recorded end.
  stopped: (n) => `${n} stopped before ${verb(n, 'it', 'they')} finished`,
  // D100: a run Sonah read no result of. Said as what Sonah found: the result may be in a record Sonah could not read.
  'no-result': (n) => `for ${n} Sonah found no result`,
  'output-no-status': (n) => `for ${n} Sonah read no exit code`,
  // D99 (F1 guard): a background run whose end Sonah could not read, and could not prove absent. Words that presume no
  // end: such a run may still be running (a later record that only polls it, or says it still runs).
  'end-unread': (n) => `for ${n} Sonah could not read whether or how ${verb(n, 'it', 'they')} ended`,
});
/** The phrases of the header's "Sonah did not check:" line, in its order. */
export const REPORT_NOT_CHECKED_PARTS = Object.freeze({
  asks: (n) => plural(n, 'ask'),
  // D100: what the session review cited (the agent's words only), never that nothing else says so.
  agentOnly: (n) => `${plural(n, 'ask')} that ${verb(n, 'rests', 'rest')} only on the agent's words`,
  claims: (n) => plural(n, 'claim'),
  written: (n) => plural(n, 'statement that the agent wrote into a file', 'statements that the agent wrote into files'),
  // D109 (its review): of the change that the header's size line counts (`REPORT_HEADER_WORDS.change`). D109 amended
  // (2026-10-18): and how many of them its checks read (code-report.js `codeUnseenReadByChecks`, the one tally's).
  unseenFiles: (n, read = 0) => `${plural(n, 'file')} of the change that the code review did not see${read > 0
    ? ` (its checks read ${read < n ? `${read} of them` : n === 1 ? 'it' : n === 2 ? 'both' : `all ${n}`})` : ''}`,
  messages: (n) => `${plural(n, 'message')} of yours in full`,
  more: (n) => `and ${n} more`,
});

/** The count line (D97). */
export const REPORT_COUNT_WORDS = Object.freeze({
  tier: (tier, n) => `${tier} ${n}`,
  folded: '(folded)',
  prompt: (parts) => `Your prompt: ${parts}`,
  noAsk: 'Your prompt: Sonah found no ask to check.',
  mustActLead: 'Must act:',
  more: (n) => `and ${n} more`,
  emptyTiers: 'Sonah found nothing for Must act or Must know. This does not mean that the work is correct.',
});
/** The prompt parts of the count line, in its order (D93: an ask with a code finding is counted apart). */
export const REPORT_PROMPT_PARTS = Object.freeze({
  done: (n) => `${n} done`,
  doneCode: (n) => `${n} done with a code finding`,
  partly: (n) => `${n} partly done`,
  notDone: (n) => `${n} not done`,
  notChecked: (n) => `${n} not checked`,
  notCheckedCode: (n) => `${n} not checked with a code finding`,
});

/** The section headings and fold summaries. */
export const REPORT_SECTION_WORDS = Object.freeze({
  prompt: 'Your prompt',
  promptCounted: (n, parts) => `Your prompt (${plural(n, 'ask')}${parts ? `: ${parts}` : ''})`,
  tier: (tier, n) => `${tier} (${n})`,
  did: 'What the agent did',
  didCounted: (files, commands, others, claims) => `What the agent did (${plural(files, 'file')} · `
    + `${plural(commands, 'command')} · ${others ? `${plural(others, 'other call')} · ` : ''}${plural(claims, 'claim')})`,
  notChecked: 'What Sonah could not check',
  notCheckedCounted: (n) => `What Sonah could not check (${plural(n, 'fact')})`,
  files: 'Files',
  runs: 'Runs, from the recording, in order',
  claims: 'Claims',
  leftOut: 'What the agent said it did not do',
  settled: 'Decisions you settled',
  answer: 'Record your answer',
  withheld: (n) => `Proposals of the code review that Sonah withheld (${n})`,
  closingLines: (n) => `Lines of the closing messages that no claim covers (${n})`,
  // D100: what Sonah found. A message whose review did not finish holds no row either.
  noAskMessages: (n) => `Sonah found no ask in ${plural(n, 'more message')}.`,
  wholeMessage: 'Show the whole message',
});

/** The labels and fixed sentences of an item (D97). */
export const REPORT_ITEM_WORDS = Object.freeze({
  impact: 'Impact on you:', action: 'Action:', where: 'Where:', agentSaid: 'The agent said:',
  agentTold: 'The agent told you:', youSaid: 'You said:', youAsked: 'You asked:', agentDid: 'The agent did:',
  // The fold's summary names no count: a count of the fold's quotes reads as false beside the quotes an item shows open.
  evidence: 'Evidence', why: (tier) => `Why ${tier}`, forExample: 'For example:',
  codeNow: 'The code now:', codeBefore: 'The code before the session:', trace: 'How the code gets there:',
  check: 'Its check:', rowId: 'Item id:', yourAnswer: 'Your answer:', codeWritten: 'Code written:',
  // D110: a premise of a code finding's check, and the visible line of an item to verify for each premise that Sonah
  // could not check.
  restsOn: 'It rests on:', restsOutside: 'It rests on what Sonah could not check:',
  recordedResult: 'A recorded result shows:', changeShows: 'The change shows:', whatDoes: 'What does it:',
  whatMissing: 'What is missing:', otherSites: 'Other places:',
  checkedAgainst: (n, files = []) => `The session review checked it against ${[...(n ? [plural(n, 'earlier message')] : []),
    ...(files.length ? [`the project instruction ${files.length === 1 ? 'file' : 'files'} ${files.join(', ')}`] : [])]
    .join(' and ')}. ${n + files.length === 1 ? 'It did not cover it.' : 'None of them covered it.'}`,
  referredFrom: (path) => `The project instruction file ${path} says:`,
  helperSaid: 'A helper said:',
  turnEnded: 'Its turn ended with:',
  claimsList: 'the claims list',
  run: (k) => `run ${k}`,
  item: (n) => `item ${n}`,
  breach: Object.freeze({ wrote: 'The agent wrote:', ran: 'The agent ran:', removed: 'The agent removed:' }),
  notAsked: 'You did not ask for this.',
  askedUnknown: 'Sonah could not check whether you asked for this.',
  asked: (n) => `ask ${n}`,
  quoteMissing: 'Sonah did not find this quote in the recording.',
  seeItem: (n) => `See item ${n}.`,
  noFinding: 'Sonah found nothing that does this.',
  noFindingRest: 'Sonah found nothing that does the rest.',
  noLinkUncommitted: 'This file differs from the last commit, so Sonah gives no link.',
  unchangedLines: (n) => `Sonah does not show ${plural(n, 'more line')} here.`,
  morePlaces: (n) => `${plural(n, 'more place')}`,
  onGitHub: 'on GitHub',
  // D112 (one point, one item): the line before an item's members.
  members: (n) => `This item holds ${plural(n, 'more point')}.`,
});

/** An item's what line, by REPORT_ITEM_KINDS member (D97). `{…}` slots carry their source's words. */
export const REPORT_WHAT_WORDS = Object.freeze({
  ask_not_done: (n) => `The agent did not do ask ${n}.`,
  ask_partly_done: (n) => `The agent did only part of ask ${n}.`,
  contradicts: (source) => `${source} contradicts a claim of the agent's.`,
  contradictsWritten: (source, path) => `${source} contradicts a statement that the agent wrote into ${path}.`,
  editAgainst: 'The agent acted against something that you said.',
  /** A failure's what line, by its result's class: "A", the tool as code, "call", then these words. */
  failureLead: 'A', failureCall: 'call', aCallLead: 'A call',
  failure: Object.freeze({
    'ran-failed': 'failed.',
    // A recorder that types no refusal records a person's "no" and a rule's alike as a failure: the words name no one.
    // D100: and they name the recorder, which marks neither, never the recording, whose result text can say which.
    'failed-or-refused': 'failed, or was refused before it ran. The recorder does not mark which.',
    'did-not-run': 'did not run:',
    'no-terminal-status': 'has no recorded end.',
    // D99 (F1 guard): stopped or cancelled before it finished: a recorded end, never "no recorded end".
    stopped: 'stopped before it finished.',
    // D100 (the audit of absence sentences): Sonah read no result of it, which proves no absence.
    'no-result': 'has no result that Sonah found.',
    // Any other outcome (a stored failure row whose result Sonah now reads otherwise): what Sonah could not read.
    other: 'has an outcome that Sonah could not read as a failure.',
  }),
  failureTail: 'The agent did not act on it or tell you.',
  notActing: 'The agent decided not to act:',
  decided: 'The agent decided:',
  choseHow: 'You asked, and the agent decided how:',
  /** A decision's what line names what it is about, then what the agent chose: "{lead} {dimension}: {chosen}." A
   *  decision not to act sets both apart behind labels ("{about} {dimension}. {decision} {chosen}."): the session review
   *  may word its dimension as the act left undone ("Leaving X alone"), and "not to act on" before such words reads as
   *  a double negative. */
  notActingAbout: 'The agent decided not to act. About:',
  notActingDecision: 'Its decision:',
  decidedOn: 'The agent decided on',
  choseHowOn: 'You asked, and the agent decided on',
  pivotFrom: 'The agent changed its approach from',
  pivotTo: 'to',
  pivotUnnamed: 'The agent changed its approach.',
  claimNotChecked: "Sonah did not check a claim of the agent's.",
  // D100: a check Sonah read no end of by its window's end reads the same as one that never finished: said as what
  // Sonah saw.
  claimIncomplete: "A claim of the agent's rests on a check that Sonah did not see finish.",
  writtenNotChecked: (path) => `Sonah did not check a statement that the agent wrote into ${path}.`,
  noTitle: 'The code review gave no title for this.',
  aFile: 'a file',
});
/** What contradicts a claim, by CONTRADICTION_SOURCES member: the subject of the what line of kinds 4, 9 and 19. */
export const REPORT_CONTRADICTION_SOURCES = Object.freeze({ result: 'A recorded result',
  human_message: 'Your own message', file_content: "A file's recorded content",
  project_instructions: "The project's instruction file", own_written: 'What the agent wrote' });
/** The sentence a disclosed or corrected row adds to its what line, by DISCLOSURE_REASONS member: a claim's (kind 19)
 *  and an edit's (kind 20). */
export const REPORT_DISCLOSURE_WORDS = Object.freeze({
  claim: Object.freeze({ self_corrected: 'The agent corrected it later.',
    helper_internal: 'A helper said it, and you did not see it.', disclosed: 'The agent told you about it.' }),
  edit: Object.freeze({ self_corrected: 'The agent undid it in the same turn.', disclosed: 'The agent told you about it.',
    helper_internal: 'A helper did it, and you did not see it.' }),
});
/** The fixed kind labels on the count line, for an item with no label of the code review's (D97). */
export const REPORT_KIND_LABELS = Object.freeze({
  ask: (n) => `ask ${n}`,
  place: (path, line) => `${path}:${line}`,
  claim: 'a false claim',
  edit: 'an edit against your words',
  written: (name) => `a false statement that the agent wrote into ${name}`,
  failure: 'a failed call',
  /** A decision's label: these words, then the session review's words for what it is about. */
  decision: 'decision on',
  question: 'a question',
  pivot: 'a change of approach',
  item: (n) => `item ${n}`,
  /** After a fixed label that names no number, the item's number: "src/a.js:5 (item 3)". */
  ofItem: (n) => `(item ${n})`,
});
/** Why an item is in its tier, in its evidence fold (D97). */
export const REPORT_TIER_WHY = Object.freeze({
  byDefault: (kind, tier) => `Sonah puts ${kind} in ${tier} by default.`,
  tied: (n, tier) => `Item ${n} of the code review concerns it, so Sonah puts it in ${tier}.`,
  kept: (level) => `The code review proposed ${level}, and Sonah kept it.`,
  bounded: (level, kind, tier) => `The code review proposed ${level}. Sonah never puts ${kind} in ${tier}.`,
  refused: 'A permission rule or auto mode refused a call that this item cites. Sonah never puts such an item in '
    + 'Must act.',
  // D112: an item that a member places in a higher tier than its own row has alone; a tie by a question inside the
  // same item; a failure whose call is a refused read by the recorder's types.
  held: (kind, tier) => `It holds ${kind} in ${tier}. So Sonah puts the item in ${tier}.`,
  tiedHere: (tier) => `A question of the code review in this item concerns it, so Sonah puts it in ${tier}.`,
  refusedRead: (tier) => `The recording marks this read as refused before it ran. Sonah puts such a read in ${tier} `
    + 'by default.',
});
/** Each item kind in words, for the tier sentences. */
export const REPORT_KIND_WORDS = Object.freeze({
  ask_not_done: 'an ask that the agent did not do', ask_partly_done: 'an ask that the agent did only in part',
  code_ask_not_met: 'an ask that the code does not meet', claim_contradicted: 'a contradicted claim',
  code_claim_false: 'a claim that the code contradicts', edit_against_instruction: 'an edit against your words',
  code_bug: 'a bug that Sonah checked', code_contract: 'a broken contract or rule',
  written_contradicted: 'a contradicted statement that the agent wrote into a file', code_weak_test: 'a weak test',
  failure_passed_over: 'a failure that the agent passed over', decision_not_acting: 'a decision not to act',
  decision_unasked: 'a decision that you did not ask for', code_question: 'a question of the code review',
  decision_chose: 'a decision on how to do your ask', pivot: 'a change of approach',
  decision_whether_asked: 'a decision that Sonah could not tie to an ask',
  code_question_finding: 'a question from a finding of the code review',
  code_finding_unconfirmed: 'a finding with a premise that Sonah could not check', claim_corrected: 'a corrected claim',
  edit_undone: 'an edit that the agent undid or told you about', claim_not_checked: 'a claim that Sonah did not check',
  claim_incomplete: 'a claim that rests on a check that Sonah did not see finish',
  written_not_checked: 'a statement that the agent wrote into a file and Sonah did not check',
  code_finding_legacy: 'a finding of an earlier code review',
});
/** The proposed levels in words (TRIAGE_LEVELS). */
export const REPORT_LEVEL_WORDS = Object.freeze({ high: 'high', medium: 'medium', low: 'low' });

/** Your prompt, marked up (D97). */
export const REPORT_PROMPT_WORDS = Object.freeze({
  status: Object.freeze({ done: 'Done', partly: 'Partly done', notDone: 'Not done', notChecked: 'Not checked' }),
  coverage: 'Sonah checked only the marked parts of your message.',
  // D100: what the session review cited, never that only the agent says so.
  agentOnly: "The session review cited only the agent's words for it. Sonah found no recorded result or change for it.",
  codeFinding: (n) => `The code review found a problem here.${n === null ? '' : ` See item ${n}.`}`,
  withheldFinding: (why) => `Sonah withheld a finding of the code review about this ask: ${why}.`,
  withheldSee: 'See the section What Sonah could not check.',
  codeQuestion: (n) => `The code review asks you about this ask.${n === null ? '' : ` See item ${n}.`}`,
  // D110: a finding of the code review about this ask with a premise that Sonah could not check: a line beside the ask,
  // and an item to verify, never a problem that Sonah checked. Its review: the finding names the ask in its `leadsFrom`
  // alone, so it may be a bug or a weak test that concerns the ask; said "here", as `codeFinding` says it.
  unconfirmedFinding: (n) => `The code review found a problem here. Sonah could not check all of its premises.${n
    === null ? '' : ` See item ${n}.`}`,
  unlocated: "Sonah could not find these words in your message. These are the session review's words.",
  overlaps: (m) => `Overlaps ask ${m}.`,
  attached: (n) => `You attached ${plural(n, 'file')}.`,
  fromAttached: 'Sonah found these words in a file that you attached.',
  pasted: (images, others) => `You attached ${[images ? plural(images, 'image') : null,
    others ? plural(others, 'file that is not text', 'files that are not text') : null].filter(Boolean).join(' and ')} `
    + `to this message. Sonah does not show ${images + others === 1 ? 'it' : 'them'}.`,
  // D100: what Sonah found. A message Sonah could not read, or one of images only, reads the same.
  withheldMessage: 'Sonah found no words of this message.',
  askLine: (n) => `ask ${n}`,
});

/** What the agent did (D97). */
export const REPORT_DID_WORDS = Object.freeze({
  fileTypes: Object.freeze({ added: 'new', deleted: 'deleted', modified: 'changed' }),
  filesByAsk: 'The code review grouped these files by the ask that each one serves.',
  askGroup: (n) => `Ask ${n}`,
  // D100 (the audit of absence sentences): the code review's grouping (a note it wrote, or one Sonah dropped), never
  // that a file serves no ask of yours.
  noAskGroup: 'No ask that the code review named',
  moreFiles: (n) => `Sonah does not show ${plural(n, 'more file')}.`,
  outside: (n, names, more = 0) => `The agent also changed ${plural(n, 'file')} outside the repository${names
    ? `: ${names}${more ? `, and ${more} more` : ''}` : ''}.`,
  // D109 (its review): with the code step's one tally, the writes it counts and that are no file of the change (the
  // code review's footer says where they lie): the rest of what the agent changed is the list above.
  notInChange: (n, names, more = 0) => `The agent also changed ${plural(n, 'file')} that Sonah counts but did not `
    + `review${names ? `: ${names}${more ? `, and ${more} more` : ''}` : ''}.`,
  // D100 (review of A1c): what Sonah could read, never that the recording does not show it: a later record can show the
  // file's content. D98: a direct write the recorder typed as stopped is listed here too.
  unconfirmed: (n) => `Sonah could not read whether ${plural(n, 'write')} happened: ${verb(n, 'it', 'each')} stopped `
    + 'before it finished, or its command failed or stopped.',
  moreRuns: (n) => `And ${plural(n, 'more command')} that exited with code 0.`,
  runsCut: (shown, m, parts) => `Sonah shows ${plural(shown, 'run')}. It does not show ${m} more: ${parts}.`,
  // D100: what Sonah found, never that no command ran or that the recording holds none.
  neverRan: (paths) => `Sonah found no command that ran after the last edit of: ${paths}.`,
  noRuns: 'Sonah found no command in the recording.',
  uncoveredExit: 'exit code 0, which covers only the last command of its line',
  handling: Object.freeze({ 'acted-on': 'the agent acted on it', 'told-human': 'the agent told you',
    'passed-over': 'the agent passed over it', 'not-checked': 'not checked' }),
  claimStatus: Object.freeze({ checked: 'checked', contradicted: 'contradicted',
    contradictedByCode: 'contradicted by the code review', notChecked: 'not checked',
    incomplete: 'check not seen to finish' }),
  moreClaims: (n) => `Sonah does not show ${plural(n, 'more claim')}.`,
  noClaims: 'The session review recorded no claim.',
  written: (path) => `written into ${path}`,
  // Said of what Sonah found, never of the agent: no quote that grounds is not silence.
  noLeftOut: "Sonah found no decision not to act in the agent's own words.",
  // D100: what Sonah found among the session review's rows, never that you settled none.
  noSettled: 'Sonah found no decision that you settled.',
  noFiles: 'Sonah found no file in the repository that the agent changed.',
});
/** Who refused a call before it ran, by the recorder's denial kind (redact RECORDED_FACTS.denial), only as far as the
 *  recording types it (R15). The recorder gives `user-rejected` for a person's "no" at a prompt and for a prompt no
 *  person could be shown (slicer events.js `CLAUDE_USER_REFUSAL`), so its words name no one; any kind not here says
 *  "refused" alone. */
export const REPORT_REFUSAL_WORDS = Object.freeze({ 'user-rejected': 'refused',
  'permission-rule': 'a permission rule refused it', 'automode-blocked': 'auto mode refused it',
  'automode-unavailable': 'auto mode refused it', 'automode-parsing-error': 'auto mode refused it' });
const refusalWords = (kind) => (Object.hasOwn(REPORT_REFUSAL_WORDS, kind) ? REPORT_REFUSAL_WORDS[kind]
  : REPORT_REFUSAL_WORDS['user-rejected']);
/** A run's outcome in fixed words (D97), by RESULT_OUTCOME_WORDS class and form: the same key sets. */
export const REPORT_OUTCOME_WORDS = Object.freeze({
  'ran-exit-0': Object.freeze({ exit: () => 'exit code 0' }),
  // A completion typed by a status (slicer COMMAND_STATUS_SOURCES), or by a tool that has no exit code. D100: a task
  // notice's own words can name the exit code (Claude Code writes "completed (exit code 0)"), and Sonah reads only its
  // typed status, so these words say what Sonah read, never that no exit code is recorded.
  'ran-completed': Object.freeze({ typed: () => 'completed, Sonah read no exit code' }),
  // D100 (the audit of absence sentences): an error flag or a typed failure proves no absence of an exit code (the
  // recorded text can name one): said as what Sonah read.
  'ran-failed': Object.freeze({ exit: (n) => `failed, exit code ${n}`,
    flag: () => 'failed: the tool marked its result as an error, Sonah read no exit code',
    typed: () => 'failed: the recorder typed it as failed, Sonah read no exit code' }),
  'did-not-run': Object.freeze({ denial: (n, kind) => `did not run: ${refusalWords(kind)}` }),
  // D100: a run Sonah read no result of (`none`) is said as what Sonah found; "no end recorded" only where proved.
  'no-terminal-status': Object.freeze({ background: () => 'started in the background, no end recorded',
    none: () => 'Sonah found no result of it', interrupted: () => 'stopped before it finished',
    cancelled: () => 'cancelled before it finished',
    // D100 (review of A1c): the write has no result of its own and its command's typed end proves neither way, so the
    // words say what Sonah could read, never that the recording does not show it.
    'command-failed': () => 'its command failed, so Sonah could not read whether this write happened',
    'command-stopped': () => 'its command stopped, so Sonah could not read whether this write happened' }),
  // D100: the recorder marks neither (its version types no refusal); the result text that it records can say which.
  'failed-or-refused': Object.freeze({ untyped: () => 'failed, or refused before it ran. The recorder does not mark '
    + 'which.' }),
  'output-no-status': Object.freeze({ output: () => 'output recorded, Sonah read no exit code',
    unread: () => 'result recorded, no output shown, Sonah read no exit code' }),
  // D99 (F1 guard): never "no end recorded": later records mention the run. Review of A1b: a run no later record is
  // shown to mention (the form `unchecked`: its id only in rows before its launch, an id no search is sound for, or a
  // file Sonah could not read again) is said as what Sonah could not check.
  'end-unread': Object.freeze({ background: () => 'later records mention this run, but Sonah could not read whether '
    + 'or how it ended', unchecked: () => 'Sonah could not check whether the recording holds an end of this run' }),
});

/** What Sonah could not check (D97). */
export const REPORT_NOT_CHECKED_WORDS = Object.freeze({
  sessionReview: 'The session review',
  codeReview: 'The code review',
  complete: 'Sonah finished its review of this session.',
  incomplete: 'Sonah did not finish its review of this session. Read what it could not cover.',
  messagesNotReviewed: (n) => `Sonah did not review ${plural(n, 'message')} of yours in full.`,
  requirementsRejected: (n) => `The session review named ${plural(n, 'ask')} that Sonah did not keep. Sonah did not `
    + 'find the words, or its check did not hold.',
  claimsRejected: (n) => `The session review named ${plural(n, 'claim')} that Sonah did not keep. Sonah did not find `
    + 'the words, or its check did not hold.',
  triageDropped: (n) => `The code review wrote ${plural(n, 'note')} that failed Sonah's checks. Sonah did not use `
    + `${verb(n, 'it', 'them')}.`,
  // A note that passed its own checks, about a finding or question that Sonah withheld (ledger.js `item_withheld`).
  triageOfWithheld: (n) => `The code review wrote ${plural(n, 'note')} about ${n === 1 ? 'a proposal' : 'proposals'} `
    + `that Sonah withheld. Sonah did not use ${verb(n, 'it', 'them')}.`,
  triagePartly: (n) => `Sonah used ${plural(n, 'note')} of the code review only in part. Sonah left out each part that `
    + 'failed its checks.',
  unreadAsks: (n, ids) => `Sonah could not read ${plural(n, 'ask')} of the session review${ids ? `: ${ids}` : ''}.`,
  unreadRows: (n, ids) => `Sonah could not read ${plural(n, 'other part')} of the session review${ids ? `: ${ids}` : ''}.`,
  /** A part with no id, named by its kind and its place in the session review's list of that kind: "its finding 2".
   *  An ask is never named so: "ask N" is your prompt's numbering. */
  unreadRow: (kind, n) => `its ${kind} ${n}`,
  /** The parts with no id and no number, counted after the named ones. */
  noId: (n) => `${n} with no id`,
  rowKinds: Object.freeze({ requirements: 'ask', decisions: 'decision', pivots: 'change of approach',
    writtenClaims: 'written claim', findings: 'finding', failures: 'failure', promises: 'claim',
    'codePass.findings': 'code review finding', 'codePass.questions': 'code review question',
    'codePass.withheld': 'withheld proposal', 'codePass.unconfirmed': 'code review finding to verify' }),
  encryptedBriefs: (n) => `The recorder encrypted ${plural(n, 'helper brief')}, so Sonah cannot show `
    + `${verb(n, 'it', 'them')}.`,
  encryptedMessages: (n, atLeast) => `The recorder encrypted ${atLeast ? 'at least ' : ''}${plural(n, 'message')} `
    + `between agents, so Sonah cannot show ${n === 1 && !atLeast ? 'it' : 'them'}.`,
  gapsUntied: (words) => `For the whole session: ${words}.`,
  gapsOfMessage: (k, words) => `In message ${k}: ${words}.`,
  withheldNoText: 'The code review gave no text for it.',
  withheldWhy: (why) => `Why Sonah withheld it: ${why}.`,
  checkSaid: 'Its check said:',
  rowsNotShown: (n) => `Sonah does not show ${n} more of this list here.`,
  asksThere: (n) => `Sonah did not check ${plural(n, 'ask')}. Your prompt lists ${verb(n, 'it', 'them')}.`,
  claimsThere: (n) => `Sonah did not check ${plural(n, 'claim')}. The claims under What the agent did list `
    + `${verb(n, 'it', 'them')}.`,
  writtenThere: (n) => `Sonah did not check ${plural(n, 'statement that the agent wrote into a file',
    'statements that the agent wrote into files')}. The claims under `
    + `What the agent did list ${verb(n, 'it', 'them')}.`,
  notRunLines: 'The code review did not run.',
});

/** A count with its thousands grouped by commas, in the locale-independent spelling (no locale is read). */
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const linesOf = (from, through) => (from === through ? `line ${grouped(from)}` : `lines ${grouped(from)} to ${grouped(through)}`);
/**
 * D104 (F5 part 4): the mark beside an item, an ask, a claim, a run or a decision whose evidence cites a recorded result
 * that Sonah first showed the session review only in part (the row's `seenInPart`): the lead, the result's place (the
 * run that produced it, linked, when the Runs list shows that run; else its event in the recording, counted from 1),
 * and what Sonah left out (`cut`, one entry of `seenInPartOf`): the facts the request's own omission line names — the
 * lines and bytes, a line shown in part, and a numbered read's file lines. It says nothing of what those lines hold.
 */
export const REPORT_SEEN_WORDS = Object.freeze({
  label: 'Seen in part:',
  lead: 'Sonah first showed the session review only part of',
  ofRun: (k) => `the result of run ${k}`,
  atEvent: (n) => `the result at event ${grouped(n)} of the recording`,
  aResult: 'a recorded result',
  cut: ({ fromLine, throughLine, partFrom, partThrough, fileLines, bytes }) => {
    const size = `${grouped(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
    const one = fromLine === throughLine;
    const left = one && (partFrom || partThrough) ? `It left out part of line ${grouped(fromLine)} (${size}).`
      : `It left out ${linesOf(fromLine, throughLine)} (${size}).`;
    const ends = one ? [] : [partFrom ? fromLine : null, partThrough ? throughLine : null].filter((n) => n !== null);
    const shown = !ends.length ? '' : ends.length === 1 ? ` It showed part of line ${grouped(ends[0])}.`
      : ` It showed part of lines ${grouped(ends[0])} and ${grouped(ends[1])}.`;
    const file = !fileLines ? '' : fileLines.from === fileLines.through
      ? ` In the file, this is line ${grouped(fileLines.from)}.`
      : ` In the file, these are ${linesOf(fileLines.from, fileLines.through)}.`;
    return `${left}${shown}${file}`;
  },
});

/** The page's and the Markdown's size notices (D97). */
export const REPORT_TRIM_WORDS = Object.freeze({
  trimmed: 'To keep this page within its size, Sonah shows only the summary of these folds.',
  listsTrimmed: 'To keep this page within its size, Sonah shows shorter lists here. Each list counts what it leaves out.',
  messagesTrimmed: 'To keep this page within its size, Sonah shows only the start of your long messages.',
  mdShortened: 'Sonah shortened this report to fit a GitHub comment.',
  mdStillLong: 'Sonah shortened this report. It is still too long for one GitHub comment.',
  /** Said after either, only when the same run wrote the HTML page and the page itself kept every part (R2). */
  pageWhole: 'The HTML page holds every part.',
});

/** The footer (D97). */
export const REPORT_FOOTER_WORDS = Object.freeze({
  provenance: (version, model, short) => `Sonah ${version} · ${model}${short ? ` · commit ${short}` : ''}`,
  legend: 'Text in quotation marks is word for word from the recording.',
  legendCodeReview: "Titles, questions, labels and file notes in italics are the code review's words.",
  legendSessionReview: "Words in italics inside Sonah's sentences are the session review's words.",
  triageLegend: 'The code review wrote the impact and action lines. Sonah checked their form, not their meaning.',
  youMeans: 'In this report, “you” means the person who ran the agent.',
  share: 'Read this report before you share it.',
  answerIntro: 'A command records your answer to an item on this computer only. Run it with accept, change or '
    + 'clarify.',
  answerParts: 'Use the id of the item as ROW_ID, and the report of this review as REPORT.',
  answerReport: "REPORT is the file report.private.json in ~/.sonah/session-reviews/<SHA-256 of the recording's "
    + 'path>/review/, or in <--state-dir>/review/.',
  answerCommand: (hash) => `sonah decision accept|change|clarify ${hash} ROW_ID --report REPORT --reason "YOUR REASON"`,
});

/** Your earlier answer to a row (`sonah decision`), by its verb. */
export const REPORT_ANSWER_WORDS = Object.freeze({ accept: 'You accepted it.', change: 'You asked to change it.',
  clarify: 'You asked for clarification.' });

const amount = ({ n, atLeast } = {}) => (Number.isSafeInteger(n) && n >= 0 ? `${atLeast === true ? 'at least ' : ''}${n}`
  : 'some');
const single = (counts = {}) => counts.n === 1 && counts.atLeast !== true;
const nonzero = (counts = {}) => (Number.isSafeInteger(counts.n) && counts.n > 0 ? amount(counts) : 'some');
/** The report's words for the coverage causes review.js says in review-window terms or the recorder's terms (a reader
 *  sees messages, never windows); every other cause is said in review.js's own sentence (`COVERAGE_SENTENCE`). */
export const REPORT_CAUSE_WORDS = Object.freeze({
  no_windows: () => 'the session review read no part of the session',
  windows_incomplete: ({ n, m } = {}) => `the session review did not finish ${amount({ n })} of its ${amount({ n: m })} `
    + `${single({ n: m }) ? 'part' : 'parts'}`,
  input_limit: (counts) => `the session review read ${amount(counts)} action and result ${single(counts) ? 'pair' : 'pairs'} `
    + 'in separate parts',
  carry_capped: (counts = {}) => `the session review left out ${amount(counts)} earlier ${single(counts) ? 'item' : 'items'} `
    + 'for lack of room',
  // D100 (the audit of absence sentences): these causes count losses Sonah declared (its own cuts and the records it
  // could not read among them), so each is said as what Sonah holds or could not read, never as the recording's word.
  incomplete_inventory: (counts = {}) => `${nonzero(counts)} ${single(counts) ? 'part' : 'parts'} of the evidence that `
    + `Sonah read ${single(counts) ? 'is' : 'are'} incomplete, so Sonah cannot check what ${single(counts) ? 'it' : 'they'} `
    + 'held',
  observations_incomplete: (counts = {}) => `Sonah could not read the result of ${nonzero(counts)} `
    + `${single(counts) ? 'action' : 'actions'}, so it cannot tell if ${single(counts) ? 'it' : 'they'} succeeded`,
  unsupported_message: (counts = {}) => `${amount(counts)} ${single(counts) ? 'record has' : 'records have'} a form that `
    + `Sonah cannot read, so Sonah did not review ${single(counts) ? 'it' : 'them'}`,
  write_outcome_unknown: (counts = {}) => `Sonah could not read whether ${amount(counts)} file `
    + `${single(counts) ? 'write' : 'writes'} happened`,
  // How the command ended is not proven (the adapter's `command_outcome_unknown`): the Runs list's "completed, no exit
  // code recorded" is a proven end, so these words never say "exit code" (R17).
  command_outcome_unknown: (counts = {}) => `Sonah could not read whether or how ${amount(counts)} `
    + `${single(counts) ? 'command' : 'commands'} ended, so it cannot tell if ${single(counts) ? 'it' : 'they'} passed`,
});
/** The words for each part reason that is a gap (ledger.js PART_REASONS but the two that are findings), said of the
 *  message whose turn the part is. The vocabulary stays closed in ledger.js. */
export const REPORT_GAP_WORDS = Object.freeze({
  decide_unsettled: 'Sonah could not settle a check on a contradicted claim or on an edit against your words',
  window_incomplete: 'the session review did not finish some of this work',
  proposal_unreadable: 'the session review gave an answer about it that Sonah could not read',
  reading_capped: 'a check on what the session review found could not run',
  review_unattributed: 'a check that could not run names no message, so Sonah shows its work as not checked',
  no_reviewable_event: 'it holds nothing that the session review could read',
  // D100: a declared loss is Sonah's word (its own cuts, the records it could not read), never the recording's.
  gap_declared: 'Sonah does not hold all of this work, so the session review did not see all of it',
  instruction_omitted: 'the recorder or Sonah cut short one of your messages here',
  delegation_unlinked: "Sonah found no recording of a helper that the agent started, so it did not review the helper's "
    + 'work',
  gap_unplaced: 'Sonah does not hold a part of the session, and cannot tell where that part was',
  limit_unattributed: 'the session has a coverage limit that no message explains',
});
/** Why Sonah could not check whether you asked for a decision: its column reason (ledger.js JUDGMENT_REASONS), in
 *  words. The vocabulary stays closed in ledger.js. */
export const REPORT_COLUMN_REASON_WORDS = Object.freeze({
  // D100: Sonah's own cuts make a message partial too, so said as what Sonah holds.
  instructions_partial: 'Sonah does not hold all your earlier messages in full, so it could not check if one covered it.',
  column_unchecked: "The session review's reading of whether you asked did not pass its checks.",
  ambiguous_authority: 'Sonah could not show that the words it cites are yours, or that they came first.',
  receipt_rejected: 'Sonah did not find the words of yours that it cites in the recording.',
  unsettled: "The session review's check on it did not settle.",
  unreviewed_scope: "The session review's check on it did not run.",
  decision_column_refuted: "The session review's check rejected who decided it, and no other answer held.",
});

/**
 * How the style linter reads each table (D97): `heading`, `label`, `status`, `action`, `description`,
 * `notice` or `fragment` (a part a reader joins into a sentence).
 */
export const STYLE_KINDS = Object.freeze({
  REPORT_TIER_WORDS: 'heading', REPORT_TYPE_WORDS: 'label', REPORT_RECORDING_KINDS: 'fragment',
  REPORT_HEADER_WORDS: 'notice', 'REPORT_HEADER_WORDS.review': 'heading', 'REPORT_HEADER_WORDS.filesChanged': 'fragment',
  'REPORT_HEADER_WORDS.change': 'fragment',
  'REPORT_HEADER_WORDS.commands': 'fragment', 'REPORT_HEADER_WORDS.commit': 'fragment',
  'REPORT_HEADER_WORDS.notCheckedLead': 'label',
  REPORT_RESULT_PARTS: 'fragment', REPORT_NOT_CHECKED_PARTS: 'fragment',
  REPORT_COUNT_WORDS: 'fragment', 'REPORT_COUNT_WORDS.emptyTiers': 'notice', REPORT_PROMPT_PARTS: 'fragment',
  REPORT_SECTION_WORDS: 'heading', 'REPORT_SECTION_WORDS.noAskMessages': 'notice',
  REPORT_ITEM_WORDS: 'label', 'REPORT_ITEM_WORDS.notAsked': 'notice', 'REPORT_ITEM_WORDS.askedUnknown': 'notice',
  'REPORT_ITEM_WORDS.quoteMissing': 'notice', 'REPORT_ITEM_WORDS.seeItem': 'notice',
  'REPORT_ITEM_WORDS.noFinding': 'notice', 'REPORT_ITEM_WORDS.noFindingRest': 'notice',
  'REPORT_ITEM_WORDS.noLinkUncommitted': 'notice', 'REPORT_ITEM_WORDS.members': 'notice',
  'REPORT_ITEM_WORDS.unchangedLines': 'notice',
  'REPORT_ITEM_WORDS.checkedAgainst': 'notice',
  'REPORT_ITEM_WORDS.asked': 'fragment', 'REPORT_ITEM_WORDS.claimsList': 'fragment', 'REPORT_ITEM_WORDS.run': 'fragment',
  'REPORT_ITEM_WORDS.item': 'fragment', 'REPORT_ITEM_WORDS.breach': 'label', 'REPORT_ITEM_WORDS.morePlaces': 'fragment',
  REPORT_WHAT_WORDS: 'description', 'REPORT_WHAT_WORDS.failure': 'fragment', 'REPORT_WHAT_WORDS.failureLead': 'fragment',
  'REPORT_WHAT_WORDS.failureCall': 'fragment', 'REPORT_WHAT_WORDS.aCallLead': 'fragment', 'REPORT_WHAT_WORDS.pivotFrom': 'fragment',
  'REPORT_WHAT_WORDS.pivotTo': 'fragment',
  'REPORT_WHAT_WORDS.aFile': 'fragment', 'REPORT_WHAT_WORDS.notActing': 'fragment', 'REPORT_WHAT_WORDS.decided': 'fragment',
  'REPORT_WHAT_WORDS.choseHow': 'fragment', 'REPORT_WHAT_WORDS.notActingAbout': 'fragment',
  'REPORT_WHAT_WORDS.notActingDecision': 'fragment',
  'REPORT_WHAT_WORDS.decidedOn': 'fragment', 'REPORT_WHAT_WORDS.choseHowOn': 'fragment',
  REPORT_CONTRADICTION_SOURCES: 'fragment', REPORT_DISCLOSURE_WORDS: 'description', REPORT_KIND_LABELS: 'fragment',
  REPORT_TIER_WHY: 'description', REPORT_KIND_WORDS: 'fragment', REPORT_LEVEL_WORDS: 'fragment',
  REPORT_PROMPT_WORDS: 'notice', 'REPORT_PROMPT_WORDS.status': 'status', 'REPORT_PROMPT_WORDS.askLine': 'fragment',
  REPORT_DID_WORDS: 'notice', 'REPORT_DID_WORDS.fileTypes': 'status', 'REPORT_DID_WORDS.askGroup': 'heading',
  'REPORT_DID_WORDS.noAskGroup': 'heading', 'REPORT_DID_WORDS.handling': 'fragment',
  'REPORT_DID_WORDS.claimStatus': 'status', 'REPORT_DID_WORDS.written': 'fragment',
  REPORT_OUTCOME_WORDS: 'fragment', REPORT_REFUSAL_WORDS: 'fragment',
  REPORT_NOT_CHECKED_WORDS: 'notice', 'REPORT_NOT_CHECKED_WORDS.sessionReview': 'heading',
  'REPORT_NOT_CHECKED_WORDS.codeReview': 'heading', 'REPORT_NOT_CHECKED_WORDS.checkSaid': 'label',
  'REPORT_NOT_CHECKED_WORDS.unreadRow': 'fragment', 'REPORT_NOT_CHECKED_WORDS.rowKinds': 'fragment',
  'REPORT_NOT_CHECKED_WORDS.noId': 'fragment',
  REPORT_SEEN_WORDS: 'notice', 'REPORT_SEEN_WORDS.label': 'label', 'REPORT_SEEN_WORDS.lead': 'fragment',
  'REPORT_SEEN_WORDS.ofRun': 'fragment', 'REPORT_SEEN_WORDS.atEvent': 'fragment', 'REPORT_SEEN_WORDS.aResult': 'fragment',
  REPORT_TRIM_WORDS: 'notice',
  REPORT_FOOTER_WORDS: 'notice', 'REPORT_FOOTER_WORDS.provenance': 'fragment',
  'REPORT_FOOTER_WORDS.answerCommand': 'fragment',
  REPORT_ANSWER_WORDS: 'notice', REPORT_CAUSE_WORDS: 'fragment', REPORT_GAP_WORDS: 'fragment',
  REPORT_COLUMN_REASON_WORDS: 'description',
});
/** One fixture for every function under a table, by its path (`TABLE.key`, `TABLE.key.member`): the linter renders
 *  each function entry with its own fixture. */
const each = (path, table, args) => Object.fromEntries(Object.entries(table).flatMap(([key, value]) => (typeof value
  === 'function' ? [[`${path}.${key}`, args]] : value && typeof value === 'object'
  ? Object.entries(each(`${path}.${key}`, value, args)) : [])));
/** The arguments each function entry is rendered with for the linter: one and many. */
export const STYLE_FIXTURES = Object.freeze({
  'REPORT_HEADER_WORDS.filesChanged': [[1, '+3 −1'], [4, '+30 −12']], 'REPORT_HEADER_WORDS.commands': [[1], [5]],
  'REPORT_HEADER_WORDS.change': [[1, '+3 −1'], [110, null]],
  'REPORT_HEADER_WORDS.commit': [['1a2b3c4']], 'REPORT_HEADER_WORDS.notCommitted': [[1], [3]],
  'REPORT_HEADER_WORDS.runsAfterEdit': [[1], [3]], 'REPORT_HEADER_WORDS.results': [['2 exited with code 0, 1 failed']],
  'REPORT_HEADER_WORDS.refusedAfterEdit': [[1], [3]],
  'REPORT_HEADER_WORDS.unclearAfterEdit': [[1], [2]],
  ...each('REPORT_HEADER_WORDS.notOnGitHub', REPORT_HEADER_WORDS.notOnGitHub, [['1a2b3c4']]),
  ...each('REPORT_RESULT_PARTS', REPORT_RESULT_PARTS, [[1], [3]]),
  ...each('REPORT_NOT_CHECKED_PARTS', REPORT_NOT_CHECKED_PARTS, [[1], [3]]),
  // D109 amended: the files the code review did not see, with how many of them its checks read.
  'REPORT_NOT_CHECKED_PARTS.unseenFiles': [[1], [3], [56, 8], [1, 1], [2, 2], [3, 3]],
  ...each('REPORT_PROMPT_PARTS', REPORT_PROMPT_PARTS, [[1], [3]]),
  'REPORT_COUNT_WORDS.tier': [['Must act', 2]], 'REPORT_COUNT_WORDS.prompt': [['3 done, 1 not checked']],
  'REPORT_COUNT_WORDS.more': [[2]],
  'REPORT_SECTION_WORDS.promptCounted': [[1, '1 done'], [6, '3 done, 2 partly done, 1 not checked']],
  'REPORT_SECTION_WORDS.tier': [['Must act', 2]], 'REPORT_SECTION_WORDS.didCounted': [[1, 1, 0, 1], [4, 12, 2, 21]],
  'REPORT_SECTION_WORDS.notCheckedCounted': [[1], [9]], 'REPORT_SECTION_WORDS.withheld': [[2]],
  'REPORT_SECTION_WORDS.closingLines': [[3]], 'REPORT_SECTION_WORDS.noAskMessages': [[1], [2]],
  'REPORT_ITEM_WORDS.why': [['Must act']],
  'REPORT_ITEM_WORDS.checkedAgainst': [[1], [3, ['AGENTS.md']]], 'REPORT_ITEM_WORDS.referredFrom': [['AGENTS.md']],
  'REPORT_ITEM_WORDS.asked': [[3]], 'REPORT_ITEM_WORDS.run': [[2]], 'REPORT_ITEM_WORDS.item': [[4]], 'REPORT_ITEM_WORDS.seeItem': [[4]], 'REPORT_ITEM_WORDS.unchangedLines': [[1], [4]],
  'REPORT_ITEM_WORDS.morePlaces': [[2], [5]], 'REPORT_ITEM_WORDS.members': [[1], [3]],
  'REPORT_WHAT_WORDS.ask_not_done': [[2]], 'REPORT_WHAT_WORDS.ask_partly_done': [[2]],
  'REPORT_WHAT_WORDS.contradicts': [['A recorded result']],
  'REPORT_WHAT_WORDS.contradictsWritten': [['A recorded result', 'README.md']],
  'REPORT_WHAT_WORDS.writtenNotChecked': [['README.md']],
  'REPORT_KIND_LABELS.ask': [[2]], 'REPORT_KIND_LABELS.place': [['src/a.js', 12]],
  'REPORT_KIND_LABELS.written': [['README.md']],
  'REPORT_KIND_LABELS.item': [[5]], 'REPORT_KIND_LABELS.ofItem': [[5]],
  'REPORT_TIER_WHY.byDefault': [['a weak test', 'Must know']],
  'REPORT_TIER_WHY.tied': [[4, 'Must know']], 'REPORT_TIER_WHY.kept': [['high']],
  'REPORT_TIER_WHY.bounded': [['low', 'a bug that Sonah checked', 'Good to know'],
    ['high', 'a finding with a premise that Sonah could not check', 'Must act']],
  'REPORT_TIER_WHY.held': [['a question of the code review', 'Must know'], ['a decision that Sonah could not tie to an ask',
    'Must act']],
  'REPORT_TIER_WHY.tiedHere': [['Must know']], 'REPORT_TIER_WHY.refusedRead': [['Good to know']],
  'REPORT_PROMPT_WORDS.codeFinding': [[null], [4]], 'REPORT_PROMPT_WORDS.withheldFinding': [['its check refuted it']],
  'REPORT_PROMPT_WORDS.codeQuestion': [[null], [6]], 'REPORT_PROMPT_WORDS.overlaps': [[1]],
  'REPORT_PROMPT_WORDS.unconfirmedFinding': [[null], [5]],
  'REPORT_PROMPT_WORDS.attached': [[1], [2]], 'REPORT_PROMPT_WORDS.pasted': [[1, 0], [2, 1]],
  'REPORT_PROMPT_WORDS.askLine': [[3]],
  'REPORT_DID_WORDS.askGroup': [[1]], 'REPORT_DID_WORDS.moreFiles': [[1], [4]],
  'REPORT_DID_WORDS.outside': [[1, ''], [2, 'a.md, b.md'], [5, 'a.md, b.md, c.md', 2]], 'REPORT_DID_WORDS.unconfirmed': [[1], [2]],
  'REPORT_DID_WORDS.notInChange': [[1, ''], [2, 'a.md, b.md'], [8, 'a.md, b.md, c.md', 5]],
  'REPORT_DID_WORDS.moreRuns': [[1], [9]], 'REPORT_DID_WORDS.runsCut': [[40, 3, '2 exited with code 0, 1 failed'],
    [1, 1, '1 failed']],
  'REPORT_DID_WORDS.neverRan': [['src/a.js, src/b.js']], 'REPORT_DID_WORDS.moreClaims': [[1], [7]],
  'REPORT_DID_WORDS.written': [['README.md']],
  ...each('REPORT_OUTCOME_WORDS', REPORT_OUTCOME_WORDS, [[2, 'permission-rule']]),
  'REPORT_NOT_CHECKED_WORDS.messagesNotReviewed': [[1], [2]],
  'REPORT_NOT_CHECKED_WORDS.requirementsRejected': [[1], [2]], 'REPORT_NOT_CHECKED_WORDS.claimsRejected': [[1], [2]],
  'REPORT_NOT_CHECKED_WORDS.triageDropped': [[1], [3]], 'REPORT_NOT_CHECKED_WORDS.triageOfWithheld': [[1], [2]], 'REPORT_NOT_CHECKED_WORDS.triagePartly': [[1], [2]], 'REPORT_NOT_CHECKED_WORDS.unreadAsks': [[1, 'r1'], [2, 'r1, r2'], [1, '']],
  'REPORT_NOT_CHECKED_WORDS.unreadRows': [[1, 'r1'], [2, 'r1, r2'], [1, '']],
  'REPORT_NOT_CHECKED_WORDS.noId': [[1], [3]],
  'REPORT_NOT_CHECKED_WORDS.unreadRow': [['finding', 2]],
  'REPORT_NOT_CHECKED_WORDS.encryptedBriefs': [[1], [2]],
  'REPORT_NOT_CHECKED_WORDS.encryptedMessages': [[1, false], [3, true], [1, true]],
  'REPORT_NOT_CHECKED_WORDS.gapsUntied': [['a check could not run']],
  'REPORT_NOT_CHECKED_WORDS.gapsOfMessage': [[2, 'a check could not run']],
  'REPORT_NOT_CHECKED_WORDS.withheldWhy': [['its check refuted it']],
  'REPORT_NOT_CHECKED_WORDS.rowsNotShown': [[1], [5]],
  'REPORT_NOT_CHECKED_WORDS.asksThere': [[1], [3]], 'REPORT_NOT_CHECKED_WORDS.claimsThere': [[1], [3]],
  'REPORT_NOT_CHECKED_WORDS.writtenThere': [[1], [3]],
  'REPORT_SEEN_WORDS.ofRun': [[2]], 'REPORT_SEEN_WORDS.atEvent': [[7], [1_234]],
  'REPORT_SEEN_WORDS.cut': [
    [{ fromLine: 201, throughLine: 2_999, partFrom: false, partThrough: false, fileLines: null, bytes: 480_123 }],
    [{ fromLine: 7, throughLine: 7, partFrom: false, partThrough: false, fileLines: null, bytes: 1 }],
    [{ fromLine: 1, throughLine: 1, partFrom: true, partThrough: true, fileLines: null, bytes: 6_011 }],
    [{ fromLine: 4, throughLine: 90, partFrom: true, partThrough: false, fileLines: null, bytes: 4_000 }],
    [{ fromLine: 4, throughLine: 90, partFrom: true, partThrough: true, fileLines: { from: 103, through: 189 },
      bytes: 4_000 }],
    [{ fromLine: 5, throughLine: 5, partFrom: false, partThrough: false, fileLines: { from: 104, through: 104 },
      bytes: 50 }]],
  'REPORT_FOOTER_WORDS.provenance': [['1.0.0', 'sonah.report-model/2', '1a2b3c4'], ['1.0.0', 'sonah.report-model/2', null]],
  'REPORT_FOOTER_WORDS.answerCommand': [['0'.repeat(64)]],
  ...each('REPORT_CAUSE_WORDS', REPORT_CAUSE_WORDS, [[{ n: 1, m: 3 }], [{ n: 2, m: 5, atLeast: true }]]),
});
/** Allowed exceptions, counted by the linter: a product name holds a glossary term. */
export const STYLE_ALLOW = Object.freeze({
  'REPORT_RECORDING_KINDS.claude': ['quoted-term'],
  'REPORT_FOOTER_WORDS.answerCommand': ['technical-noun'],
});
