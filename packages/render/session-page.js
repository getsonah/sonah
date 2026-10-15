// Session page (M33 Y; judgment-first, D69 f; its review, D69 f (g)). ONE recorded session's review as a self-contained
// HTML page, laid out for the two things the human judges (the project's core: judgment): whether the agent finished
// what it was told — every instruction, carried through or not — and every judgment it made on its own, each beside the
// human's and the agent's own words, checked word for word against the recording, each with a way to confirm or
// overrule it. It is the product's review view, styled as sonah.dev's "What a Sonah review looks like" card (light from
// the site's tokens, a derived warm dark, the reader's own setting unless asked), and it reads the same facts as the
// session story (session-story.js `storyFacts`).
//
// Pure and deterministic: no clock, no random source, no network, no model, no filesystem, no locale. Same inputs,
// same bytes out. What the human answered earlier (`options.decisionReviews`) and the session's redacted hash
// (`options.sessionHash`) are inputs like the report: the page reads no file to know them.
//
// The rules that carry the weight:
//   1. A quote is shown only when `verifyReceipt` finds it again, literally, in the session this page is given — in
//      this render, never trusted from the report. Every shown quote, and nothing else, is a `<q class="said">`; a
//      cut or a join the page makes is outside the quotation marks. The review's own words (a decision's dimension
//      and choice, a finding's title, a claim's paraphrase, a pivot, a requirement it could not locate, and every
//      requirement's status) are never in quotation marks and are said to be the review's.
//   2. Who said a quote is read from the recording: "You said" only for a human instruction a grounded column cites
//      ("You asked" for the one a decision of how served, D70 b);
//      "Helper said" for a statement a helper's child session recorded; "Code written" only for a value quote found on
//      the AFTER side of one of the decision's own writes (or a written claim's own write).
//   3. Nothing is upgraded: the status is `honestStatuses`'; a requirement's status is the review's reading, said so (no
//      receipt carries it: C-06 "Session page"), beside the rows that cite the same words and, folded, what its steps
//      did — linked by structure (event ids, located spans, steps), never judged by code; a claim reads "confirmed by a
//      recorded result" only when the review verified it, whatever test ran nearby; "made without asking" only for a
//      grounded `unasked` column. No closed token, read path, path or text outside the repository, or rejected
//      candidate reaches the page: a grounded quote of the agent's action or code is shown only from a change inside
//      the repository, or from the command or input it ran when the words it touches name no path outside the working
//      tree by the shell's grammar (`pageQuote`), and a quote it withholds is counted where it would have been. What
//      the review rejected is counted, never shown.
//   4. Safe and self-contained: one escape (`escapeHtml`) for every recorded, review-authored or human-answered string,
//      a CSP that allows only the inline style, no script, no external resource, no link but in-page anchors whose ids
//      are numbers. Everything is bounded (`PAGE_LIMITS`), and every cut is stated where it happens.
//   5. The page covers the session: a combined report's code-review findings are counted, never listed. D71 (a): no
//      verdict — no status, chip or word that says the work is right or needs your decision.
//
// D69 page audit (2026-10-08): "Touches" and every rule it read by are deleted (`PAGE_SYMBOL_RULES`, a hand lexer and
// header regexes for five languages, `PAGE_METHOD_KEYWORDS`, `CONTINUES`, the Read output's line-number shape
// `READ_NUMBER`, the read-only command flags `readOnlyCommand`) as D69 (c)(3) deleted the slicer's hunk-header keyword
// list: function-level code reading, by keyword approximations of language grammars, that does not help the human judge
// the agent without reading code. `HOME_PATH` (a home folder guessed from path shapes) is deleted: a quote is withheld by
// the shell's grammar for a path outside the working tree (session-story.js `namesOutsidePath`), and the step titles
// never place a read path. D69 f (g), the page review (2026-10-08): the Impact row (evidence/src/materiality.js path
// keyword rules) and the step titles' program tables (session-story.js `commandFacts`) are no longer read by the page.

import { verifyReceipt, isRead, PROJECT_INSTRUCTIONS_ROLE, referredPath } from '../evidence/src/session.js';
import { messageLines } from '../evidence/src/windows.js';
import { honestStatuses, DECISION_COLUMNS, DISCLOSURE_REASONS, PART_REASONS, PART_REVIEW_REASONS, REQUIREMENT_STATUSES,
  FAILURE_HANDLINGS, CONTRADICTION_SOURCES, resultOutcome, actionOutcome, windowRecordComplete } from '../evidence/src/ledger.js';
import { requirementRowId, failureRowId, ROW_ID } from '../evidence/src/checklist.js';
import { CODE_CHECK_OUTCOMES } from '../evidence/src/ledger.js';
import { codeContradictedRows, codePassFindings } from '../evidence/src/code-pass.js';
import { coverageCauses, coverageCauseEvents, COVERAGE_SENTENCE, CHECKLIST_REQUIREMENT_REASON_WORDS, CHECKLIST_REQUIREMENT_FACT_WORDS,
  CHECKLIST_FAILURE_WORDS, CHECKLIST_FAILURE_REASON_WORDS, CHECKLIST_OUTCOME_WORDS, CHECKLIST_CONTRADICTION_WORDS,
  CHECKLIST_CLAIM_REASON_WORDS, FAILURE_SECTION_WORDS, ATTENTION_ROWS, FOLDED_ROWS, FOLDED_SECTION_WORDS, askRowKind,
  claimRowKind, failureRowKind, writtenRowKind, rowKindCounts } from '../evidence/src/review.js';
import { storyFacts, shownReceipts, hunksOf, visible, oneLine, clip, clipPath, plural, lineWord, inexact, promiseWords,
  durationWord, helperInternal, claimCorrected, forbiddenEdit, forbiddenEditLabel, youWord, locateQuote, overlapping, commonDirectory,
  STORY_RECEIPT_LABELS, STORY_HELPER_STATEMENT_LABEL, STORY_FORBIDDEN_EDIT_LABELS, disclosedEdit, STORY_RECORDING_KINDS,
  STORY_ENCRYPTED_BRIEFS, STORY_ENCRYPTED_MESSAGES, STORY_REQUIREMENT_WORDS, MET_REQUIREMENT_STATUSES, STORY_WRITTEN_WORDS,
  STORY_PROMISE_WORDS, STORY_CONTRADICTION_LABELS, contradictionSourceOf, contradictionLabel, writtenWords,
  STORY_SENTENCES, STORY_LIMITS, failedCommandText, namesOutsidePath, withoutLeadingCd, stoppedPhrase,
  asPeopleRead, STORY_CODE_WORDS, codeQuoteOf, sessionQuoteOf, codeSectionPlan, codeFooterLines, codeCoverageLines }
  from './session-story.js';

/** The page's layout version, reported in the script's summary and the page's generator meta. /2 (M1): "Commands that failed" — every command the record says failed, verbatim — replaces "Tests the
 *  agent ran", which a runner-name list chose. /3 on M33 outcomes repair (status fact, owner decision 2026-10-06): a
 *  claim confirmed by a recorded result shows the result's words it was confirmed through (`confirmingVoice`). /3 on
 *  M33 gate repair (L6): requirements grouped as the story groups them, a tie never broken by an English stop-word
 *  similarity. */
/** /4 (M33 integration, 2026-10-06): one version above both /3s (the status fact's and L6's, which collided) for the
 *  merged page. */
/** /5 (D64 wording, owner decision 2026-10-07): an upheld disclosure's words — the story's `editDisclosed` sentence and its
 *  statement's label, "The agent told you it went against your instruction". */
/** /6 (D69 f, the judgment-first page): what you asked for is counted under the verdict and listed
 *  before the decisions, each request whole, each status said to be the review's reading, the instructions and claims
 *  the review did not keep counted, each gap beside the request it affects; a decision with no word or action of the
 *  agent's listed apart, one it could not check shown beside your instructions for its step; a failed command shown
 *  beside the row that cites it, the rest counted; the changed files listed once; "Touches" and `HOME_PATH` deleted. */
/** /7 (D69 f (g), the page review 2026-10-08): the findings first, then what you asked for (chosen by status, every
 *  request at least one line), then the decisions with the changes of approach among them and your settled choices
 *  folded, then one "What could not be checked"; a command under each decision to confirm or overrule it, and your
 *  earlier answer; each requirement beside the rows that cite its words and what its steps did; the uncited failed
 *  commands listed, folded; no facts strip, no Impact row, no program tables in step titles; the reader's own theme. */
/** /8 (D70 (b), owner decision 2026-10-08; amended by its review S0 before release): "You asked, the agent chose how" is
 *  where the agent's own judgment on HOW to do the asked work is shown — each decision there shows your words it
 *  served, the choice the agent made (in its own words where recorded, then the review's) and what it wrote or ran for
 *  it where the review cited it (the hunk its grounded code picks; else the command or path it acted through; else its
 *  cited actions' own edits, each folded) — always open, right after "Made without asking you", which stays first and
 *  marked as the more serious. No column, status or row moves: the group is the ledger's derived column. */
/** /9 (D71 (a), owner decision 2026-10-08: no verdict anywhere the human sees): no verdict line, status chip or status
 *  word — the page opens with what you asked for, counted, then where your attention is needed (a count and a link for
 *  each place: your instructions short of addressed, the findings, each of the agent's own decision groups, the changes
 *  of approach, the claims, what could not be checked), then each request, the findings (each with its recorded facts,
 *  never a status), the decisions and what could not be checked. Nothing on it says the work is right. */
/** /10 (D71 S4, owner decisions 2026-10-08 (a), (b), (c), (d), (e), (h)): the page is the checklist, in its order —
 *  what you asked (one row per ask: your words, the status code published, and the evidence that settles it or what is
 *  missing, or why it is not checked); what the agent told you (its claims by status: contradicted, each labelled by
 *  what contradicts it; resting on a check that never completed; not checked; confirmed, folded; an assumption marked
 *  as the review's reading); what the agent decided (made without asking you; you asked, the agent chose how, its how
 *  shown; you settled, folded; could not check whether you asked; a choice not to act highlighted wherever it is);
 *  the failures it passed over (each result that failed, did not run or recorded no end, with what the agent did about
 *  it); edits against what
 *  you said and statements it wrote into files; what could not be checked; then the steps and the files, folded. The
 *  summary above it counts only what needs your attention, never what is done; each row carries the command that
 *  records your answer to it. No verdict anywhere. */
/** /11 (S6, the fixes of the S5 review): a claim kept although its own check did not settle says why it is
 *  not checked, and a decision kept "could not tell" for that says so (owner decision D71 b, H1); an action a row rests
 *  on is said as the window that showed it saw its result (D59, M1); the review's unchallenged assumption mark is no
 *  longer shown or counted in the summary (M3); the lines of the agent's closing message no claim covers, and those the
 *  review read as asserting nothing, are listed folded under what the agent told you, as recorded (M4). */
/** /12 (S7): no fold of calls "nothing came back from" and no summary line for them — a
 *  RESULT recorded with none of its output shown is output-no-status `unread`, never a failure row (the recorder recorded
 *  a result for each); an interrupted or cancelled call reads as stopped before it finished, under no terminal status. */
/** /13 (night/steps): a decision the review could not check shows your instructions of the request it was made under —
 *  read from the event that places it (`x.request`: its first action a review window holds, the request that delivered
 *  or launched a helper's), never from its step, whose last request named it when one review window held several
 *  (D68 K) — and its sentences say so of the decision, no longer of its step ("the request it was made under"; "no
 *  request of yours comes before it"). A page with no decision the review could not check keeps its bytes. */
/** /14 (owner decision D77 B; it amends D69 f (g) finding 1 and D71 S4): the command that records your answer is printed
 *  once, under where your attention is needed, with the session's hash and ROW_ID, REPORT and YOUR REASON as the parts
 *  to replace, and where the report is kept said in the same words on every computer; under each row only its id and
 *  your earlier answer, the same bytes with or without the hash. The page still names no folder of this computer's. A
 *  page with no row id, or with no session hash, moves by this version string alone. */
/** /15 (owner decision D77 C; story /14): a step is one of your requests, held by one or more review windows, no longer
 *  one review window — so the header's count, the steps card (one row per request, the work before your first request
 *  first), every step link, the request each step is shown under, a requirement's "what its steps did" range, and "n of m
 *  steps were not fully reviewed" (the steps any of whose windows is incomplete, of all steps) follow your requests; a
 *  step holding a failed window is not reviewed. A page whose every review window holds one request, each request in one
 *  window, moves by this version string alone. */
/** /16 (owner decision D79; story /15): a file you attached to a message belongs to that message's request — the
 *  steps, the request every row is shown under and "Your instructions here" follow the story's rule (windows.js
 *  `startsSegment`, the recorder's `attached` marker) — no longer a request and a step of its own. The file is shown
 *  under its message ("You attached", with the whole file folded as a long request is); a requirement citing it is its
 *  message's, and a finding quoting it concerns that request ("Concerns request N"). One recorded before any message
 *  of yours belongs to no request and is shown first under "What you asked". A page with no attached file moves by
 *  this version string alone. */
/** /17 (owner decision D79, 2026-10-11; the story keeps /15, its code unchanged): a decision whose value receipt the
 *  ledger kept without its value (`value_paraphrased`: the quote is verbatim on the after side of a cited write that
 *  succeeded, the review's value not word for word in it) shows that quote as "Code written" and the hunk it picks as
 *  "The edit it was made in", exactly as a grounded value's; the page read a value receipt only beside a grounded
 *  value, and the ledger dropped every other. A page with no such decision moves by this version string alone. */
/** /18 (owner decision D79; story /16): a command Claude Code refused did not run. A command whose call the recorder
 *  typed as refused before it ran (the story's `didNotRun`, `REFUSED_DENIALS`) is never among the commands that failed:
 *  the failed-command part is "Commands that failed or did not run", its sentence counts the two apart ("1 of 5
 *  commands failed, and 2 did not run (refused before they ran)"), each such command is listed and shown beside the row
 *  that cites it with the chip "did not run" (`PAGE_LABELS.didNotRunCited`; a cut past a row's cited bound names
 *  failed commands only while every one it leaves out failed), a step's title and "what its steps did" count them
 *  apart; and a write parsed from a refused or failed command (a heredoc's body) is no change and no diff
 *  base (the story's rule); one of a refused command that a row rests on reads its command's "did not run" (evidence
 *  `actionOutcome`, C-06 item 6; one of any other command, failed or not, still reads no result recorded). A page with
 *  no refused command and no such write moves by the heading, the no-command sentence and this version string alone. */
/** /19 (owner decision D80, 2026-10-12; the D80 integration's one step for its four items; story /17): item N, a
 *  write the slicer parsed from a command that failed or was stopped keeps its row, never as done (the story's
 *  `unconfirmed`): "Files changed" lists it apart, under "Writes not recorded as done", by its path and counts with
 *  what its command's end leaves unrecorded ("its command failed, so whether this write happened is not recorded"),
 *  and an edit a row shows from it carries the same words under the neutral "The edit it cites:"; a row names such a
 *  write it shows no edit of apart from its other edits ("It was also made in N more edits" counts none), one line
 *  for each end of their commands, each with its chip; and a command the recorder typed with a stopped denial kind
 *  (the story's `stopped`) is never among the commands that failed: the part is then headed "Commands that failed, did
 *  not run or stopped", its sentence counts it apart ("1 stopped before it finished"), it is listed and cited with the
 *  chip "stopped before it finished" (`PAGE_LABELS.stoppedCited`), and a step's title and "what its steps did" count
 *  it apart. Item W, the quoted line is shown: a code quote shown on the after side of a change whose line is in no
 *  hunk of that change's edit gets that line's own window of the edit script (`keptLine`), the line marked and one
 *  fixed sentence above it (`PAGE_SENTENCES.keptLine`); a quote a hunk holds keeps its hunk. Items M (two published
 *  claims apart only by a support no check upheld are one claim) and Q (a quote only in the body of a write whose
 *  command did not run, failed or stopped is refused, with its closed reason's words) move no code here and reach the
 *  page only through the report it reads. A page with none of these moves by this version string alone. */
/** /20 and /21 (decisions step 3 and D83 (2)) were reverted before release (D84 (3)); neither is reused. */
/** /22 (owner decision D84 (4) c, 2026-10-12; the story keeps /17, its code unchanged): "n of m steps were not fully
 *  reviewed" names those steps, read from the report's window results (the steps any of whose review windows is
 *  incomplete, `incompleteSteps`), linked, with the decisions, claims and requests they hold, as every other placed
 *  cause is: never a count alone. And a cause placed in one step says that step "which holds" its rows (several steps
 *  "which hold"; before /22 one step said "which hold" too). A page whose every review window completed and none of
 *  whose causes is placed in exactly one step moves by this version string alone. */
/** /23 (owner decision D84, 2026-10-12, "off for the model, on for output"; story /18; after the pre-launch items'
 *  /22): the page is rendered from the session as a person may read it (story.js `sessionForPeople`), and its one
 *  escape (`escapeHtml`, through `visible`) masks every recorded or review-authored text before escaping it
 *  (`maskForPeople`, redact/index.js). A quote of the reviewer's that a mask touches no longer grounds and is not
 *  shown. A session with nothing to mask keeps its bytes, but for this version string. The D84 review (same version,
 *  never released): each field is first masked with what the redactor's full walk hid in it, and every text with the
 *  session's values (story.js `asPeopleRead`). */
/** /24 (the column fix; owner decision D83 (2) on the normal column path, 2026-10-12; renumbered later
 *  from /23, which D84's masking took; story /19): a decision whose covering words a project instruction file the
 *  agent was given holds (its receipt of role project-instructions on that file, grounded here) shows them under
 *  "Referred from <path>" (`PAGE_REFERRED_LABEL`, the path the recording carries), never as words said in the session
 *  ("You said", "You settled it", "You asked"); its group is still the one its column names. A page with no such
 *  decision moves by this version string alone. (The label and the voice reading are 7db6ae5's.) And owner decision
 *  D84, in the same unreleased /24: a decision "made without asking you" whose review also checked the
 *  project's instruction files counts them apart from your earlier instructions and names them by their paths
 *  (`checkedWithFiles`: "The review checked your 2 earlier instructions and the project's instruction file CLAUDE.md;
 *  none of them covered this."), each quote folded under "Referred from <path>"; before, a file's check was counted as
 *  one of your instructions and, unshown, as "not found in this recording". A page with no such decision reads as
 *  before. And later, in the same unreleased /24: a file whose recorded path lies outside the working tree as
 *  written (absolute, home-relative or climbing out of it) is named, in both, by its file name alone ("Referred from
 *  CLAUDE.md", session.js `referredPath`), never by a home or absolute path; a path inside it reads as recorded.
 *  And Gain I (2026-10-13, the images gain; story /19), in the same unreleased /24: under a request you pasted an
 *  image (or other nontext content) into, one line says so by count (`pastedNote`), never the image; the two new
 *  coverage causes are ask causes (`PAGE_ASK_CAUSES`). A page of a session with no nontext human input keeps its
 *  bytes. */
/** /25 (W1 A, owner decision 2026-10-13): a decision kept "could not tell" because the review's own check refuted who
 *  decided it, and no other answer held after the reviewer was asked once more, says why in the page's words
 *  (PAGE_COLUMN_REASON_WORDS `decision_column_refuted`). A page with no such decision moves by this version string
 *  alone. And W1 B (story /20), in the same unreleased /25: an edit against what you said whose rule is a project
 *  instruction file the main agent was given before the change shows that file's words labelled as the file's, never as
 *  words you said (`forbiddenEditLabel`). */
/** /26 (W2, owner decision 2026-10-13; story /21): a claim contradicted by the text the agent's own edit or write added
 *  (ledger.js CONTRADICTION_SOURCES `own_written`) is headed by those words (PAGE_CONTRADICTION_WORDS) and labels that
 *  text "Code the agent wrote"; a statement written into a file that such text contradicts says so (`writtenWords`). A
 *  page with no such claim or statement moves by this version string alone. */
/** /27 (W4, owner decision 2026-10-14): an ask published not-done because no action was recorded after it says so under
 *  the agent's last message (PAGE_REQUIREMENT_FACT_WORDS `no_action_after_ask`: "Not done in this session: no action
 *  was recorded after you asked."). A page with no such ask moves by this version string alone. */
/** /28 (D87, owner decisions 2026-10-13/14; story /23; built beside W4 as /27 and story /22, renumbered at their merge):
 *  a review with a code pass (`report.codePass`) lists what the code
 *  review found (`codePart`, "What the code review found"): the claims, asks and decisions its check found contradicted
 *  by the code at review time, then each upheld finding — its title and explanation (the review's words), its path and
 *  lines, its code quote shown only when it is found again in the span stored with the file's sha256 (`codeQuoteOf`),
 *  and the row it follows from; each checked row says its code check beside its status (`codeCheckNote`); and the
 *  attention lines count both. A page of a review without a code pass moves by this version string alone. */
/** /29 (the W4 revert, owner decision 2026-10-14; story /24): W4 is removed, so no ask is published not-done for
 *  `no_action_after_ask` and PAGE_REQUIREMENT_FACT_WORDS no longer holds its words; a stored report that carries that
 *  fact shows its row's status and quote with no words for it. A page of a report without that fact moves by this
 *  version string alone. */
/** /30 (D88, owner decision 2026-10-14, amending D71 S2's "every row short of done points attention"; story /25): the
 *  page leads with the agent's judgment and the settled problems. Its summary counts only review.js ATTENTION_ROWS, in
 *  that order (choices not to act; decisions made without asking you, where you asked and it chose how, where the review
 *  could not tell whether you asked; changes of approach; asks shown not done or partly done; claims the recording
 *  contradicts; rows the code at review time contradicts; failures passed over; edits against what you said; statements
 *  written into a file and contradicted; the code review's findings), then one plain line saying how many rows Sonah
 *  could not check are folded, and where. Its sections follow: what the agent decided, what you asked (the settled asks),
 *  the failures it passed over, what the agent told you (contradicted and confirmed claims), the edits against what you
 *  said, what the code review found, and last a native, closed `<details>` "What Sonah could not check (N)" that keeps
 *  every FOLDED_ROWS row — the asks not checked, the claims not checked or resting on a check that never completed, the
 *  failures not checked, the statements written into files and not checked, each listed in full up to the page's display
 *  bounds (`foldedRows`) — with what could not be checked of the session (the former "What could not be checked"). Each section that holds folded rows says how many.
 *  Every row keeps its evidence and its id; no row is removed; the page still runs no script. */
/** /31 (the code step, code-pass/2; story /26; built beside D88 as
 *  /30 and story /25, renumbered at their merge): "What the code review found" (`codePart`) lists, in order, the
 *  findings that follow from a row of the session review placed beside that row (with the rows the check found
 *  contradicted by the code), then the other findings in table-of-contents order, then the open questions for you, then
 *  what the code review did not cover. A finding says its kind, its place, its title and explanation, the input it names
 *  and the steps of its trace, each step's quote shown only when it is found again (`codeQuoteOf`, `sessionQuoteOf`), and
 *  the lenses that reached it. The section keeps D88's place, and D88's summary counts its findings (beside a row or
 *  not) under `codeFindings` and the rows its check found contradicted under `codeContradicted`, both linked to it. A
 *  page of a review without a code pass moves by this version string alone. */
/** /32 (the review of the code step, 2026-10-14; story /27; built beside D88 as /31 and story /26, renumbered at their
 *  merge): what the code review did not cover also says, by count only, how many paths outside the working
 *  directory differ from where the session started (`codeFooterLines`: the code step's git lists stop at the working
 *  directory and never name them). A page of a review with no such path moves by this version string alone. */
/** /33 (the judgment-first review, 2026-10-14; story /28): one counting for every reader — the page counts its rows
 *  with review.js `rowKindCounts`, lists the claims every reader lists (`listedPromises`: one a contradicted-claim
 *  finding cites is that finding) and reads who decided by the one rule (`derivedColumn`); and in What Sonah could not
 *  check each group is headed by how many rows of its kind the page holds, shown or not, a group none of whose rows fit
 *  is still headed, and what does not fit is said inside its own group (`foldedRows`). A page none of whose folded groups
 *  is cut moves by this version string alone. */
/** /34 (the release review, 2026-10-14; story /29): with the home folder as the repository, what the code review did
 *  not cover says that only the files the session changed or read were read, and counts the other paths that differ
 *  (`codeFooterLines`, the snapshot's `base.homeRepository`); and the code review's coverage is said plainly, now that
 *  it no longer decides the exit code unless asked for (story.js `codeCoverageLines`): it did not run because the
 *  recording's working directory is not here, it had no file to read, or it did not read every file it showed or did
 *  not complete. A page with no code pass, or one whose code pass read every file it showed, moves by this version
 *  string alone. */
export const PAGE_VERSION = 'sonah.session-page/34';

/** The page's colour themes. `system` (the default) follows the reader's setting; `light` and `dark` fix the theme. */
export const PAGE_THEMES = Object.freeze(['system', 'light', 'dark']);
const [SYSTEM] = PAGE_THEMES;

/** Every bound the page keeps. `maxBytes` is the hard bound on the whole page: past it the step section keeps only
 *  titles, then the file list is only counted (and an instruction's steps are not summarised), then the edits are not
 *  shown, then a long request is shown only up to `askChars`, then a decision's checked instructions are only counted
 *  and every list is halved (the findings last) until the page fits — each stated where it happens. A page with every
 *  list cut to nothing holds only fixed words and counts, so it fits. */
export const PAGE_LIMITS = Object.freeze({
  quoteChars: 120, askChars: 280, textChars: 160, briefChars: 70, commandChars: 80, pathChars: 120, snippetLines: 24,
  snippetLineChars: 160, findings: 30, decisions: 150, promises: 50, pivots: 15, steps: 400, files: 200,
  asks: 40, rowsPerAsk: 8, maxBytes: 600_000,
  // Bounds the step list, the unasked decision's checked instructions (and the instructions shown beside a decision the
  // review could not check), a request's step runs, the other edits a row names, and the failed commands a row shows.
  filesPerStep: 15, checks: 8, stepRuns: 10, namedEdits: 3, citedFailed: 3,
  // D71 (S4): the failure rows each group of the failures section shows, and the actions a row rests on. Display bounds
  // like the others, never a rule (S6, S5 review N10/L9): `failures` is well above the RESULTs one window lists, and
  // `restsOn` matches the few actions a row names elsewhere
  // (`namedEdits`, `citedFailed`); past either the rest is counted, and `maxBytes` (halving every list, `LIST_BOUNDS`) is
  // what bounds the page.
  failures: 100, restsOn: 5,
  // S6 (S5 review M4): the lines of the agent's closing messages listed under what it told you (no claim covers them, or
  // the review read them as asserting nothing), in all: above the lines of nearly every closing message; past it the
  // rest are counted, and `maxBytes` halves it with every list.
  closingLines: 200,
  // D69 f (g): the requests past `asks`, one line each; the failed commands no row cites, folded; the rows one row links.
  askLines: 400, failedList: 200, links: 8,
  // D88: the asks not checked listed under What Sonah could not check (the asks' own bound, `asks` times `rowsPerAsk`,
  // is the most the requests above could list whole); past it the rest are counted, and `maxBytes` halves it.
  foldedAsks: 320,
});

// ---- reader words ---------------------------------------------------------------------------------------
// Only counts, step numbers and recorded, review-authored or human-answered text (escaped and clipped) are filled in.

const [SETTLED, CHOSE, UNASKED] = DECISION_COLUMNS;
const [ACTED_ON, TOLD_HUMAN, PASSED_OVER, FAILURE_NOT_CHECKED] = FAILURE_HANDLINGS;
const CLAIM_CONTRADICTED = 'claim_contradicted';
const UNCHECKED = 'unchecked';
const [SELF_CORRECTED] = DISCLOSURE_REASONS;

/** The decision groups, in the order they are shown, and their headings. D71 (S4), the checklist's order: made without
 *  asking you, you asked and the agent chose how, you settled (folded: they are yours), could not check whether you
 *  asked. */
export const PAGE_GROUP_ORDER = Object.freeze([UNASKED, CHOSE, SETTLED, UNCHECKED]);
export const PAGE_GROUP_WORDS = Object.freeze({
  [UNASKED]: 'Made without asking you', [CHOSE]: 'You asked, the agent chose how', [SETTLED]: 'You settled',
  [UNCHECKED]: 'Could not check whether you asked',
});
/** The parts of the sentence that counts the decisions, by group. */
export const PAGE_DECIDED_WORDS = Object.freeze({
  [UNASKED]: 'made without asking you', [CHOSE]: 'where you asked and the agent chose how', [SETTLED]: 'you settled',
  [UNCHECKED]: 'where it could not check whether you asked',
});
/** D71 (a), owner decision 2026-10-08: where your attention is needed — the checklist's summary, at the page's front.
 *  Fixed words filled with counts only, each linked to the section that lists it, in the checklist's order; a line only
 *  when its count is above zero, the last when none is. D71 (S4): it counts what needs your attention, never what is
 *  done, so no line reads as a grade; a choice not to act and a failure the agent passed over are highlighted (D71 d,
 *  c). Never a verdict: no line says the work is right, or that it needs your decision. */
export const PAGE_ATTENTION_WORDS = Object.freeze({
  heading: 'Where your attention is needed',
  // D88: one line per kind of review.js ATTENTION_ROWS, in its order, by the same key.
  notActing: (n) => `${plural(n, 'choice')} not to act`,
  unasked: (n) => `${plural(n, 'decision')} made without asking you`,
  chose: (n) => `${plural(n, 'decision')} where you asked and the agent chose how`,
  whetherAsked: (n) => `${plural(n, 'decision')} where the review could not check whether you asked`,
  pivots: (n) => `${plural(n, 'change')} of approach`,
  asksNotDone: (n, parts) => `${n === 1 ? 'One ask of yours is' : `${n} asks of yours are`} shown not done or partly done: `
    + parts,
  contradicted: (n) => `${plural(n, 'claim')} of the agent's contradicted by the recording`,
  // D87: the code pass's lines, in the owner's words.
  codeContradicted: (n) => `${n} ${n === 1 ? 'claim' : 'claims'} (asks, decisions) contradicted by the code at review time`,
  passedOver: (n) => `${plural(n, 'failure')} the agent passed over`,
  forbidden: (n) => `${plural(n, 'edit')} against what you said`,
  writtenContradicted: (n) => `${plural(n, 'statement')} written into a file and contradicted by a recorded result`,
  codeFindings: (n) => `${plural(n, 'finding')} of the code review`,
  stepsNotReviewed: (n, total) => `${n} of ${plural(total, 'step')} ${n === 1 ? 'was' : 'were'} not reviewed`,
  reviewIncomplete: 'The session review did not complete',
  notCovered: 'Some of what happened could not be checked',
  // D88: the one plain line for the rows Sonah could not check (review.js FOLDED_ROWS): how many, and where.
  folded: (n) => `${plural(n, 'row')} Sonah could not check: folded under What Sonah could not check, at the end`,
  none: 'The review lists nothing here for your attention. That is not a statement that the work is right.',
  // A combined report's code-review findings, which the page does not list.
  codeReviewNote: (n) => `This page covers the session only: the code review's ${plural(n, 'finding')} `
    + `${n === 1 ? 'is' : 'are'} not on it.`,
});
/** D88: the section each counted kind is listed in (its anchor), and the kinds the summary highlights (D71 c, d). */
const ATTENTION_PLACES = Object.freeze({ notActing: 'decisions', unasked: 'decisions', chose: 'decisions',
  whetherAsked: 'decisions', pivots: 'decisions', asksNotDone: 'requests', contradicted: 'claims', codeContradicted: 'code',
  passedOver: 'failures', forbidden: 'edits', writtenContradicted: 'edits', codeFindings: 'code' });
const ATTENTION_HIGHLIGHTS = Object.freeze(['notActing', 'passedOver']);
/** D87: the code pass's words on the page: the story's (`STORY_CODE_WORDS`), one table for both readers. */
export const PAGE_CODE_WORDS = STORY_CODE_WORDS;
/** The receipt labels a decision's quotes carry, beside the story's finding labels. */
export const PAGE_VOICE_LABELS = Object.freeze({
  instruction: 'You said', settled: 'You settled it', commentary: 'Agent said', helper: STORY_HELPER_STATEMENT_LABEL,
  'added-code': 'Code written', path: 'Agent did', command: 'Agent ran',
});
/** D83 (2): the label of words a project instruction file the agent was given holds, by the file's recorded path: the
 *  person's words, written for the agent in that file, never said in the session. Later: a path outside the
 *  working tree as written (absolute, home-relative, climbing out) is named by its file name alone (`referredPath`). */
export const PAGE_REFERRED_LABEL = (path) => `Referred from ${clipPath(referredPath(path))}`;
/** The labels whose quote is the agent's own (its words, a helper's, its code or its action), never the human's. */
const AGENT_VOICES = Object.freeze([PAGE_VOICE_LABELS.commentary, PAGE_VOICE_LABELS.helper, PAGE_VOICE_LABELS['added-code'],
  PAGE_VOICE_LABELS.path, PAGE_VOICE_LABELS.command]);
/** The page's headings, labels and chips: fixed words, filled with counts only. */
export const PAGE_LABELS = Object.freeze({
  // D71 (S4): the checklist's sections, in its order.
  review: 'Sonah review', decisions: 'What the agent decided', requests: 'What you asked',
  claims: 'What the agent told you', failures: 'Failures it passed over',
  edits: 'Edits against what you said, and statements it wrote into files',
  // /18 (D79): the commands the record says failed, and apart from them the ones the recorder typed as refused before
  // they ran.
  failed: 'Commands that failed or did not run', pivots: 'Changes of approach', steps: 'Step by step',
  // D80: the same part when it also holds a command the recorder typed as stopped before it finished.
  failedStopped: 'Commands that failed, did not run or stopped',
  // D70 (b): what a decision of how was written or run in, beside its quote (D70 review: code, a command or a path).
  howCode: 'What it wrote or ran for it',
  // D88: the former "What could not be checked", now the collapsed section that also lists every row Sonah could not
  // check (review.js FOLDED_SECTION_WORDS).
  files: 'Files changed', unchecked: FOLDED_SECTION_WORDS.heading, replied: 'You replied', youAsked: 'You asked',
  finding: 'Finding', decision: 'Decision', chosen: 'Chosen', pivot: 'Changed approach',
  claim: 'Claim', helper: 'helper', editCited: 'The edit it cites:', editMade: 'The edit it was made in:',
  checkedSummary: 'Show the instructions it checked',
  moved: (from, to) => `Moved from ${from} to ${to}`, wholeAsk: 'Show the whole request', partlyChecked: 'Checked only in part',
  // D79: a file you attached to a message, shown under that message; its whole text folded as a long request's is.
  youAttached: 'You attached', wholeAttached: 'Show the whole attached file',
  missingWords: 'Your words may be missing', reviewWordsOnly: "No word or action of the agent's",
  failedCited: 'Failed command it cites',
  // /18 (D79): a command it cites that the recorder typed as refused before it ran; its chip reads the story's one
  // phrase for it, "did not run".
  didNotRunCited: 'Command it cites that did not run', didNotRun: STORY_SENTENCES.didNotRun,
  // D80: a command it cites that the recorder typed as stopped; its chip reads the one phrase, "stopped before it
  // finished". And the writes of a failed or stopped command, listed apart from the changed files.
  stoppedCited: 'Command it cites that stopped before it finished', stopped: STORY_SENTENCES.stopped,
  unconfirmedWrites: 'Writes not recorded as done',
  stepAsk: 'Your instructions here',
  // D69 f (g).
  concerns: 'Concerns', citedIn: 'Cited in', stepsDid: 'What its steps did', changedFiles: 'Files its cited actions changed',
  whyUnchecked: 'Why it could not check', pivotHere: 'It changed approach here', answer: 'Your answer',
  decisionId: 'Decision id', lastCommand: 'last command of the session',
  failedList: (n) => `Show the ${n === 1 ? 'failed command' : `${n} failed commands`} no row cites`,
  // /18 (D79): the same fold when it also holds a command that did not run.
  flaggedList: (n) => `Show the ${n === 1 ? 'command' : `${n} commands`} no row cites`,
  addressedFold: (n) => `Show the ${n === 1 ? 'request' : `${n} requests`} the review read as fully addressed`,
  settledFold: (n) => `${PAGE_GROUP_WORDS[SETTLED]} (${n})`,
  stepsNotReviewed: 'Steps not reviewed', notCovered: 'Not covered', untied: 'Not tied to one request',
  unlisted: 'In requests this page does not list', whetherAsked: 'Whether you asked', reviewWords: "Only in the review's words",
  reviewRecord: 'The review', noInstruction: 'no instruction named',
  // D71 (S4): the checklist rows' labels.
  settles: 'What settles it', missing: 'What is missing', restsOn: 'It rests on a check that never completed',
  whyNotChecked: 'Why it is not checked', rowId: 'Row id', tool: 'Tool', ran: 'Agent ran',
  notActing: 'A choice not to act',
  // D88: the groups of the rows Sonah could not check are review.js FOLDED_SECTION_WORDS.groups.
  turnEnded: 'Its turn ended with', passedOver: 'Passed over',
  handledFold: (n) => `Show the ${n === 1 ? 'failure' : `${n} failures`} it acted on or told you about`,
  confirmedFold: (n) => `Show the ${n === 1 ? 'claim' : `${n} claims`} confirmed by a recorded result`,
  contradictedGroup: 'Contradicted',
  // S6 (S5 review M4): the closing messages' lines no claim covers, and those the review read as asserting nothing.
  closingUnreviewedFold: (n) => `Show the ${n === 1 ? 'line' : `${n} lines`} of its closing messages no claim covers`,
  closingListedFold: (n) => `Show the ${n === 1 ? 'line' : `${n} lines`} of its closing messages the review read as asserting nothing`,
  line: (k) => `Line ${k}`,
  forbiddenGroup: 'Edits against what you said', writtenGroup: 'Statements it wrote into files',
});
/** Fixed sentences. */
export const PAGE_SENTENCES = Object.freeze({
  findingQuotesMissing: 'The recorded quotes for this finding were not found in this recording.',
  decisionQuotesMissing: 'The recorded quotes for this decision were not found in this recording.',
  decisionNoQuote: 'The review recorded no quote for this decision.',
  noText: "The recording did not keep this change's text.",
  noLine: 'The recording shows no changed line in this edit.',
  // D80: above a quoted line the edit kept, outside every hunk, shown in its own window of the edit.
  keptLine: 'This edit did not change the marked line.',
  reviewWords: "In the review's words:",
  sessionOnly: 'The code itself is reviewed separately; this page covers the session.',
  legend: 'Words in highlighted quotation marks were found word for word in the recording when this page was made. '
    + "Everything else is the review's own summary, or your own answer.",
  countLegend: '? and ≥n in line counts: the recording did not keep enough text to count those lines exactly.',
  generated: 'Generated by Sonah from a redacted recording. Read it before you share it.',
  noDecisions: 'The review recorded no decisions.',
  noClaims: 'The review recorded no claims.',
  // /18 (D79): nor typed by the recorder as refused before it ran.
  noFailed: 'No command was recorded as failed or refused.',
  commandWithheld: 'A command not shown: it names a path outside the repository.',
  noFiles: 'No file in the repository was changed.',
  stepsTrimmed: "To keep this page within its size, each step shows only its title.",
  filesTrimmed: "To keep this page within its size, the changed files are only counted here, and an instruction's steps "
    + 'are not summarised.',
  editsTrimmed: 'To keep this page within its size, the edits themselves are not shown.',
  asksTrimmed: 'To keep this page within its size, a long request is shown only in part.',
  listsTrimmed: 'To keep this page within its size, the instructions a decision was checked against are only counted, '
    + 'and the lists are shorter; each says how many it leaves out.',
  otherQuotesMissing: 'Its other recorded quotes were not found in this recording.',
  quotesWithheld: (n) => `${n === 1 ? 'One recorded quote is' : `${n} recorded quotes are`} not shown: this page never `
    + 'shows a path or a file outside the repository, or a file only read.',
  moreEdits: (made, n) => `${made ? 'It was also made in' : 'It also cites'} ${plural(n, 'more edit')}, not shown here:`,
  codeFindings: (n) => `${plural(n, 'finding')} of the code review ${n === 1 ? 'is' : 'are'} not shown: this page covers `
    + 'the session.',
  // What you asked for, at its section (D69 f; D71 (S4): no tally above it — the summary counts only what is not done).
  statusReading: "Each status is the review's reading; no recorded quote shows how the instruction was carried out, "
    + 'so it is not checked against the recording. Beside it: the findings and decisions that cite the same words of '
    + 'yours, and, folded, what its steps did.',
  requirementsRejected: (n) => `${n === 1 ? 'Once' : `${n} times`}, the review named an instruction it did not keep: its `
    + 'words were not found in the recording, or its own check did not uphold it. It is not listed, so its status is '
    + 'unknown.',
  claimsRejected: (n) => `${n === 1 ? 'Once' : `${n} times`}, the review named a claim it did not keep: its words were not `
    + 'found in the recording, or its own check did not uphold it. It is not listed.',
  missingWords: (sentences) => `${sentences}.`,
  partlyChecked: (sentences) => `${sentences}.`,
  noRequestTied: (sentences) => `${capital(sentences)}.`,
  requestsNotShown: (sentences) => `${capital(sentences)}.`,
  // The requests, chosen by status (D69 f (g)).
  askLines: (n) => `${n === 1 ? 'One more request' : `${n} more requests`}, one line each:`,
  moreInstructions: (n, parts, shown) => `${n} ${shown ? 'more ' : ''}${n === 1 ? 'instruction is' : 'instructions are'} not `
    + `shown: ${parts}.`,
  // A decision, by what of the agent's the review found for it.
  reviewWordsOnly: (n) => `${n === 1 ? 'One has' : `${n} have`} no quote of the agent's: no word or action of the agent's `
    + `was found for ${n === 1 ? 'it, so it rests' : 'them, so they rest'} on the review's words.`,
  decidedPivots: (n) => `It also recorded ${plural(n, 'change')} of approach.`,
  // D70 (b), owner decision 2026-10-08: what each of the agent's own decision groups is, said once under its heading.
  unaskedLead: 'No instruction of yours asked for these: the agent decided them on its own. They come first because '
    + 'they are the more serious: confirm or overrule each one.',
  howLead: 'You asked for the work and left how to do it to the agent. When writing code is cheap and everyone has the '
    + 'same models, what it wrote and how it wrote it is the judgment to check: each shows your words it served, '
    + 'the choice it made (in its own words where it said so) and, where the review cited it, what it wrote or ran for '
    + 'it. Less serious than a decision made without asking you.',
  howAskedMissing: 'Your words it served were not found in this recording.',
  howAskedNone: 'The review recorded no words of yours for it.',
  howWordsMissing: 'Its own words for this choice were not found in this recording; below, the review\'s.',
  howWordsNone: 'The review recorded no words of the agent\'s for this choice; below, the review\'s.',
  howCodeMissing: 'The code or action it cites for this choice was not found in this recording.',
  howCodeNone: 'The review cited no code or action of the agent\'s for this choice.',
  // /13: said of the decision, never of its step (a step may hold several requests, or none before it).
  stepInstructions: (k) => `To judge whether you asked for this: your instructions in request ${k}, the request it was made `
    + 'under.',
  stepNoInstructions: (k) => `To judge whether you asked for this: the review named no instruction in request ${k}, the `
    + 'request it was made under; its words are listed above.',
  stepNoRequest: 'To judge whether you asked for this: no request of yours comes before it.',
  // Your answer to a decision (D69 f (g)): recorded by `sonah decision` on this computer, read back as an input.
  // D71 (S4): for every checklist row with an id (a decision, a claim, an ask, a failure, an edit, a statement written
  // into a file), not only a decision. /14: the command is printed once, with the session's hash; under each row only
  // its id. Where the report is kept is said in the same words on every computer: the page names no folder of its own.
  answerIntro: 'A command records your answer to a row on this computer only: run it with accept, change or clarify, the '
    + 'id under the row as ROW_ID, the review report this page was made from as REPORT, and your reason.',
  answerReport: "REPORT is the review's report.private.json, in ~/.sonah/session-reviews/<SHA-256 of the recording's "
    + 'path>/review/, or in <--state-dir>/review/ if the review was given one.',
  answerReason: 'Your reason:',
  answerCommand: (hash) => `sonah decision accept|change|clarify ${hash} ROW_ID --report REPORT --reason "YOUR REASON"`,
  // The failed commands, folded (D69 f; D69 f (g): the uncited ones listed, folded). /18 (D79): and, counted apart, the
  // commands the recorder typed as refused before they ran; `cited` and `rest` count both kinds. D80: and, apart, the
  // ones it typed as stopped before they finished (`stopped`), counted in `cited` and `rest` too.
  failedFolded: (failed, didNotRun, total, cited, rest, stopped = 0) => {
    const refused = `${PAGE_LABELS.didNotRun} (refused before ${didNotRun === 1 ? 'it' : 'they'} ran)`;
    const them = cited === 1 ? 'it' : 'them';
    const of = `of ${plural(total, 'command')}`;
    const parts = [[failed, 'failed'], [didNotRun, refused],
      [stopped, stopped === 1 ? STORY_SENTENCES.stopped : STORY_SENTENCES.stoppedMany]].filter(([n]) => n > 0)
      .map(([n, words], i) => (i === 0 ? `${n} ${of} ${words}` : `${n} ${words}`));
    const head = parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
    return head + `${cited ? `; ${cited} ${cited === 1 ? 'is' : 'are'} shown beside the row that cites ${them}` : ''}`
      + `${rest ? `; ${rest} ${rest === 1 ? 'is' : 'are'} cited by no row on this page` : ''}`;
  },
  moreFailed: (n) => `and ${plural(n, 'more failed command')} it cites.`,
  // /18 (D79): the same cut when what it leaves out also holds a command that did not run.
  moreFlagged: (n) => `and ${plural(n, 'more command')} it cites.`,
  lastFailed: (cited) => `The session's last command failed; ${cited ? 'it is shown beside the row that cites it'
    : 'it is listed first below'}.`,
  // D71 (S4): the checklist rows.
  statusChecked: 'Each status was checked by code against the evidence shown beside it: what settles it, or what is '
    + "missing. A row the review could not settle is kept as not checked, with why, under What Sonah could not check. "
    + 'Beside it: the rows that cite the same words of yours, and, folded, what its steps did.',
  evidenceMissing: 'The evidence it cites was not found in this recording.',
  notActingLead: (n) => `${n === 1 ? 'One is a choice' : `${n} are choices`} not to act, highlighted: the agent decided `
    + 'not to do something, in its own words.',
  failuresIntro: FAILURE_SECTION_WORDS.intro,
  noFailures: FAILURE_SECTION_WORDS.none,
  failuresNotReviewed: 'Where the review of a step did not finish, its failures are not listed here.',
  noEdits: 'The review recorded no edit against what you said and no statement written into a file.',
  moreRestsOn: (n) => `and ${plural(n, 'more action')} it rests on.`,
  // What could not be checked (D69 f (g)).
  allReviewed: (total) => (total === 1 ? "The session's one step was reviewed." : `All ${total} steps were reviewed.`),
  stepsNotReviewed: (n, total) => `${n} of ${plural(total, 'step')} ${n === 1 ? 'was' : 'were'} not reviewed:`,
  stepsNotFinished: (n) => `The review of ${n === 1 ? 'that step' : 'those steps'} did not finish.`,
  reviewIncomplete: 'The session review did not complete.',
  recordSilent: "The review's record does not say which evidence was missing.",
  nothingMissing: 'The recording declared nothing missing.',
  whetherAsked: (words) => `${capital(words)}:`,
  reviewWordsRows: (n) => `${n === 1 ? 'One instruction is' : `${n} instructions are`} shown only in the review's words: `
    + `${n === 1 ? 'its quote was' : 'their quotes were'} not found in your request, so ${n === 1 ? 'it' : 'they'} cannot be `
    + 'checked against what you said:',
  inSteps: 'in',
  // /22 (D84 (4) c review): one step "which holds" its rows, several steps "which hold" them.
  holding: (steps) => (steps === 1 ? 'which holds' : 'which hold'),
});

/** D71 (S4): the checklist's reader words (review.js, one table each for the page and the PR comment): why an ask was
 *  kept as not checked, the fact beside it, what the agent did about a failure and why a failure row is not checked, a
 *  result's outcome, and what contradicts a claim. */
export const PAGE_REQUIREMENT_REASON_WORDS = CHECKLIST_REQUIREMENT_REASON_WORDS;
export const PAGE_REQUIREMENT_FACT_WORDS = CHECKLIST_REQUIREMENT_FACT_WORDS;
export const PAGE_FAILURE_WORDS = CHECKLIST_FAILURE_WORDS;
export const PAGE_FAILURE_REASON_WORDS = CHECKLIST_FAILURE_REASON_WORDS;
export const PAGE_OUTCOME_WORDS = CHECKLIST_OUTCOME_WORDS;
export const PAGE_CONTRADICTION_WORDS = CHECKLIST_CONTRADICTION_WORDS;

/**
 * The page's words for each part reason that is a gap (ledger.js PART_REASONS but the two that are findings, which the
 * page lists itself), said beside the request whose turn the part is (D69 f): what it means for judging that request,
 * never "part" or "window". The reason vocabulary stays closed in ledger.js; these are only its reader words.
 */
export const PAGE_GAP_WORDS = Object.freeze({
  // D71 (a): said by what did not settle, never as something that "could need your decision".
  decide_unsettled: 'a check on an agent claim a recorded result contradicts, or on a change against your instruction, '
    + 'did not settle',
  window_incomplete: 'the review of some of its work did not finish',
  proposal_unreadable: 'the review returned an answer about it that could not be read',
  reading_capped: 'a check on what the review found in it could not run',
  review_unattributed: 'a check that could not run names no request, so its work is not shown as checked',
  no_reviewable_event: 'it holds nothing the review could read: no instruction, message, action or result',
  // D69 f (g): what the reader cannot verify, never the recorder's own terms.
  gap_declared: 'some of what happened in it was not recorded, so the review could not see all of its work',
  instruction_omitted: 'one of your instructions in it was elided by the recorder or withheld by redaction',
  delegation_unlinked: "a helper it started has no linked record, so the helper's work is not reviewed",
  gap_unplaced: 'the recording says something was not recorded without saying where, so it may affect any request here',
  limit_unattributed: 'the session has a coverage limit no request explains',
});
const amount = ({ n, atLeast } = {}) => (Number.isSafeInteger(n) && n >= 0 ? `${atLeast === true ? 'at least ' : ''}${n}` : 'some');
/** One of a count the page can say (`n` exactly 1), for a noun's agreement; "some" and "at least" read as plural. */
const single = (counts = {}) => counts.n === 1 && counts.atLeast !== true;
const nonzero = (counts = {}) => (Number.isSafeInteger(counts.n) && counts.n > 0 ? amount(counts) : 'some');
/** The page's own words for the coverage causes review.js says in review-window or part terms (D69 f: a reader sees steps,
 *  and a step is one of your requests, held by one or more review windows — `storyFacts`, story /14 — and requests, never
 *  parts; `causesOf` counts `windows_incomplete` in steps), and (D69 f (g)) for the causes it says in the recorder's
 *  terms: what the reader cannot verify. Every other cause is said in review.js's own sentence (`COVERAGE_SENTENCE`). */
export const PAGE_CAUSE_WORDS = Object.freeze({
  no_windows: () => 'the review produced no steps',
  windows_incomplete: ({ n, m } = {}) => `${amount({ n })} of ${amount({ n: m })} step${m === 1 ? '' : 's'} `
    + `${n === 1 ? 'was' : 'were'} not fully reviewed`,
  input_limit: (counts) => `${amount(counts)} action/result pair(s) were reviewed in separate steps`,
  carry_capped: (counts = {}) => `${amount(counts)} earlier item${counts.n === 1 ? ' was' : 's were'} kept out of a step's review by `
    + 'its size bound',
  incomplete_inventory: (counts = {}) => `the recording says ${nonzero(counts)} of its records ${single(counts) ? 'is' : 'are'} `
    + `incomplete, so what ${single(counts) ? 'it' : 'they'} held cannot be checked`,
  observations_incomplete: (counts = {}) => `${nonzero(counts)} result${single(counts) ? '' : 's'} of the agent's actions `
    + `${single(counts) ? 'was' : 'were'} not recorded or could not be linked to ${single(counts) ? 'its action' : 'their actions'}, `
    + `so whether ${single(counts) ? 'it' : 'they'} succeeded cannot be checked`,
  unsupported_message: (counts = {}) => `${amount(counts)} record${single(counts) ? ' was' : 's were'} in a form Sonah cannot `
    + `read, so what ${single(counts) ? 'it' : 'they'} held is not reviewed`,
  write_outcome_unknown: (counts = {}) => `${amount(counts)} file write${single(counts) ? ' has' : 's have'} no recorded result, `
    + `so whether ${single(counts) ? 'it' : 'they'} happened cannot be checked`,
  command_outcome_unknown: (counts = {}) => `${amount(counts)} command${single(counts) ? ' has' : 's have'} no recorded exit `
    + `status, so whether ${single(counts) ? 'it' : 'they'} passed cannot be checked`,
});
const causeSentence = ([cause, counts]) => (Object.hasOwn(PAGE_CAUSE_WORDS, cause) ? PAGE_CAUSE_WORDS[cause](counts)
  : COVERAGE_SENTENCE[cause](counts));
/** The coverage causes (review.js COVERAGE_CAUSES) that say the human's own words may be missing from the instruction
 *  history: shown in "What you asked for", above the requests (D69 f), and listed again under "What could not be
 *  checked". A fixed subset of a closed vocabulary, chosen by what each cause's sentence says is missing — the human's
 *  instructions, rows, answers or the words typed with a command. */
export const PAGE_ASK_CAUSES = Object.freeze(['instructions_elided', 'instructions_withheld', 'instructions_capped',
  'instructions_stripped', 'instructions_nontext', 'instructions_nontext_unplaced', 'labels_legacy_recorder',
  'interruptions_untyped', 'commands_args_unrecorded', 'answers_unrecorded',
  'origins_unknown', 'instructions_refusal_untyped', 'instructions_refusal_session_unknown', 'human_interaction_unknown']);
/** D69 f (g): why the review could not check whether you asked for a decision — its column reason (ledger.js
 *  `deriveColumn`, a member of the closed JUDGMENT_REASONS) in the page's words. The vocabulary stays closed in
 *  ledger.js; these are only its reader words. */
export const PAGE_COLUMN_REASON_WORDS = Object.freeze({
  instructions_partial: 'your instructions before it were not all recorded in full, so whether one covered it could not '
    + 'be checked',
  column_unchecked: "the review's reading of whether you asked did not pass its own checks",
  ambiguous_authority: 'the instruction it cites could not be shown to be yours, or to come before the agent acted',
  receipt_rejected: 'the words of yours it cites were not found in the recording',
  // S6 (S5 review H1), owner decision D71 (b): a decision kept "could not tell" because its own challenge did not settle.
  unsettled: "the review's own check on it did not settle",
  unreviewed_scope: "the review's own check on it did not run",
  // W1 A (owner decision 2026-10-13): a decision kept "could not tell" because its check refuted who decided it, its
  // choice was upheld, and no other answer held after the reviewer was asked once more.
  decision_column_refuted: "the review's own check rejected who it first said decided it, and no other answer held",
});
/** D69 f (g): your earlier answer to a decision (`sonah decision`, packages/cli/src/decision-command.js), by its verb. */
export const PAGE_ANSWER_WORDS = Object.freeze({ accept: 'You accepted it.', change: 'You asked to change it.',
  clarify: 'You asked for clarification.' });

/** The value fields a grounded decision value may quote (ledger.js VALUE_FIELDS), each with its own label: the receipt
 *  role it must carry, and what of the recording it may show (`pageQuote`). */
const VALUE_FIELDS = Object.freeze(['added-code', 'path', 'command']);
const VALUE_ROLE = Object.freeze({ 'added-code': 'code', path: 'action', command: 'action' });
const VALUE_QUOTE = Object.freeze({ 'added-code': 'after', path: 'path', command: 'command' });
// A finding's internal status, read only for the recorded fact it stands beside (an undone forbidden edit is FYI with
// `self_corrected`); D71 (a): never shown.
const FYI = 'FYI';
const CODE_REVIEW = 'code-review';
/** The part reasons that are a finding, which the page lists itself; every other reason is a gap. */
const FINDING_PART_REASONS = Object.freeze(PART_REASONS.slice(0, 2));
/** Levels of what the page leaves out to stay within `maxBytes`, in order. */
const TRIM = Object.freeze({ none: 0, steps: 1, files: 2, edits: 3, asks: 4, lists: 5 });
/** The list bounds the last trim level halves. */
const LIST_BOUNDS = Object.freeze(['findings', 'decisions', 'asks', 'askLines', 'rowsPerAsk', 'promises', 'pivots', 'steps',
  'files', 'filesPerStep', 'failedList', 'failures', 'closingLines', 'foldedAsks']);
/** A ledger decision id (session.js `decisionIdentity`: `sha256:` and 64 lower-case hex digits) and a redacted session
 *  hash (redact/index.js `sliceHash`: 64 lower-case hex digits), by their own fixed forms. */
const DECISION_ID = ROW_ID;
const SESSION_HASH = /^[0-9a-f]{64}$/;
/** The short form of a decision id the page prints and `sonah decision` resolves against the report: its first 12 hex
 *  digits. */
const SHORT_ID = 12;
const shortId = (id) => id.slice('sha256:'.length, 'sha256:'.length + SHORT_ID);

// ---- text safety ------------------------------------------------------------------------------------------

/** The one escape: bidi and invisible characters shown as their code point, controls replaced, then the five
 *  characters HTML reads as markup. Every recorded or review-authored string goes through it. */
export function escapeHtml(text) {
  return visible(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
const esc = escapeHtml;
const list = (value) => (Array.isArray(value) ? value : []);
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const bytes = (text) => Buffer.byteLength(text, 'utf8');
const two = (n) => String(n).padStart(2, '0');
const capital = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const count = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);
/** A heading the review wrote, in sentence case — unless it starts with a code name (`summarizeOrder`, `for/var`),
 *  which keeps its case: only a first word of plain lower-case letters is capitalised. */
const headingCase = (text) => (/^[a-z]+(?=[\s,;:-]|$)/.test(text) ? capital(text) : text);
/** Review-authored or recorded text on one line, clipped, escaped. */
const words = (text, n = PAGE_LIMITS.textChars) => esc(clip(oneLine(text ?? ''), n));
/** "3 more decisions are not shown." ("3 decisions are not shown." when the list shows none.) */
const notShown = (n, one, many = `${one}s`, shown = 1) =>
  `${n} ${shown ? 'more ' : ''}${n === 1 ? one : many} ${n === 1 ? 'is' : 'are'} not shown.`;

/** Does this receipt ground in this session, in this render? */
const grounds = (session, receipt) => plainObject(receipt) && typeof receipt.quote === 'string'
  && verifyReceipt(session, receipt).ok;

// ---- what a quote of the agent's action or code may show ----------------------------------------------------------

/** The changes an event made inside the repository. A write outside it is never quoted, as a path or as text. */
const repoChanges = (session, eventId) => list(session.event(eventId)?.changes)
  .filter((change) => plainObject(change) && change.outsideRepository !== true);

/** Does any blank-delimited token of this text, read alone by the shell's word grammar (session-story.js
 *  `namesOutsidePath`: an absolute pathname, a tilde-prefix, a drive, a `..` climb, after quote removal), name a path
 *  outside the working tree? Each token is read alone because an unquoted blank ends a shell word (POSIX.1-2017 XCU 2.3)
 *  and a quote opened before the text, or never closed in it, must not hide a path inside it: the reading fails closed. */
const tokensNameOutsidePath = (text) => String(text).split(/\s+/).some((token) => token && namesOutsidePath(token));
/**
 * Does a quote of a recorded command touch a path outside the working tree? The quote is read where it stands in the
 * text, widened to the blanks around it (so the widened text holds every word the quote touches, a word cut by the quote
 * included), and each of its tokens is read by the shell's grammar (`tokensNameOutsidePath`). Every place the quote
 * stands is read; any one naming such a path withholds it. A here-document's body (text the command writes) is read the
 * same way: its blank-delimited tokens are what a path in it would be.
 */
function touchesOutsidePath(text, quote) {
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    let from = at, until = at + quote.length;
    while (from > 0 && !/\s/.test(text[from - 1])) from--;
    while (until < text.length && !/\s/.test(text[until])) until++;
    if (tokensNameOutsidePath(text.slice(from, until))) return true;
  }
  return false;
}
/** The string tokens of a JSON text (RFC 8259 section 7: a string begins and ends with an unescaped quotation mark),
 *  as `[from, until)`, quotation marks included. Read only from a text `JSON.parse` accepted, which starts outside one. */
function jsonStringTokens(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '"') continue;
    let j = i + 1;
    while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
    out.push([i, Math.min(j + 1, text.length)]);
    i = j;
  }
  return out;
}
/** RFC 8089: a `file:` URI names a path, and an absolute one. */
const FILE_URI = /^file:/i;
/**
 * Does a quote of a tool's recorded input touch a path outside the working tree? A structured input (one span that is a
 * JSON text, RFC 8259) is read by its grammar: each string value the quote overlaps, decoded and read WHOLE (D69 review
 * F3: a value is read whole), by its tokens (`tokensNameOutsidePath`) or as a `file:` URI. Any other input is free text,
 * read as a command is (`touchesOutsidePath`).
 */
function inputTouchesOutsidePath(text, quote) {
  try { JSON.parse(text); } catch { return touchesOutsidePath(text, quote); }
  const strings = jsonStringTokens(text);
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) {
    for (const [from, until] of strings) {
      if (until <= at || from >= at + quote.length) continue;
      let value;
      try { value = JSON.parse(text.slice(from, until)); } catch { return true; }
      if (FILE_URI.test(value) || tokensNameOutsidePath(value)) return true;
    }
  }
  return false;
}

/**
 * What a grounded receipt shows on the page (`{ quote }`), `{ withheld: true }` when the page never shows what it
 * quotes, or null when it is no quote of this `kind`. Only the agent's own actions and code are checked; every other
 * role (the human's and the agent's words, a recorded result) is shown as recorded.
 *   - Code is shown only from a change inside the repository; `after` (the code written) only from its after side —
 *     a quote of the before side of such a change is no code written (null). Code only a write outside the
 *     repository holds is withheld.
 *   - An action is shown as the path of a change inside the repository (`path`: exactly that path, nothing else), or
 *     as part of the command or tool input the agent ran (`command`: the command only), with any leading
 *     `cd <dir> &&` dropped. One that names a path the event only read or wrote outside the repository is withheld,
 *     and so is any other quote of a command that wrote outside the repository (a heredoc into a plan file carries the
 *     file's body in its command), a command quote whose shell words name a path outside the working tree
 *     (`touchesOutsidePath`) and an input quote whose input value names one (`inputTouchesOutsidePath`).
 */
function pageQuote(session, r, kind = 'any') {
  const quote = r.quote;
  const repo = repoChanges(session, r.eventId);
  if (r.role === 'code') {
    const on = (sides) => repo.some((change) => sides.some((side) => session.textSpansOf(change, side).some((span) => span.includes(quote))));
    if (on(kind === 'after' ? ['after'] : ['after', 'before'])) return { quote };
    return kind === 'after' && on(['before']) ? null : { withheld: true };
  }
  if (r.role !== 'action') return { quote };
  const event = session.event(r.eventId);
  const own = repo.map((change) => change.path).filter((path) => typeof path === 'string' && path);
  if (kind === 'path' && own.includes(quote)) return { quote };
  if (kind === 'any' && own.some((path) => path.includes(quote))) return { quote };
  const elsewhere = list(event?.paths).map((p) => p?.path).filter((path) => typeof path === 'string' && path && !own.includes(path));
  if (elsewhere.some((path) => path.includes(quote) || quote.includes(path))) return { withheld: true };
  if (kind === 'path') return null;
  const commands = session.textSpansOf(event, 'command').filter((span) => span.includes(quote));
  const inputs = kind === 'command' ? [] : session.textSpansOf(event, 'input').filter((span) => span.includes(quote));
  if (!commands.length && !inputs.length) return null;
  if (list(event?.changes).some((change) => plainObject(change) && change.outsideRepository === true)) return { withheld: true };
  const shown = withoutLeadingCd(quote);
  if (!shown.trim()) return { withheld: true };
  if (commands.length) return commands.some((span) => touchesOutsidePath(span, shown)) ? { withheld: true } : { quote: shown };
  return inputs.some((span) => inputTouchesOutsidePath(span, shown)) ? { withheld: true } : { quote: shown };
}
/** A receipt as the page shows it (`pageQuote`), or null when it does not ground in this recording. */
const seen = (session, r, kind = 'any') => (grounds(session, r) ? pageQuote(session, r, kind) : null);
/** The fixed sentences of a row whose quotes are not all shown: the withheld ones counted, the missing ones said. */
function quoteNotes({ shown, withheld, missing, none, notFound }) {
  const notes = [];
  if (!shown && !withheld) notes.push(missing ? notFound : none);
  if (withheld) notes.push(PAGE_SENTENCES.quotesWithheld(withheld));
  if (!shown && withheld && missing) notes.push(PAGE_SENTENCES.otherQuotesMissing);
  return notes.map((text) => `<p class="note">${esc(text)}</p>`).join('');
}

/** A grounded quote, as shown: clipped, on one line, in highlighted quotation marks; the cut mark outside them. */
function said(quote, { code = false } = {}) {
  const full = visible(quote);
  const cut = [...full].length > PAGE_LIMITS.quoteChars;
  const shown = (cut ? clip(full, PAGE_LIMITS.quoteChars).slice(0, -1) : full).replace(/\n/g, ' ');
  const inner = code ? `<code>${esc(shown)}</code>` : esc(shown);
  return `<q class="said">${inner}</q>${cut ? '…' : ''}`;
}
/** A labelled quote: the speaker above it, the quote in the site's blockquote. */
const voice = (label, quote, code = false) =>
  `<div class="voice"><span class="label">${esc(label)}</span><blockquote>${said(quote, { code })}</blockquote></div>`;

/**
 * Status fact (owner decision 2026-10-06): under a claim confirmed by a recorded result, the result's own words it was
 * confirmed through — its support receipt (role observation), as the page shows any receipt (`seen`: grounded here, a
 * quote the page withholds counted) — never the result's status: a status that does not cover its line confirms
 * nothing by itself. Any other claim: nothing.
 */
function confirmingVoice(session, promise) {
  if (promiseWords(promise?.status) !== STORY_PROMISE_WORDS.verified) return '';
  const support = list(promise.receipts).find((r) => plainObject(r) && r.role === 'observation');
  const view = support ? seen(session, support) : null;
  if (view === null) return '';
  return view.withheld ? `<p class="note">${esc(PAGE_SENTENCES.quotesWithheld(1))}</p>`
    : voice(STORY_RECEIPT_LABELS.observation, view.quote);
}

// ---- the page's facts ---------------------------------------------------------------------------------------

/** Your earlier answers, as the page takes them (`options.decisionReviews`: a Map or a plain object, decision id ->
 *  `{ verb, reason }`): only a ledger decision id, a verb the page has words for and a reason with words. */
function answersOf(value) {
  const entries = value instanceof Map ? [...value] : plainObject(value) ? Object.entries(value) : [];
  return new Map(entries.filter(([id, a]) => typeof id === 'string' && DECISION_ID.test(id) && plainObject(a)
    && Object.hasOwn(PAGE_ANSWER_WORDS, a.verb) && typeof a.reason === 'string' && a.reason.trim())
    .map(([id, a]) => [id, { verb: a.verb, reason: a.reason }]));
}

/** Everything the page shows that does not depend on how much of it fits. */
function pageFacts(session, report, options) {
  const facts = storyFacts(session, report);
  // A report whose findings are not a list is read as having none, as the story reads it (honestStatuses needs a list).
  const read = { ...report, findings: list(report.findings) };
  const honest = { ...read, ...honestStatuses(read) };
  const stepOfEvent = new Map();
  for (const step of facts.steps) for (const event of step.events) if (!stepOfEvent.has(event.id)) stepOfEvent.set(event.id, step.index);
  // D80: each event's place in the recording, to list a row's changes and its unconfirmed writes in session order.
  const orderOf = new Map(list(session?.events).map((event, index) => [event.id, index]));
  // The page covers the session, so it lists the session's findings only; a combined report's code-review findings are
  // counted (D71 (a): no status is read for it).
  const findings = facts.findings.filter(sessionFinding);
  // M1: every command the record says failed, by its invocation (a row cites it by the command or by its result); /18
  // (D79): and, apart, every command the recorder typed as refused before it ran (`didNotRun`); D80: and, apart, every
  // one it typed as stopped before it finished (`stopped`). `flagged` is all three, in session order; `failedById`
  // finds any kind for the row that cites it.
  const flagged = facts.whole.commands.filter((c) => c.failed || c.didNotRun || c.stopped);
  const failed = flagged.filter((c) => c.failed);
  const didNotRun = flagged.filter((c) => c.didNotRun);
  const stopped = flagged.filter((c) => c.stopped);
  // D69 f (g): the session's last command, by its place in the recording, when the record says it failed.
  const last = facts.whole.commands.at(-1);
  // D59 (S6, S5 review M1): the end of the window that showed each event (the report's `windowResults`, by the events
  // each one showed; the first window that showed it), so an action a row rests on is said as that window saw its
  // result — never by a result recorded after it, which is not what the row was checked against.
  const windowEndOf = new Map();
  for (const window of list(report.windowResults)) {
    const ids = list(plainObject(window) ? window.eventIds : null).filter((id) => typeof id === 'string');
    const ends = ids.map((id) => session?.event?.(id)?.sequence).filter(Number.isSafeInteger);
    if (!ends.length) continue;
    const end = Math.max(...ends);
    for (const id of ids) if (!windowEndOf.has(id)) windowEndOf.set(id, end);
  }
  return { session, honest, facts, findings, windowEndOf, codeFindings: facts.findings.length - findings.length, stepOfEvent,
    // D87: the code pass's record, when the review ran one (`codePart`, `codeCheckNote`).
    codePass: plainObject(report.codePass) ? report.codePass : null, report,
    orderOf,
    caps: capsOf(1, 1), shownSteps: Math.min(facts.steps.length, PAGE_LIMITS.steps),
    title: typeof options.title === 'string' && oneLine(options.title) ? clip(oneLine(options.title), PAGE_LIMITS.textChars) : null,
    theme: PAGE_THEMES.includes(options.theme) ? options.theme : SYSTEM,
    kind: STORY_RECORDING_KINDS[Object.hasOwn(STORY_RECORDING_KINDS, session?.adapter) && session.adapter !== 'other'
      ? session.adapter : 'other'],
    requirementsRejected: count(report.requirementsRejected), claimsRejected: count(report.claimsRejected),
    // D71 (S4, c): the failures section's rows (a checklist report's; null for a report from before it).
    failures: Array.isArray(report.failures) ? report.failures.filter((row) => plainObject(row) && typeof row.eventId === 'string') : null,
    flagged, failed, didNotRun, stopped, failedById: new Map(flagged.map((c) => [c.event.id, c])),
    lastFailed: last?.failed ? last : null,
    sessionHash: typeof options.sessionHash === 'string' && SESSION_HASH.test(options.sessionHash) ? options.sessionHash : null,
    answers: answersOf(options.decisionReviews), causeEvents: coverageCauseEvents(honest),
    askSpans: new Map(), decisionRowsCache: null, failureGroupsCache: null, rowCountsCache: null, citedShown: new Set(),
    inexactShown: false };
}

/** The list bounds of one composition: each list's `PAGE_LIMITS` bound times `lists` (the findings' times `findings`). */
const capsOf = (lists, findings) => Object.freeze(Object.fromEntries(LIST_BOUNDS.map((key) =>
  [key, Math.floor(PAGE_LIMITS[key] * (key === 'findings' ? findings : lists))])));
/** Is this one of the session's findings (not a code review's)? */
const sessionFinding = ({ f }) => f.origin !== CODE_REVIEW;

/** A link to a step (1-based), or its plain number once the page does not show that step; nothing for no step. */
function stepLink(page, n) {
  if (n === null || n === undefined) return '';
  return n <= page.shownSteps ? `<a class="turn" href="#step-${n}">step ${n}</a>` : `<span class="turn">step ${n}</span>`;
}
/** A report row's step (0-based, or null when no step holds it) as a step number. */
const stepNumber = (step) => (step === null || step === undefined ? null : step + 1);

/** A change's line counts, noting when one is inexact so the legend is shown. */
function countsWord(page, counts) {
  if (inexact(counts)) page.inexactShown = true;
  return esc(lineWord(counts));
}

/** "a, b and c". */
const joined = (parts) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);
/** An in-page reference `{ id, text }` as a link (its target is on the page: the plan only refers to what it shows). */
const xref = ({ id, text }) => `<a href="#${id}">${esc(text)}</a>`;
/** References as links, "a, b and c", at most `links`, the rest counted. */
function xrefs(refs) {
  const shown = refs.slice(0, PAGE_LIMITS.links).map(xref);
  const more = refs.length - shown.length;
  return joined([...shown, ...(more ? [esc(`${more} more`)] : [])]);
}
/** The ids of a row's receipts. */
const receiptIds = (...receipts) => receipts.flat().filter(plainObject).map((r) => r.eventId);
/** Step numbers as linked runs: "steps 1–3, step 5", at most `stepRuns` runs, the rest counted. */
function stepRunsLinks(page, ns) {
  const runs = [];
  for (const n of ns) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else runs.push([n, n]);
  }
  const link = (n, text) => (n <= page.shownSteps ? `<a href="#step-${n}">${text}</a>` : text);
  const shown = runs.slice(0, PAGE_LIMITS.stepRuns).map(([a, b]) => (a === b ? link(a, `step ${a}`) : link(a, `steps ${a}–${b}`)));
  const rest = runs.slice(PAGE_LIMITS.stepRuns).reduce((n, [a, b]) => n + b - a + 1, 0);
  return `${shown.join(', ')}${rest ? `, and ${plural(rest, 'more step')}` : ''}`;
}
const range = ([a, b]) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);

// ---- the plan: what each list shows, and its numbers ---------------------------------------------------------------

/**
 * A decision's grounded quotes, each labelled by who said it, and how many quotes the review recorded for it. The
 * human's words only for a column the ledger derived from them; a settled value's words only when they ground in
 * that same instruction; a value's receipt only when the ledger published one — with its grounded value, or (D79,
 * `value_paraphrased`) kept without a value because the review's value is not word for word in the code it quoted:
 * the ledger publishes no other receipt of an unchecked value — and only as `pageQuote` shows it: "Code written" only
 * on the after side of one of the decision's own writes inside the repository, "Agent did" only for the path of one
 * of them, "Agent ran" only for a command whose words name no path outside the working tree. A value receipt the page
 * withholds is counted. Never the unasked decision's check explanations. `agent`: how many of its grounded quotes
 * are the agent's own (shown or withheld) — D69 f (g): and one more when its cited actions changed a file inside the
 * repository, the agent's own recorded action; none, and the decision rests on the review's words alone.
 */
function decisionVoices(page, x) {
  const { session } = page;
  const { d, who } = x;
  const actions = list(d.actions).filter((id) => typeof id === 'string');
  const voices = [];
  let missing = 0, withheld = 0;
  let codeQuote = null;
  // D70 (b): which of its parts the review recorded but this recording does not show (each also counted in `missing`).
  const lost = { asked: false, stated: false, value: false };
  const instruction = plainObject(d.constrainedBy) && plainObject(d.constrainedBy.instruction) ? d.constrainedBy.instruction : null;
  if ((who === SETTLED || who === CHOSE) && instruction) {
    // /23 (D83 (2)): the covering words may be a project instruction file's (role project-instructions on that file):
    // the person's words written for the agent, labelled by the file they are referred from, never as said in the
    // session. Which it is: the receipt's role and the cited event's kind, both; the path is the recording's.
    const source = session.event(instruction.eventId);
    const file = instruction.role === PROJECT_INSTRUCTIONS_ROLE && source?.kind === PROJECT_INSTRUCTIONS_ROLE ? source
      : null;
    const role = file ? PROJECT_INSTRUCTIONS_ROLE : 'instruction';
    const human = file !== null || source?.authority === 'human';
    const settledQuote = who === SETTLED && typeof d.constrainedBy.settledValueQuote === 'string' ? d.constrainedBy.settledValueQuote : null;
    const settled = settledQuote !== null && human && grounds(session, { eventId: instruction.eventId, role,
      quote: settledQuote, sessionKey: instruction.sessionKey ?? null });
    const spoke = human && instruction.role === role && grounds(session, instruction);
    missing += Number(!spoke) + Number(settledQuote !== null && !settled);
    lost.asked = !spoke;
    const referred = file && typeof file.path === 'string' ? PAGE_REFERRED_LABEL(file.path) : null;
    // The settled value's words are the instruction's own words when the two are one quote: shown once. The fourth
    // member says which part of your words a voice is (`asked`, `settled`), whatever its label.
    if (spoke && !(settled && settledQuote === instruction.quote))
      voices.push([referred ?? PAGE_VOICE_LABELS.instruction, instruction.quote, false, 'asked']);
    if (settled) voices.push([referred ?? PAGE_VOICE_LABELS.settled, settledQuote, false, 'settled']);
  }
  if (plainObject(d.stated)) {
    if (d.stated.role === 'commentary' && grounds(session, d.stated)) {
      const helper = session.event(d.stated.eventId)?.childId != null;
      voices.push([helper ? PAGE_VOICE_LABELS.helper : PAGE_VOICE_LABELS.commentary, d.stated.quote, false]);
    } else { missing++; lost.stated = true; }
  }
  // D79: a published value receipt is shown whether its value grounded or was a paraphrase (`value_paraphrased`, the
  // one unchecked value whose receipt the ledger keeps): the quote is the code the write recorded either way.
  if (plainObject(d.valueReceipt)) {
    const r = d.valueReceipt;
    const value = VALUE_FIELDS.includes(r.field) && r.role === VALUE_ROLE[r.field] && actions.includes(r.eventId)
      ? seen(session, r, VALUE_QUOTE[r.field]) : null;
    if (value === null) { missing++; lost.value = true; } else if (value.withheld) withheld++;
    else {
      voices.push([PAGE_VOICE_LABELS[r.field], value.quote, true]);
      if (r.field === 'added-code') codeQuote = value.quote;
    }
  }
  const changes = changesOf(page, actions);
  const agent = voices.filter(([label]) => AGENT_VOICES.includes(label)).length + withheld + Number(changes.length > 0);
  // The events of the agent's own a row may share with it: its statement, its value's and its actions.
  const agentEvents = [...new Set([d.stated?.eventId, d.valueReceipt?.eventId, ...actions].filter((id) => typeof id === 'string'))];
  return { voices, missing, withheld, codeQuote, actions, agent, changes, agentEvents, lost,
    asked: instruction !== null };
}

/** The decisions by group, each group's rows in step order and, apart after them, those with no word or action of the
 *  agent's. Read once a page: nothing of it depends on what fits. */
function decisionRows(page) {
  if (page.decisionRowsCache) return page.decisionRowsCache;
  const order = (a, b) => ((a.step ?? Infinity) - (b.step ?? Infinity)) || (a.i - b.i);
  page.decisionRowsCache = PAGE_GROUP_ORDER.map((who) => {
    // D71 (S4, d): a choice not to act first in its group (highlighted where it is shown), then the rest in step order.
    const sorted = page.facts.decisions.filter((x) => x.who === who).sort(order);
    const rows = [...sorted.filter((x) => x.d.notActing === true), ...sorted.filter((x) => x.d.notActing !== true)]
      .map((x) => ({ x, view: decisionVoices(page, x) }));
    return { who, voiced: rows.filter(({ view }) => view.agent > 0), only: rows.filter(({ view }) => view.agent === 0) };
  });
  return page.decisionRowsCache;
}

/** Where a grounded instruction receipt sits in its request's recorded text (session-story.js `locateQuote`), or null. */
function locatedReceipt(page, r) {
  if (!plainObject(r) || r.role !== 'instruction' || typeof r.eventId !== 'string' || !grounds(page.session, r)) return null;
  if (!page.askSpans.has(r.eventId)) page.askSpans.set(r.eventId, page.session.textSpansOf(page.session.event(r.eventId), 'text'));
  const at = locateQuote(r, page.askSpans.get(r.eventId));
  return at && { eventId: r.eventId, at };
}

/**
 * D69 f (g): what each list of this composition shows, and the number each shown row is linked by — so every row can
 * link the others it concerns, and a link never points at a row the page does not show.
 *   - findings: the first `findings`, numbered 1..;
 *   - decisions: every group of the agent's own judgments, then your settled ones, at most `decisions`, numbered 1..;
 *     a change of approach whose receipts share an event with a shown decision of the agent's (its statement, its value
 *     or its actions) is shown inside it, the others (at most `pivots`) listed after the decisions;
 *   - claims: the agent's claims, then the statements it wrote into files, at most `promises`, numbered 1..;
 *   - requests, chosen by status, never by order alone (the status token only): first each request the review read as
 *     open or partly addressed in any instruction, then each that holds a gap, then each it named no instruction in,
 *     then (D88) each holding an ask Sonah could not check, which is listed under What Sonah could not check; then the
 *     ones it read as fully addressed (folded) — at most `asks` shown whole, the next `askLines` one line each.
 */
function planOf(page, gaps) {
  const { facts, caps } = page;
  const findings = page.findings.slice(0, caps.findings).map((x, i) => ({ ...x, k: i + 1 }));
  const groups = decisionRows(page).map(({ who, voiced, only }) => ({ who, voiced: voiced.map((row) => ({ ...row })),
    only: only.map((row) => ({ ...row })) }));
  let k = 0;
  for (const group of groups) for (const row of [...group.voiced, ...group.only]) if (k < caps.decisions) row.k = ++k;
  const shownDecisions = groups.flatMap((group) => [...group.voiced, ...group.only]).filter((row) => row.k);
  const order = (a, b) => ((a.step ?? Infinity) - (b.step ?? Infinity)) || (a.i - b.i);
  const attached = new Map(), loose = [];
  const homes = shownDecisions.filter((row) => row.x.who !== SETTLED);
  for (const p of [...facts.pivots].sort(order)) {
    const ids = receiptIds(list(p.p.receipts));
    const home = homes.find((row) => ids.some((id) => row.view.agentEvents.includes(id)));
    if (home) attached.set(home, [...(attached.get(home) ?? []), p]);
    else loose.push(p);
  }
  const pivots = loose.slice(0, caps.pivots).map((p, i) => ({ ...p, k: i + 1 }));
  const promises = [...facts.promises].sort(order);
  const written = [...facts.written].sort(order);
  const shownPromises = promises.slice(0, caps.promises);
  const shownWritten = written.slice(0, Math.max(0, caps.promises - shownPromises.length));
  const claimK = new Map([...shownPromises, ...shownWritten].map((entry, i) => [entry, i + 1]));
  // The status token only: a request with an ask shown not done or partly done first (review.js `askRowKind`, D88), then
  // one holding a gap, then one the review named no instruction in, then one holding any other ask short of addressed
  // (D88: an ask Sonah could not check, listed under What Sonah could not check), then the fully addressed ones — each
  // tier in session order.
  const tier = (ask) => (ask.requirements.some((r) => askRowKind(r) === 'asksNotDone') ? 0 : gaps.byAsk.has(ask.k) ? 1
    : !ask.requirements.length ? 2 : ask.requirements.some((r) => !MET_REQUIREMENT_STATUSES.includes(r.status)) ? 3 : 4);
  const attention = (ask) => tier(ask) < 4;
  const byStatus = [0, 1, 2, 3, 4].flatMap((n) => facts.asks.filter((ask) => tier(ask) === n));
  const full = new Set(byStatus.slice(0, caps.asks).map((ask) => ask.k));
  const lines = new Set(facts.asks.filter((ask) => !full.has(ask.k)).slice(0, caps.askLines).map((ask) => ask.k));
  const plan = { findings, groups, shownDecisions, attached, loose, pivots, promises, written, shownPromises, shownWritten,
    claimK, attention, full, lines, anchored: (n) => full.has(n) || lines.has(n) };
  // What each shown row cites of your words: the findings' instruction receipts and the decisions' instruction (their
  // column's, and the unasked one's checked instructions), each where it sits in your request.
  plan.citing = [];
  for (const { f, k: n } of findings)
    for (const r of list(f.receipts)) { const at = locatedReceipt(page, r); if (at) plan.citing.push({ ...at, ref: { id: `finding-${n}`, text: `finding ${n}` } }); }
  for (const row of shownDecisions) {
    const { d } = row.x;
    const cited = [d.constrainedBy?.instruction, ...list(d.instructionReview?.checks).map((c) => c?.instruction)];
    for (const r of cited) { const at = locatedReceipt(page, r); if (at) plan.citing.push({ ...at, ref: { id: `decision-${row.k}`, text: `decision ${row.k}` } }); }
  }
  return plan;
}

// ---- failed commands, beside the row that cites them -------------------------------------------------------------

/** The failed commands a row cites — /18 (D79): and the ones that did not run — in session order: by the command's
 *  own event (a receipt of it, a decision's action) or by a result recorded for it (a receipt of an observation whose
 *  `invocation` is that command). Structure only: the ids the row cites and the result's recorded link, never its
 *  words. */
function citedFailures(page, ids) {
  const out = new Set();
  for (const id of ids) {
    if (typeof id !== 'string') continue;
    if (page.failedById.has(id)) out.add(id);
    const invocation = page.session.event(id)?.invocation;
    if (typeof invocation === 'string' && page.failedById.has(invocation)) out.add(invocation);
  }
  return page.flagged.filter((c) => out.has(c.event.id));
}
/** A failed command, as a row shows it: its recorded words (or the fixed sentence when it names a path outside the
 *  working tree), "failed" and its exit code — /18 (D79): "did not run" for one the recorder typed as refused —, a
 *  helper's marked, its step. */
function failedLine(page, c) {
  const raw = page.session.textSpansOf(c.event, 'command').join(' ');
  const step = page.stepOfEvent.has(c.event.id) ? page.stepOfEvent.get(c.event.id) + 1 : null;
  const chip = c.didNotRun ? PAGE_LABELS.didNotRun : c.stopped ? PAGE_LABELS.stopped
    : c.exitCode !== null && c.exitCode !== 0 ? `failed, exit ${c.exitCode}` : 'failed';
  const text = commandText(raw);
  return `${text === null ? `<span class="note">${esc(PAGE_SENTENCES.commandWithheld)}</span>` : `<code>${esc(text)}</code>`}`
    + ` <span class="flagchip">${esc(chip)}</span>`
    + `${c.event.childId != null ? ` <span class="pill">${esc(PAGE_LABELS.helper)}</span>` : ''}${step ? ` ${stepLink(page, step)}` : ''}`;
}
/** The failed commands a shown row cites (and, /18, the ones that did not run), each beside it (at most `citedFailed`,
 *  the rest counted); each is then counted as shown, so the failed-command list folds it. */
function failedCitedRows(page, ids) {
  const cited = citedFailures(page, ids);
  if (!cited.length) return '';
  for (const c of cited) page.citedShown.add(c.event.id);
  const shown = cited.slice(0, PAGE_LIMITS.citedFailed);
  return shown.map((c) => `<p class="note meta"><span class="label">${esc(c.didNotRun ? PAGE_LABELS.didNotRunCited
    : c.stopped ? PAGE_LABELS.stoppedCited : PAGE_LABELS.failedCited)}</span> ${failedLine(page, c)}</p>`).join('')
    + (cited.length > shown.length ? `<p class="cut">${esc(capital((cited.slice(shown.length).every((c) => c.failed)
      ? PAGE_SENTENCES.moreFailed : PAGE_SENTENCES.moreFlagged)(cited.length - shown.length)))}</p>` : '');
}

// ---- the diff preview ---------------------------------------------------------------------------------------

/**
 * One recorded change, folded: its path and counts, then one hunk of its edit script, at most `snippetLines` lines
 * of `snippetLineChars`. The hunk that holds `quote`'s first line, else the first; when that line is past the window,
 * the window is centred on it and the line is marked. `side` is the side of the change the quote is on: a quote on the
 * after side (the code written) is looked for, and marked, only on kept and added lines; one on the before side only
 * on kept and removed lines. A change the record kept no edit script of says so.
 * D80 (owner decision 2026-10-12): an after-side quote whose line no hunk holds (a line the edit kept, outside every
 * hunk) is shown in its own window of the edit script (`keptLine`), as many lines as a hunk's, centred on it, the
 * line marked, every line with its own mark (an added or removed line in reach shown as one), and one fixed sentence
 * says the edit did not change it (`PAGE_SENTENCES.keptLine`): never an unmarked first hunk. A quote not found
 * verbatim in the written text keeps the first hunk, as before.
 */
function changePreview(page, change, quote, label, trim, side = null) {
  if (trim >= TRIM.edits) return '';
  const head = `<summary>${esc(label)} <code>${esc(clipPath(oneLine(change.path), PAGE_LIMITS.pathChars))}</code> `
    + `<span class="mono">${countsWord(page, change.counts)}</span>${unconfirmedChip(change)}</summary>`;
  const folded = (body) => `<details class="change">${head}${body}</details>`;
  if (!change.ops) return folded(`<p class="cut">${esc(PAGE_SENTENCES.noText)}</p>`);
  const hunks = hunksOf(change.ops);
  if (!hunks.length) return folded(`<p class="cut">${esc(PAGE_SENTENCES.noLine)}</p>`);
  const needle = typeof quote === 'string' ? quote.split('\n').map((line) => line.trim()).find(Boolean) ?? null : null;
  const onSide = (mark) => (side === 'after' ? mark !== '-' : side === 'before' ? mark !== '+' : true);
  const hit = ([mark, line]) => onSide(mark) && line.includes(needle);
  const found = needle ? hunks.findIndex((hunk) => hunk.some(hit)) : -1;
  const kept = found === -1 && side === 'after' ? keptLine(change, quote, needle) : -1;
  const at = found === -1 ? 0 : found;
  const hunk = kept === -1 ? hunks[at] : change.ops;
  const key = kept !== -1 ? kept : found === -1 ? -1 : hunk.findIndex(hit);
  const room = PAGE_LIMITS.snippetLines;
  const start = hunk.length > room && (kept !== -1 || key >= room)
    ? Math.min(hunk.length - room, Math.max(0, key - Math.floor(room / 2))) : 0;
  const shown = hunk.slice(start, start + room);
  const lines = shown.map(([mark, line], i) => {
    const cls = `ln${mark === '+' ? ' add' : mark === '-' ? ' del' : ''}${start + i === key ? ' key' : ''}`;
    const text = clip(visible(line.replace(/\r/g, '␍')).replace(/\t/g, '  '), PAGE_LIMITS.snippetLineChars - 1);
    return `<span class="${cls}">${esc(`${mark}${text}`)}</span>`;
  }).join('');
  const notes = [];
  if (hunks.length > 1 && kept === -1) notes.push(`hunk ${at + 1} of ${hunks.length}`);
  if (shown.length < hunk.length) notes.push(start === 0 ? `first ${shown.length} of ${hunk.length} lines`
    : `lines ${start + 1}–${start + shown.length} of ${hunk.length}`);
  return folded((kept === -1 ? '' : `<p class="note">${esc(PAGE_SENTENCES.keptLine)}</p>`)
    + `<pre class="diff"><span class="lines">${lines}</span></pre>`
    + (notes.length ? `<p class="cut">${esc(capital(notes.join(', ')))}.</p>` : ''));
}

/**
 * D80: where in a change's edit script the line an after-side quote is on stands, found where the quote itself is,
 * verbatim, in the text the change wrote (its first line, `needle`, as the hunk search reads it): the edit script's
 * kept and added lines, in order, are that text's lines (session-story.js `changeFacts` diffs the after side whole).
 * -1 when the quote is not verbatim in the written text or that line is not one the edit kept: the caller then keeps
 * its first hunk. Verbatim search and the edit script's own marks only.
 */
function keptLine(change, quote, needle) {
  if (needle === null || typeof change.afterText !== 'string') return -1;
  const at = change.afterText.indexOf(quote);
  if (at === -1) return -1;
  const line = change.afterText.slice(0, at + quote.indexOf(needle)).split('\n').length - 1;
  let written = -1;
  const index = change.ops.findIndex(([mark]) => mark !== '-' && ++written === line);
  return index !== -1 && change.ops[index][0] === ' ' && change.ops[index][1].includes(needle) ? index : -1;
}

/** The in-repository changes an event made, in session order (writes outside the repository are never shown). D80:
 *  with the writes of a failed or stopped command (the story's `unconfirmed`), each shown with what its command's end
 *  leaves unrecorded (`unconfirmedChip`). */
const changesOf = (page, ids) => page.facts.whole.changes.concat(page.facts.whole.unconfirmed)
  .filter((change) => !change.outside && ids.includes(change.event.id))
  .sort((a, b) => (page.orderOf.get(a.event.id) - page.orderOf.get(b.event.id)) || (a.index - b.index));
/** D69 f (g): the files a row's cited actions changed, named. D80: a write of a failed or stopped command is named
 *  apart, under "Writes not recorded as done", with what its command's end leaves unrecorded; never among the
 *  changed. */
function changedFilesLine(changes) {
  const done = [...new Set(changes.filter((c) => !c.unconfirmed).map((c) => c.path))];
  return (done.length ? `<p class="note meta"><span class="label">${esc(PAGE_LABELS.changedFiles)}</span> `
    + `${namedPaths(done)}</p>` : '')
    + unconfirmedLines(changes.filter((c) => c.unconfirmed));
}
/** D80 (review of D80 N): the writes of failed or stopped commands a row cites and shows no edit of, under "Writes not
 *  recorded as done": one line for each end of their commands (in the order the first of each was recorded), its
 *  paths named, then its chip, so each path is read with its own command's end. */
function unconfirmedLines(unsure) {
  return [...new Set(unsure.map((c) => c.unconfirmed))].map((end) => `<p class="note meta"><span class="label">`
    + `${esc(PAGE_LABELS.unconfirmedWrites)}</span> `
    + `${namedPaths([...new Set(unsure.filter((c) => c.unconfirmed === end).map((c) => c.path))])}`
    + `${unconfirmedChip({ unconfirmed: end })}</p>`).join('');
}
/** D80: a write of a failed or stopped command, never shown as done: its command's end, in the story's words. */
const unconfirmedChip = (change) => (change.unconfirmed
  ? ` <span class="flagchip">${esc(STORY_SENTENCES.unconfirmedWrite(change.unconfirmed))}</span>` : '');
/** D80 (review of D80 N): the label of a decision's edit — "The edit it was made in:", or, for a write of a failed or
 *  stopped command (which may not have happened), the neutral "The edit it cites:" beside its chip. */
const madeLabel = (change) => (change.unconfirmed ? PAGE_LABELS.editCited : PAGE_LABELS.editMade);
/** Paths as the page names them: clipped, in code, at most `namedEdits`, the rest counted ("and 2 more files"). */
function namedPaths(paths) {
  const named = paths.slice(0, PAGE_LIMITS.namedEdits).map((path) => `<code>${esc(clipPath(oneLine(path), PAGE_LIMITS.pathChars))}</code>`);
  const more = paths.length - named.length;
  return joined([...named, ...(more ? [esc(plural(more, 'more file'))] : [])]);
}
/** The other in-repository edits a row cites, which its one preview leaves out: counted, and their files named. D80
 *  (review of D80 N): a write of a failed or stopped command is never counted among them (it may not have happened):
 *  it is named apart, with its command's end (`unconfirmedLines`). */
function moreEdits(page, rest, made, trim) {
  if (!rest.length || trim >= TRIM.edits) return '';
  const done = rest.filter((change) => !change.unconfirmed);
  return (done.length ? `<p class="cut">${esc(PAGE_SENTENCES.moreEdits(made, done.length))} `
    + `${namedPaths([...new Set(done.map((change) => change.path))])}.</p>` : '')
    + unconfirmedLines(rest.filter((change) => change.unconfirmed));
}

// ---- the review card: the checklist's summary -----------------------------------------------------------------

/**
 * D71 (a), (S4): where your attention is needed — the checklist's summary at the page's front. D88 (owner decision
 * 2026-10-14): it counts only the kinds of review.js ATTENTION_ROWS, in that order — the agent's judgment (its choices
 * not to act, highlighted, D71 d; its decisions made without asking you, where it chose how, where the review could not
 * tell whether you asked; its changes of approach), then the settled problems (your asks shown not done or partly done,
 * by status; claims contradicted by the recording; rows the code at review time contradicts; the failures it passed
 * over, highlighted, D71 c; edits against what you said; statements written into a file and contradicted; the code
 * review's findings) — and what could not be checked of the session; then one plain line says how many rows Sonah could
 * not check (FOLDED_ROWS) are folded, and where. Each a count and a link to the section that lists it; nothing that is
 * done is counted, so no line reads as a grade. Counts the page's own rows by their published tokens (`pageRowCounts`);
 * reads no status of the session.
 */
function attentionBlock(page) {
  const { facts, honest } = page;
  const counts = pageRowCounts(page);
  const asks = facts.asks.flatMap((ask) => ask.requirements).filter((r) => askRowKind(r) === 'asksNotDone');
  const askParts = joined(Object.keys(STORY_REQUIREMENT_WORDS).map((status) => [status, asks.filter((r) => r.status === status).length])
    .filter(([, n]) => n).map(([status, n]) => `${n} ${STORY_REQUIREMENT_WORDS[status]}`));
  const total = facts.steps.length;
  const notReviewed = facts.steps.filter((s) => s.failure).length;
  const short = notReviewed ? PAGE_ATTENTION_WORDS.stepsNotReviewed(notReviewed, total)
    : honest.sessionReview !== 'complete' ? PAGE_ATTENTION_WORDS.reviewIncomplete
      : honest.coverage !== 'complete' ? PAGE_ATTENTION_WORDS.notCovered : null;
  const lines = ATTENTION_ROWS.filter((kind) => counts[kind] > 0)
    .map((kind) => [ATTENTION_PLACES[kind], PAGE_ATTENTION_WORDS[kind](counts[kind], askParts), ATTENTION_HIGHLIGHTS.includes(kind)]);
  if (short) lines.push(['unchecked', short, false]);
  const body = lines.length
    ? `<ul>${lines.map(([id, text, hl]) => `<li${hl ? ' class="hl"' : ''}><a href="#${id}">${esc(text)}</a></li>`).join('')}</ul>`
    : `<p>${esc(PAGE_ATTENTION_WORDS.none)}</p>`;
  const folded = FOLDED_ROWS.reduce((n, kind) => n + counts[kind], 0);
  const foldedLine = folded ? `<p class="folded"><a href="#unchecked">${esc(PAGE_ATTENTION_WORDS.folded(folded))}</a></p>` : '';
  const code = page.codeFindings ? `<p class="note">${esc(PAGE_ATTENTION_WORDS.codeReviewNote(page.codeFindings))}</p>` : '';
  return `<div class="attention"><span class="label">${esc(PAGE_ATTENTION_WORDS.heading)}</span>${body}${foldedLine}${code}</div>`;
}

/**
 * D88: the page's rows counted by kind, with the one counting every reader uses (review.js `rowKindCounts`; the
 * judgment-first review, low: the page kept a counting of its own) over the rows the page lists: every decision (who
 * decided read by the shared rule, `derivedColumn`, as its groups are), every distinct ask of every request, the claims
 * every reader lists (`listedPromises`) and the written statements, its failure rows, its session findings by kind,
 * and the code pass's rows and findings. Read once a page: nothing of it depends on what fits.
 */
function pageRowCounts(page) {
  if (page.rowCountsCache) return page.rowCountsCache;
  const { facts } = page;
  page.rowCountsCache = rowKindCounts({ decisions: facts.decisions.map((x) => x.d), pivots: facts.pivots.length,
    requirements: facts.asks.flatMap((ask) => ask.requirements),
    contradicted: page.findings.filter(({ f }) => f.kind === CLAIM_CONTRADICTED).length,
    codeContradicted: codeContradictedRows(page.report).length, failures: page.failures ?? [],
    forbidden: page.findings.filter(({ f }) => f.kind !== CLAIM_CONTRADICTED).length,
    written: facts.written.map(({ w }) => w), codeFindings: codePassFindings(page.report).length,
    promises: facts.promises.map(({ p }) => p) });
  return page.rowCountsCache;
}

// ---- what you asked for -----------------------------------------------------------------------------------------

/**
 * The gaps of the session by request (D69 f): each per-part reason but a finding (honestStatuses' `parts`, a part being
 * one recorded turn, `T<n>`) under the request whose turn it is — the turn's first ask — in the page's words
 * (`PAGE_GAP_WORDS`); a part no request opens, and the session-wide entry's reasons, apart. Never a part's name.
 */
function gapsByRequest(page) {
  const gaps = PART_REASONS.filter((reason) => !FINDING_PART_REASONS.includes(reason));
  const firstAsk = new Map();
  for (const ask of page.facts.asks) if (typeof ask.event.turn === 'string' && !firstAsk.has(ask.event.turn)) firstAsk.set(ask.event.turn, ask.k);
  const byAsk = new Map(), untied = [];
  for (const part of list(page.honest.parts)) {
    if (!plainObject(part)) continue;
    const reasons = gaps.filter((reason) => list(part.reasons).includes(reason));
    if (!reasons.length) continue;
    const k = typeof part.part === 'string' && firstAsk.has(part.part) ? firstAsk.get(part.part) : null;
    if (k === null) { untied.push(...reasons); continue; }
    byAsk.set(k, [...new Set([...(byAsk.get(k) ?? []), ...reasons])]);
  }
  const wide = plainObject(page.honest.sessionWideLimits) ? list(page.honest.sessionWideLimits.reasons) : [];
  untied.push(...gaps.filter((reason) => wide.includes(reason)));
  return { byAsk, untied: gaps.filter((reason) => untied.includes(reason)) };
}
const gapSentences = (reasons) => reasons.map((reason) => PAGE_GAP_WORDS[reason]).join('; ');

/** /15 (D77 C): the steps any of whose review windows is incomplete (ledger.js `windowRecordComplete`, the predicate
 *  behind review.js's count of incomplete windows), read from the report's window results; a step is one of your
 *  requests, held by one or more windows (story /14). */
function incompleteSteps(page) {
  const records = list(page.honest.windowResults);
  return page.facts.steps.filter((step) => step.windows.some((w) => !windowRecordComplete(records[w])));
}

/** The coverage causes that say your words may be missing (`PAGE_ASK_CAUSES`), and the others. */
function causesOf(page) {
  // /15 (D77 C): review.js counts incomplete review windows, so the page counts the steps any of whose windows is
  // incomplete (`incompleteSteps`) of all steps. Should that recount find none (a report whose counts disagree with its
  // records), the review's counts stay.
  const inSteps = ([cause, counts]) => {
    if (cause !== 'windows_incomplete') return [cause, counts];
    const n = incompleteSteps(page).length;
    return n ? [cause, { ...counts, n, m: page.facts.steps.length }] : [cause, counts];
  };
  const causes = page.honest.coverage === 'complete' ? [] : coverageCauses(page.honest).map(inSteps);
  return { ask: causes.filter(([cause]) => PAGE_ASK_CAUSES.includes(cause)),
    other: causes.filter(([cause]) => !PAGE_ASK_CAUSES.includes(cause)) };
}

/** Recorded text spans, each in its own highlighted quotation marks; the page's own join (` … `, where the recording's
 *  text is not contiguous) is outside them (D69 f (g)). */
const spanQuotes = (spans) => spans.map((span) => `<q class="said">${esc(span)}</q>`).join(' … ');
/** The spans' first `n` characters, as `spanQuotes` shows them, and whether that cut them. Each span's join counts as
 *  the three characters it reads as. */
function spansStart(spans, n) {
  const out = [];
  let room = n;
  for (const span of spans) {
    if (room <= 0) return { spans: out, cut: true };
    const chars = [...span];
    if (chars.length > room) { out.push(chars.slice(0, Math.max(1, room - 1)).join('').trimEnd()); return { spans: out, cut: true }; }
    out.push(span);
    room -= chars.length + 3;
  }
  return { spans: out, cut: false };
}
/** A request's recorded words: whole when short; else its start, then (folded) the whole of it, line breaks kept — or,
 *  once the page trims requests, its start only. Read from the recording itself, span by span; every cut mark and
 *  join is outside the quotation marks. */
function askBody(page, ask, trim, { cls = 'title', lead = '', whole = PAGE_LABELS.wholeAsk } = {}) {
  if (ask.text === STORY_SENTENCES.withheldAsk)
    return `<p class="${cls}">${lead}<span class="more">${esc(ask.text)}</span></p>`;
  const raw = page.session.textSpansOf(ask.event, 'text').map(visible);
  const lines = raw.map(oneLine).filter(Boolean);
  if ([...ask.text].length <= PAGE_LIMITS.askChars) return `<p class="${cls}">${lead}${spanQuotes(lines)}</p>`;
  const start = spansStart(lines, PAGE_LIMITS.askChars);
  const head = `<p class="${cls}">${lead}${spanQuotes(start.spans)}${start.cut ? '…' : ''}</p>`;
  if (trim >= TRIM.asks) return head;
  return `${head}<details class="whole"><summary>${esc(whole)}</summary>`
    + `<p class="ask-whole">${spanQuotes(raw.filter((span) => span.trim()))}</p></details>`;
}
/** Gain I (2026-10-13), in the same unreleased /24: under a request you pasted an image (or other nontext content)
 *  into, one line saying so by count (story `STORY_SENTENCES.pasted`); the image itself is never shown. */
const pastedNote = (ask) => (ask.pasted ? `<p class="note attached">${esc(STORY_SENTENCES.pasted(ask.pasted))}</p>`
  : '');
/** D79: the files you attached to a request (story `ask.attachments`), each under its message as the request's own
 *  words are shown — its recorded text to the request bound, the whole file folded; those attached before any message
 *  of yours (story `unattached`) the same way, before your requests. */
const attachedBodies = (page, attachments, trim) => attachments.map((a) => askBody(page, a, trim,
  { cls: 'note attached', lead: `<span class="label">${esc(PAGE_LABELS.youAttached)}</span> `,
    whole: PAGE_LABELS.wholeAttached })).join('');

/** The rows that cite the same words of yours as this requirement (D69 f (g)): a shown finding's instruction receipt, a
 *  shown decision's instruction or checked instruction, in the same request at a place that overlaps one of the
 *  requirement's own by half the shorter (session-story.js `overlapping`, as its rows are grouped). Structure only. */
function citedIn(page, r) {
  const located = list(r.located);
  if (!located.length) return '';
  const refs = [];
  for (const c of page.plan.citing)
    if (c.eventId === r.ask && located.some((q) => q.span === c.at.span && overlapping(q, c.at)) && !refs.some((x) => x.id === c.ref.id))
      refs.push(c.ref);
  return refs.length ? `<p class="note meta xref"><span class="label">${esc(PAGE_LABELS.citedIn)}</span> ${xrefs(refs)}</p>` : '';
}
/** The claims a list of steps holds, as the page numbers them, in order. */
const claimRefs = (page, steps) => [...new Set(steps.flatMap((step) => [...step.promises, ...step.written])
  .map((entry) => page.plan.claimK.get(entry)).filter(Boolean))].sort((a, b) => a - b).map((n) => ({ id: `claim-${n}`, text: `claim ${n}` }));
/** D69 f (g): folded under a requirement, what the steps the review read it in did — the commands the record says
 *  failed there, the claims made there, the files changed there — so its status can be weighed against them. The
 *  steps are the requirement's own (`steps`, the windows that proposed it); one with none has nothing folded. */
function rowSteps(page, r, trim) {
  if (!Array.isArray(r.steps) || trim >= TRIM.files) return '';
  const steps = page.facts.steps.filter((step) => step.n >= r.steps[0] && step.n <= r.steps[1]);
  if (!steps.length) return '';
  const failing = steps.filter((step) => step.commands.some((c) => c.failed));
  const failed = failing.reduce((n, step) => n + step.commands.filter((c) => c.failed).length, 0);
  // /18 (D79): the commands the recorder typed as refused before they ran, counted apart.
  const refusing = steps.filter((step) => step.commands.some((c) => c.didNotRun));
  const didNotRun = refusing.reduce((n, step) => n + step.commands.filter((c) => c.didNotRun).length, 0);
  // D80: and the ones it typed as stopped before they finished.
  const stopping = steps.filter((step) => step.commands.some((c) => c.stopped));
  const stopped = stopping.reduce((n, step) => n + step.commands.filter((c) => c.stopped).length, 0);
  const claims = claimRefs(page, steps);
  const files = [...new Set(steps.flatMap((step) => step.files.map((file) => file.path)))];
  const parts = [failed ? `${esc(`${plural(failed, 'command')} failed`)} (${stepRunsLinks(page, failing.map((step) => step.n))})`
    : esc('no command failed'),
  ...(didNotRun ? [`${esc(`${plural(didNotRun, 'command')} ${PAGE_LABELS.didNotRun}`)} `
    + `(${stepRunsLinks(page, refusing.map((step) => step.n))})`] : []),
  ...(stopped ? [`${esc(stoppedPhrase(stopped))} (${stepRunsLinks(page, stopping.map((step) => step.n))})`] : []),
  claims.length ? `${esc(claims.length === 1 ? 'claim' : 'claims')} ${xrefs(claims)}` : esc('no claim'),
  files.length ? `${esc(`changed ${plural(files.length, 'file')}:`)} ${namedPaths(files)}` : esc('changed no file in the repository')];
  return `<details class="row-steps"><summary>${esc(PAGE_LABELS.stepsDid)}</summary><p class="note meta">${parts.join(' · ')}</p></details>`;
}
/** Requirement statuses counted, in the words' order ("1 open, 2 addressed"). */
const statusParts = (rows) => joined(Object.keys(STORY_REQUIREMENT_WORDS).map((s) => [s, rows.filter((r) => r.status === s).length])
  .filter(([, n]) => n).map(([s, n]) => `${n} ${STORY_REQUIREMENT_WORDS[s]}`));

/** One requirement row: its status (a checklist row's is code's, checked against the evidence shown under it; a legacy
 *  row's is the review's reading, dashed), your words (or the review's), its steps, its evidence and code check, the rows
 *  that cite the same words, and what its steps did. `request`: the request it belongs to, linked (D88: a row listed
 *  under What Sonah could not check, away from its request). */
function requirementItem(page, r, trim, request = null) {
  // Code's own row for a message no row cites (`codeMade`) has no words of its own: its reason says what it is.
  const status = `<span class="pill${r.checked ? '' : ' reading'}">${esc(STORY_REQUIREMENT_WORDS[r.status])}</span>`;
  const body = r.checked?.codeMade === true ? '' : r.quoted ? said(r.text) : `${esc(PAGE_SENTENCES.reviewWords)} ${words(r.text)}`;
  const of = request === null ? '' : ` <span class="turn">${page.plan.anchored(request)
    ? `<a href="#request-${request}">${esc(`request ${request}`)}</a>` : esc(`request ${request}`)}</span>`;
  const where = Array.isArray(r.steps) ? ` <span class="turn">${stepRunsLinks(page, range(r.steps))}</span>` : '';
  return `<li>${status}${body}${of}${where}${r.checked ? checklistEvidence(page, r.checked) : ''}`
    + `${r.checked ? codeCheckNote(page, r.checked) : ''}${citedIn(page, r)}${rowSteps(page, r, trim)}</li>`;
}
/** D88: the line a section says where it holds rows Sonah could not check, linked to that section. */
const foldedHere = (n, one, many) => (n ? `<p class="note folded"><a href="#unchecked">${esc(FOLDED_SECTION_WORDS.here(n, one,
  many))}</a></p>` : '');

/** One request, whole: its words, its gaps, its requirements chosen by status (every one short of addressed first, then
 *  the addressed ones, at most `rowsPerAsk`, shown in the review's order), each beside the rows that cite it. D88: an ask
 *  Sonah could not check is listed under What Sonah could not check; the request says how many. */
function askItem(page, ask, trim, gaps) {
  const rows = ask.requirements.filter((r) => askRowKind(r) !== 'asksNotChecked');
  const folded = ask.requirements.length - rows.length;
  const chosen = new Set([...rows.filter((r) => !MET_REQUIREMENT_STATUSES.includes(r.status)),
    ...rows.filter((r) => MET_REQUIREMENT_STATUSES.includes(r.status))]
    .slice(0, page.caps.rowsPerAsk));
  const shown = rows.filter((r) => chosen.has(r));
  const cut = rows.filter((r) => !chosen.has(r));
  const items = shown.map((r) => requirementItem(page, r, trim));
  const where = ask.steps.length ? `<span class="turn">${stepRunsLinks(page, ask.steps)}</span>`
    : `<span class="turn">${esc(STORY_SENTENCES.askWithoutStep)}</span>`;
  const gap = gaps.byAsk.get(ask.k);
  return `<li class="finding" id="request-${ask.k}"><span class="n">${two(ask.k)}</span><div>`
    + `<div class="row"><span class="label">${esc(ask.reply ? youWord(ask) : PAGE_LABELS.youAsked)}</span>${where}</div>`
    + askBody(page, ask, trim) + pastedNote(ask) + attachedBodies(page, ask.attachments, trim)
    + (gap ? `<p class="note gap"><span class="label">${esc(PAGE_LABELS.partlyChecked)}</span> ${esc(PAGE_SENTENCES.partlyChecked(gapSentences(gap)))}</p>` : '')
    + (items.length ? `<ul class="rows">${items.join('')}</ul>` : ask.requirements.length ? '' : `<p class="note">${esc(STORY_SENTENCES.noRequirements)}</p>`)
    + (cut.length ? `<p class="cut">${esc(PAGE_SENTENCES.moreInstructions(cut.length, statusParts(cut), shown.length))}</p>` : '')
    + foldedHere(folded, 'ask')
    + '</div></li>';
}
/** A request past the page's bound, in one line: its number, its requirements counted by status (or none named), its
 *  gap, its steps. Its words are not shown. */
function askLine(page, ask, gaps) {
  const pills = ask.requirements.length
    ? Object.keys(STORY_REQUIREMENT_WORDS).map((s) => [s, ask.requirements.filter((r) => r.status === s).length]).filter(([, n]) => n)
      .map(([s, n]) => `<span class="pill reading">${esc(`${n} ${STORY_REQUIREMENT_WORDS[s]}`)}</span>`).join(' ')
    : `<span class="pill reading">${esc(PAGE_LABELS.noInstruction)}</span>`;
  const gap = gaps.byAsk.has(ask.k) ? ` <span class="flagchip">${esc(PAGE_LABELS.partlyChecked)}</span>` : '';
  const where = ask.steps.length ? stepRunsLinks(page, ask.steps) : esc(STORY_SENTENCES.askWithoutStep);
  return `<li id="request-${ask.k}"><span class="mono">${two(ask.k)}</span> ${pills}${gap} <span class="turn">${where}</span></li>`;
}

function requestsPart(page, trim, gaps, causes) {
  const { asks } = page.facts;
  const { plan } = page;
  const head = `<h2 class="label">${esc(PAGE_LABELS.requests)}</h2>`;
  const missing = causes.ask.length ? `<p class="note gap"><span class="label">${esc(PAGE_LABELS.missingWords)}</span> `
    + `${esc(PAGE_SENTENCES.missingWords(causes.ask.map(causeSentence).join('; ')))}</p>` : '';
  // /16 (D79): a file you attached before any message of yours belongs to no request; it is shown first.
  const unattached = attachedBodies(page, page.facts.unattached, trim);
  if (!asks.length) {
    return `<section class="part" id="requests">${head}${missing}${unattached}`
      + `<p class="note">${esc(STORY_SENTENCES.noAsks)}</p></section>`;
  }
  const open = asks.filter((ask) => plan.full.has(ask.k) && plan.attention(ask));
  const addressed = asks.filter((ask) => plan.full.has(ask.k) && !plan.attention(ask));
  const lines = asks.filter((ask) => plan.lines.has(ask.k));
  const rest = asks.length - plan.full.size - lines.length;
  const tracked = asks.some((ask) => ask.requirements.length);
  const checked = asks.some((ask) => ask.requirements.some((r) => r.checked));
  return `<section class="part" id="requests">${head}`
    + (tracked ? `<p class="note">${esc(checked ? PAGE_SENTENCES.statusChecked : PAGE_SENTENCES.statusReading)}</p>` : '')
    + missing + unattached
    + (open.length ? `<ol class="findings">${open.map((ask) => askItem(page, ask, trim, gaps)).join('')}</ol>` : '')
    + (addressed.length ? `<details class="fold"><summary>${esc(PAGE_LABELS.addressedFold(addressed.length))}</summary>`
      + `<ol class="findings">${addressed.map((ask) => askItem(page, ask, trim, gaps)).join('')}</ol></details>` : '')
    + (lines.length ? `<p class="cut">${esc(PAGE_SENTENCES.askLines(lines.length))}</p><ul class="ask-lines">`
      + `${lines.map((ask) => askLine(page, ask, gaps)).join('')}</ul>` : '')
    + `${rest ? `<p class="cut">${esc(notShown(rest, 'request', 'requests', plan.full.size + lines.length))}</p>` : ''}`
    + (page.requirementsRejected ? `<p class="note">${esc(PAGE_SENTENCES.requirementsRejected(page.requirementsRejected))}</p>` : '')
    + '</section>';
}

// ---- D87: the code pass -----------------------------------------------------------------------------------

/** A code receipt's place: its path (clipped) and its line or lines. */
const codeAt = (r) => `${clipPath(oneLine(r.path), PAGE_LIMITS.pathChars)}:${r.startLine === r.endLine ? r.startLine
  : `${r.startLine}–${r.endLine}`}`;
/** One code receipt: where it is, and its quote when the page can check it against the span the report stored with it
 *  (story.js `codeQuoteOf`: the page stays pure), else said so. A session step's quote is checked against the recording
 *  (`sessionQuoteOf`). */
const codeVoice = (page, r) => {
  if (r?.source === 'session') {
    const quote = sessionQuoteOf(page.session, r);
    return `<div class="voice"><span class="label">${esc(PAGE_CODE_WORDS.sessionSaid)}</span>`
      + (quote === null ? `<p class="note">${esc(PAGE_CODE_WORDS.quoteUnchecked)}</p>` : `<blockquote>${said(quote)}</blockquote>`)
      + '</div>';
  }
  const quote = codeQuoteOf(page.report, r);
  return `<div class="voice"><span class="label">${esc(r.side === 'old' ? PAGE_CODE_WORDS.codeBefore
    : PAGE_CODE_WORDS.codeNow)} <code>${esc(codeAt(r))}</code></span>`
    + (quote === null ? `<p class="note">${esc(PAGE_CODE_WORDS.quoteUnchecked)}</p>`
      : `<blockquote>${said(quote, { code: true })}</blockquote>`) + '</div>';
};
/**
 * D87: a checked row's code check beside its status — what the code at review time shows of it, in fixed words (never
 * "verified"), with the code the check cites (its first receipt); or why it is not checked in the code. Nothing for a
 * row the pass did not check, or a check outside the closed vocabularies.
 */
function codeCheckNote(page, row) {
  const check = plainObject(row) ? row.codeCheck : null;
  if (!plainObject(check) || !CODE_CHECK_OUTCOMES.includes(check.outcome)) return '';
  const head = `<span class="label">${esc(PAGE_CODE_WORDS.label)}</span> ${esc(PAGE_CODE_WORDS.outcomes[check.outcome])}`;
  if (check.outcome === CODE_CHECK_OUTCOMES[2])
    return `<p class="note code-check">${head}${Object.hasOwn(PAGE_CODE_WORDS.reasons, check.reason)
      ? `: ${esc(`${PAGE_CODE_WORDS.reasons[check.reason]}.`)}` : '.'}</p>`;
  const [first] = list(check.receipts);
  return `<div class="code-check${check.outcome === CODE_CHECK_OUTCOMES[1] ? ' alert' : ''}"><p class="note">${head}.</p>`
    + (plainObject(first) ? codeVoice(page, first) : '') + '</div>';
}
/** What a row the code pass names is, in the page's words: its kind, and the review's words for it (never a quote). */
function codeRowWords(page, ref) {
  const rows = plainObject(ref) && typeof ref.source === 'string' ? list(page.report?.[ref.source]) : [];
  const row = Number.isSafeInteger(ref?.index) ? rows[ref.index] : null;
  const kind = PAGE_CODE_WORDS.rowKinds[ref?.source] ?? null;
  if (!plainObject(row) || kind === null) return null;
  const text = ref.source === 'decisions' ? row.dimension : ref.source === 'requirements' ? row.text
    : ref.source === 'findings' ? row.title : ref.source === 'pivots' ? row.adopted
      : ref.source === 'failures' ? null : row.text;
  return `${esc(capital(kind))}${typeof text === 'string' && text.trim() ? `: ${esc(PAGE_SENTENCES.reviewWords)} ${words(text)}` : ''}`;
}
/** One upheld code-step finding: its kind and place, its title and explanation (the review's words), the input it names,
 *  the steps of its trace with their quotes (checked), the lenses that reached it, and its id for your answer. */
function codeFindingItem(page, f, n) {
  const anchor = plainObject(f.anchor) && typeof f.anchor.path === 'string' ? f.anchor : null;
  const kind = PAGE_CODE_WORDS.kinds[f.kind] ?? null;
  const lenses = list(f.foundByLenses).filter((l) => Object.hasOwn(PAGE_CODE_WORDS.lenses, l))
    .map((l) => PAGE_CODE_WORDS.lenses[l]);
  const steps = list(f.trace).filter(plainObject);
  return `<li class="finding alert" id="code-finding-${n}"><span class="n">${two(n)}</span><div>`
    + `<div class="row"><span class="label accent">${esc(PAGE_CODE_WORDS.finding)}${kind ? ` · ${esc(kind)}` : ''}</span>`
    + `${anchor ? ` <code>${esc(codeAt(anchor))}</code>` : ''}</div>`
    + `<h4 class="title">${words(f.title)}</h4>`
    + `<p class="note">${esc(PAGE_SENTENCES.reviewWords)} ${words(f.explanation, PAGE_LIMITS.askChars * 4)}</p>`
    + (typeof f.input === 'string' && f.input.trim() ? `<p class="note"><span class="label">${esc(PAGE_CODE_WORDS.input)}</span> `
      + `<code>${words(f.input)}</code></p>` : '')
    + (steps.length ? `<p class="note"><span class="label">${esc(PAGE_CODE_WORDS.trace)}</span></p><ol class="trace">`
      + steps.map((t) => `<li><p class="note">${words(t.step ?? '')}</p>${codeVoice(page, t)}</li>`).join('') + '</ol>'
      : list(f.receipts).slice(0, 2).map((r) => codeVoice(page, r)).join(''))
    + (lenses.length ? `<p class="note"><span class="label">${esc(PAGE_CODE_WORDS.foundBy)}</span> ${esc(lenses.join(', '))}</p>` : '')
    + answerLines(page, f.id, PAGE_LABELS.rowId) + '</div></li>';
}
/**
 * D87, reworked as the code step: what the code review found — present only on a
 * review that ran a code pass. How it worked, where the change starts and which files it showed (counted by closed
 * state); then, in order (story.js `codeSectionPlan`): each row of the session review a finding follows from or the
 * check found contradicted, its code check and its findings beside it; the other findings in table-of-contents order;
 * the open questions for you; and what the code review did not cover (`codeFooterLines`). Never a status, a rank or a
 * severity.
 */
function codePart(page) {
  const pass = page.codePass;
  if (!pass) return '';
  const W = PAGE_CODE_WORDS;
  const commit = typeof pass.base?.commit === 'string' ? pass.base.commit.slice(0, 12) : null;
  const { beside, rest, questions } = codeSectionPlan(page.report);
  let n = 0;
  const cap = page.caps.findings;
  let cut = 0;
  const findingItems = (list_) => list_.map((f) => {
    if (n >= cap) { cut++; return ''; }
    n++;
    return codeFindingItem(page, f, n);
  }).join('');
  const besideItems = beside.map(({ source, index, findings }, i) => {
    const row = list(page.report[source])[index];
    const named = codeRowWords(page, { source, index });
    return `<li class="finding${row?.codeCheck?.outcome === CODE_CHECK_OUTCOMES[1] ? ' alert' : ''}" id="code-row-${i + 1}">`
      + `<span class="n">${two(i + 1)}</span><div>${named ? `<p class="note">${named}</p>` : ''}${codeCheckNote(page, row)}`
      + (findings.length ? `<ol class="findings">${findingItems(findings)}</ol>` : '') + '</div></li>';
  });
  const restItems = rest.length ? `<ol class="findings">${findingItems(rest)}</ol>` : '';
  const questionItems = questions.map((q, i) => {
    const named = q.concerns ? codeRowWords(page, q.concerns) : null;
    const quote = sessionQuoteOf(page.session, q.quote);
    return `<li class="finding" id="code-question-${i + 1}"><span class="n">${two(i + 1)}</span><div>`
      + `<p class="note">${esc(PAGE_SENTENCES.reviewWords)} ${words(q.question, PAGE_LIMITS.askChars * 2)}</p>`
      + (named ? `<p class="note"><span class="label">${esc(W.concerns)}</span> ${named}</p>` : '')
      + (quote ? `<div class="voice"><span class="label">${esc(W.sessionSaid)}</span><blockquote>${said(quote)}</blockquote></div>` : '')
      + '</div></li>';
  });
  const footer = codeFooterLines(page.report);
  const anyFinding = rest.length || beside.some((b) => b.findings.length);
  return `<section class="part" id="code"><h2 class="label">${esc(W.heading)}</h2>`
    + `<p class="note">${esc(W.how)}</p>`
    + (pass.base ? `<p class="note">${esc(W.base(commit))}</p>` : '')
    + codeCoverageLines(pass).map((line) => `<p class="note">${esc(line)}</p>`).join('')
    + rowGroup(W.besideGroup, besideItems, { alert: true })
    + (restItems ? `<div class="group group-alert"><h3 class="label accent">${esc(W.restGroup)}</h3>${restItems}</div>` : '')
    + (anyFinding ? '' : `<p class="note">${esc(W.noFindings)}</p>`)
    + (cut > 0 ? `<p class="cut">${esc(notShown(cut, 'finding', 'findings', n))}</p>` : '')
    + rowGroup(W.questionsGroup, questionItems)
    + `<div class="group"><h3 class="label">${esc(W.footerGroup)}</h3>`
    + (footer.length ? `<ul>${footer.map((line) => `<li class="note">${esc(line)}</li>`).join('')}</ul>`
      : `<p class="note">${esc(W.footerNone)}</p>`) + '</div>'
    + '</section>';
}

// ---- findings ---------------------------------------------------------------------------------------------

/** A finding's receipt label, as the story labels it — except that a statement a helper's child session recorded is
 *  always the helper's ("Helper said"), never the agent's, whatever the row's disclosure. */
function findingLabel(session, f, r) {
  const helper = r.role === 'commentary' && (helperInternal(f) || session.event(r.eventId)?.childId != null);
  // A forbidden edit's shown receipts are what you said and what the agent did (`shownReceipts`); M33 brittleness M4
  // session route: its agent statement is shown only as an upheld disclosure, apart (`disclosedEdit`).
  // W1 B: a project instruction file's words are labelled as the file's (`forbiddenEditLabel`).
  if (forbiddenEdit(f)) return forbiddenEditLabel(f, r);
  // D71 (e), (g): what contradicts a claim is labelled by its source (an edit's other lines are a file's recorded content).
  return helper ? STORY_HELPER_STATEMENT_LABEL : contradictionLabel(f, r) ?? STORY_RECEIPT_LABELS[r.role];
}

/** A finding's quotes as the page shows them: the story's choice (`shownReceipts`) among the receipts the page may show,
 *  each with its shown text; how many grounded receipts it withholds (`pageQuote`) and how many do not ground. */
function findingQuotes(session, f) {
  const receipts = list(f.receipts);
  const withheld = receipts.filter((r) => seen(session, r)?.withheld === true);
  const shown = shownReceipts(session, { ...f, receipts: receipts.filter((r) => !withheld.includes(r)) })
    .map((r) => ({ r, quote: pageQuote(session, r)?.quote })).filter(({ quote }) => typeof quote === 'string');
  return { shown, withheld: withheld.length, missing: receipts.filter((r) => !grounds(session, r)).length };
}

/** The change a finding's first shown code or action receipt cites, with the quote and side that pick its hunk, and
 *  the other in-repository edits its shown code and action receipts cite. */
function findingChange(page, f) {
  const { session } = page;
  const cited = [];
  let first = null;
  for (const r of list(f.receipts)) {
    if (!plainObject(r) || !['code', 'action'].includes(r.role) || !seen(session, r)?.quote) continue;
    const candidates = changesOf(page, [r.eventId]);
    for (const change of candidates) if (!cited.includes(change)) cited.push(change);
    if (first || !candidates.length) continue;
    const quoted = r.role === 'code' ? candidates.find((c) => c.afterText.includes(r.quote) || c.beforeText.includes(r.quote)) : null;
    first = { change: quoted ?? candidates.find(showable) ?? candidates[0], quote: quoted ? r.quote : null,
      side: quoted ? (quoted.afterText.includes(r.quote) ? 'after' : 'before') : null };
  }
  return first && { ...first, rest: cited.filter((change) => change !== first.change) };
}
const showable = (change) => change.ops !== null && hunksOf(change.ops).length > 0;

/** D69 f (g): the request and the decisions a finding concerns, by its receipts' event ids — a request whose own event it
 *  quotes (/16, D79: or a file you attached to it), a shown decision whose statement, value or action it cites.
 *  Structure only. */
function concernsLine(page, f) {
  const ids = new Set(receiptIds(list(f.receipts)));
  const quotes = (ask) => [ask.event, ...ask.attachments.map((a) => a.event)].some((event) => ids.has(event.id));
  const refs = [
    ...page.facts.asks.filter((ask) => quotes(ask) && page.plan.anchored(ask.k))
      .map((ask) => ({ id: `request-${ask.k}`, text: `request ${ask.k}` })),
    ...page.plan.shownDecisions.filter((row) => row.view.agentEvents.some((id) => ids.has(id))).map((row) => ({ id: `decision-${row.k}`, text: `decision ${row.k}` })),
  ];
  return refs.length ? `<p class="note meta xref"><span class="label">${esc(PAGE_LABELS.concerns)}</span> ${xrefs(refs)}</p>` : '';
}

/**
 * One finding, in the checklist section it belongs to (D71 S4): a contradicted claim under what the agent told you,
 * headed by what contradicts it (`PAGE_CONTRADICTION_WORDS`, by the finding's code-set source); an edit against what you
 * said in its own section, with its title. Its recorded facts, its quotes labelled by whose they are, the rows it
 * concerns, the failed commands and the edit it cites, and the command that records your answer to it.
 */
function findingItem(page, { f, step, k }, trim) {
  const { session } = page;
  const { shown: receipts, withheld, missing } = findingQuotes(session, f);
  const notes = [];
  if (helperInternal(f)) notes.push(STORY_SENTENCES.helperInternal);
  // D71 (a): a contradicted claim corrected later in the same turn says so (before D71, only its status chip did).
  if (claimCorrected(f)) notes.push(STORY_SENTENCES.claimCorrected);
  if (forbiddenEdit(f)) notes.push(f.status === FYI && f.disclosureReason === SELF_CORRECTED
    ? STORY_SENTENCES.forbiddenEditReverted : STORY_SENTENCES.forbiddenEdit);
  // M33 brittleness M4 (owner decision 2026-10-06: on both routes): an edit the review published FYI `disclosed` says
  // so, with the agent's upheld statement, as the story does — only when it grounds here, as the page shows it (`seen`).
  const disclosed = disclosedEdit(f);
  const told = disclosed ? seen(session, disclosed)?.quote : undefined;
  if (disclosed) notes.push(STORY_SENTENCES.editDisclosed);
  const quotes = receipts.map(({ r, quote }) => voice(findingLabel(session, f, r), quote, ['code', 'action'].includes(r.role))).join('')
    + (typeof told === 'string' ? voice(STORY_FORBIDDEN_EDIT_LABELS.reported, told, false) : '')
    + quoteNotes({ shown: receipts.length, withheld, missing, none: PAGE_SENTENCES.findingQuotesMissing,
      notFound: PAGE_SENTENCES.findingQuotesMissing });
  const cited = findingChange(page, f);
  const source = contradictionSourceOf(f);
  return `<li class="finding alert" id="finding-${k}"><span class="n">${two(k)}</span><div>`
    + `<div class="row"><span class="label accent">${esc(source !== null ? PAGE_CONTRADICTION_WORDS[source] : PAGE_LABELS.finding)}</span>`
    + `${stepLink(page, stepNumber(step))}</div>`
    + (source !== null ? '' : `<h3 class="title">${words(f.title)}</h3>`)
    + notes.map((text) => `<p class="note">${esc(text)}</p>`).join('')
    + quotes
    + concernsLine(page, f)
    + failedCitedRows(page, receiptIds(list(f.receipts)))
    + (cited ? changePreview(page, cited.change, cited.quote, PAGE_LABELS.editCited, trim, cited.side)
      + moreEdits(page, cited.rest, false, trim) : '')
    + codeCheckNote(page, f)
    + answerLines(page, f.id, PAGE_LABELS.rowId)
    + '</div></li>';
}

// ---- decisions --------------------------------------------------------------------------------------------

/** /24 (owner decision D84): the sentence of an unasked decision whose review also checked the project's
 *  instruction files: your `n` earlier instructions and those files, by their recorded paths (clipped). */
export const checkedWithFiles = (n, paths) => {
  const files = paths.length === 1 ? `the project's instruction file ${paths[0]}`
    : `the project's instruction files ${paths.slice(0, -1).join(', ')} and ${paths.at(-1)}`;
  const parts = [...(n ? [`your ${plural(n, 'earlier instruction')}`] : []), files];
  return `The review checked ${parts.join(' and ')}; ${n + paths.length === 1 ? 'it did not cover this.'
    : 'none of them covered this.'}`;
};

/** The unasked decision's check: how many earlier instructions the review checked, and, folded, the grounded ones.
 *  /24 (owner decision D84): and the project's instruction files it checked beside them (a check of role
 *  project-instructions on such a file: the receipt's role and the cited event's kind, both), named by the paths the
 *  recording carries, each quote folded under "Referred from <path>". A decision with no such check reads as before. */
function checkedInstructions(page, x, trim) {
  const { d, who } = x;
  if (who !== UNASKED || !plainObject(d.instructionReview)) return '';
  const checks = list(d.instructionReview.checks).filter(plainObject);
  if (!checks.length) return '';
  const fileOf = (r) => {
    const source = plainObject(r) && r.role === PROJECT_INSTRUCTIONS_ROLE ? page.session.event(r.eventId) : null;
    return source?.kind === PROJECT_INSTRUCTIONS_ROLE && typeof source.path === 'string' ? source : null;
  };
  const files = checks.filter((c) => fileOf(c.instruction));
  const messages = checks.filter((c) => !fileOf(c.instruction));
  const quoted = messages.map((c) => c.instruction)
    .filter((r) => plainObject(r) && r.role === 'instruction' && page.session.event(r.eventId)?.authority === 'human'
      && grounds(page.session, r));
  const referred = files.map((c) => c.instruction).filter((r) => grounds(page.session, r));
  const items = [...quoted.map((r) => said(r.quote)), ...referred.map((r) =>
    `<span class="label">${esc(PAGE_REFERRED_LABEL(fileOf(r).path))}</span> ${said(r.quote)}`)];
  const n = messages.length;
  // Each file by the name `PAGE_REFERRED_LABEL` gives it (`referredPath`: never a path outside the working tree).
  const named = files.map((c) => clipPath(referredPath(fileOf(c.instruction).path)));
  const sentence = files.length ? checkedWithFiles(n, named)
    : n === 1 ? 'The review checked your 1 earlier instruction; it did not cover this.'
      : `The review checked your ${n} earlier instructions; none of them covered this.`;
  // Past the edits, the checked instructions are only counted (the footer says so).
  if (!items.length || trim >= TRIM.lists) return `<p class="note">${esc(sentence)}</p>`;
  const shown = items.slice(0, PAGE_LIMITS.checks);
  const missing = checks.length - items.length;
  return `<p class="note">${esc(sentence)}</p><details class="checked"><summary>${esc(PAGE_LABELS.checkedSummary)}</summary>`
    + `<ul class="rows">${shown.map((item) => `<li>${item}</li>`).join('')}</ul>`
    + (items.length > shown.length
      ? `<p class="cut">${esc(notShown(items.length - shown.length, 'instruction'))}</p>` : '')
    + (missing ? `<p class="cut">${esc(`${plural(missing, 'of them was', 'of them were')} not found in this recording.`)}</p>` : '')
    + '</details>';
}

/**
 * D69 f: beside a decision the review could not check, what the human needs to judge whether they asked for it — the
 * instructions of the request it was made under (the story's `x.request`: read from the event that places it, its first
 * action a review window holds or, for a choice not to act, its statement — the last request recorded at or before that
 * event, or for a helper's, the request of the hand-off that delivered its work or else launched the helper — never from
 * its step, which may hold several requests, or none before it), as the review named them, grounded here (a requirement's located quote), at most `checks`; the request linked. Structure only: event
 * order and the recorded hand-off links; no instruction is judged relevant.
 */
function stepInstructions(page, x, trim) {
  if (x.who !== UNCHECKED) return '';
  const k = x.request ?? null;
  if (k === null) return `<p class="note">${esc(PAGE_SENTENCES.stepNoRequest)}</p>`;
  const ask = page.facts.asks[k - 1];
  const quoted = list(ask?.requirements).filter((r) => r.quoted);
  const link = page.plan.anchored(k) ? ` <a class="more" href="#request-${k}">${esc(`request ${k}`)}</a>` : '';
  if (!quoted.length) return `<p class="note">${esc(PAGE_SENTENCES.stepNoInstructions(k))}${link}</p>`;
  const head = `<p class="note"><span class="label">${esc(PAGE_LABELS.stepAsk)}</span> ${esc(PAGE_SENTENCES.stepInstructions(k))}${link}</p>`;
  if (trim >= TRIM.lists) return head;
  const shown = quoted.slice(0, PAGE_LIMITS.checks);
  return `${head}<ul class="rows">${shown.map((r) => `<li>${said(r.text)}</li>`).join('')}</ul>`
    + (quoted.length > shown.length ? `<p class="cut">${esc(notShown(quoted.length - shown.length, 'instruction'))}</p>` : '');
}

/** D69 f (g): why the review could not check whether you asked — the decision's column reason (a closed
 *  JUDGMENT_REASONS member the ledger set), in the page's words; nothing for a reason it has no words for. */
const columnReason = (d) => list(d.reasons).find((reason) => Object.hasOwn(PAGE_COLUMN_REASON_WORDS, reason)) ?? null;

/** D69 f (g): your earlier answer to this row, and the id `sonah decision` answers it by (D71 S4: a decision's, a
 *  finding's, a claim's or a written statement's ledger id, or a checklist ask's or failure's computed id, checklist.js),
 *  the same with or without the session hash (/14: the command itself is printed once, `answerNote`). A row with no id
 *  has neither. */
function answerLines(page, id, label = PAGE_LABELS.decisionId) {
  if (typeof id !== 'string' || !DECISION_ID.test(id)) return '';
  const answer = page.answers.get(id);
  const answered = answer ? `<p class="note answer"><span class="label">${esc(PAGE_LABELS.answer)}</span> `
    + `${esc(PAGE_ANSWER_WORDS[answer.verb])} ${esc(PAGE_SENTENCES.answerReason)} ${words(answer.reason, PAGE_LIMITS.askChars)}</p>` : '';
  if (page.sessionHash) page.answerShown = true;
  return `${answered}<p class="note meta"><span class="label">${esc(label)}</span> <code>${esc(shortId(id))}</code></p>`;
}

/** /14: the command that records your answer, printed once when a row shows an id and the session's hash is known
 *  (without it the command cannot be run): with that hash, the parts to replace, and where the report is kept. */
const answerNote = (page) => (page.answerShown
  ? `<p class="note">${esc(PAGE_SENTENCES.answerIntro)}</p>`
    + `<p class="cmd"><code>${esc(PAGE_SENTENCES.answerCommand(page.sessionHash))}</code></p>`
    + `<p class="note">${esc(PAGE_SENTENCES.answerReport)}</p>`
  : '');

/** D71 (d), owner decision 2026-10-08: a choice not to act (a published decision code carried `notActing` on: anchored on
 *  the agent's own words, its proposition judged by the challenge) is highlighted wherever it is shown — its row's mark
 *  and class; never read from wording. */
const notActingClass = (d) => (d.notActing === true ? ' not-acting' : '');
const notActingMark = (d) => (d.notActing === true
  ? `<p class="mark"><span class="flagchip">${esc(PAGE_LABELS.notActing)}</span></p>` : '');

/** A change of approach in the review's words ("Moved from A to B"). */
const movedWords = (p) => PAGE_LABELS.moved(clip(oneLine(p.abandoned), PAGE_LIMITS.briefChars), clip(oneLine(p.adopted), PAGE_LIMITS.briefChars));

function decisionItem(page, row, trim) {
  const { x, view, k } = row;
  const { d, who, step } = x;
  const { voices, missing, withheld, codeQuote, actions, changes } = view;
  const alert = who === UNASKED;
  const quotes = voices.map(([label, quote, code]) => voice(label, quote, code)).join('')
    + quoteNotes({ shown: voices.length, withheld, missing, none: PAGE_SENTENCES.decisionNoQuote,
      notFound: PAGE_SENTENCES.decisionQuotesMissing });
  const reason = who === UNCHECKED ? columnReason(d) : null;
  const pivots = page.plan.attached.get(row) ?? [];
  // D69 f (g): a hunk only where the grounded code it wrote picks it; otherwise the files its cited actions changed.
  const picked = codeQuote !== null ? changes.find((c) => c.afterText.includes(codeQuote)) ?? null : null;
  const edit = picked ? changePreview(page, picked, codeQuote, madeLabel(picked), trim, 'after')
    + moreEdits(page, changes.filter((c) => c !== picked), true, trim)
    : changedFilesLine(changes);
  return `<li class="finding${alert ? ' alert' : ''}${notActingClass(d)}" id="decision-${k}"><span class="n">${two(k)}</span><div>`
    + `<div class="row"><span class="label${alert ? ' accent' : ''}">${esc(PAGE_LABELS.decision)}</span>${stepLink(page, stepNumber(step))}</div>`
    + notActingMark(d)
    + `<h4 class="title">${esc(headingCase(clip(oneLine(d.dimension ?? ''), PAGE_LIMITS.textChars)))}</h4>`
    + `<p class="note"><span class="label">${esc(PAGE_LABELS.chosen)}</span> ${words(d.chosen)}</p>`
    + quotes
    + (reason ? `<p class="note"><span class="label">${esc(PAGE_LABELS.whyUnchecked)}</span> ${esc(`${capital(PAGE_COLUMN_REASON_WORDS[reason])}.`)}</p>` : '')
    + checkedInstructions(page, x, trim)
    + stepInstructions(page, x, trim)
    + pivots.map(({ p }) => `<p class="note"><span class="label">${esc(PAGE_LABELS.pivotHere)}</span> ${esc(PAGE_SENTENCES.reviewWords)} ${esc(movedWords(p))}</p>`
      + pivotQuotes(page, p, voices.map(([, quote]) => quote))).join('')
    + failedCitedRows(page, [...actions, ...receiptIds([d.stated, d.valueReceipt], ...pivots.map(({ p }) => list(p.receipts)))])
    + edit
    + codeCheckNote(page, d)
    + answerLines(page, d.id)
    + '</div></li>';
}

/**
 * D70 (b), owner decision 2026-10-08: a decision where you asked and the agent chose how — the place the agent's own
 * judgment on HOW to do the asked work is shown, in three parts, in this order: your words it served (the column's
 * grounded human instruction, "You asked"); the choice it made, in its own words where the review grounded its
 * statement ("Agent said", "Helper said"), then the review's words ("Chosen"); and what it wrote or ran for it (its
 * grounded value: "Code written" with the hunk that value picks, or the command or path it acted through; else — D70
 * review (S0) — the edits its own cited actions made, each folded with one hunk, at most `namedEdits`, the rest counted
 * and named, so the how can be judged on the page and not only by its file names). Each part the review recorded but
 * this recording does not show is said so, and each part the review did not record. Nothing here is judged from
 * wording: the row is the ledger's derived column, its quotes are the ones `decisionVoices` grounds, and the edits are
 * the ones its cited actions recorded (`changesOf`, by event id).
 */
function howItem(page, row, trim) {
  const { x, view, k } = row;
  const { d, step } = x;
  const { voices, withheld, codeQuote, actions, changes, lost, asked } = view;
  const of = (...labels) => voices.filter(([label]) => labels.includes(label));
  // Your words it served (/23: a project instruction file's keep the label naming the file).
  const yours = voices.filter(([, , , part]) => part === 'asked');
  const own = of(PAGE_VOICE_LABELS.commentary, PAGE_VOICE_LABELS.helper);
  const wrote = of(PAGE_VOICE_LABELS['added-code'], PAGE_VOICE_LABELS.path, PAGE_VOICE_LABELS.command);
  const note = (text) => `<p class="note">${esc(text)}</p>`;
  const pivots = page.plan.attached.get(row) ?? [];
  const picked = codeQuote !== null ? changes.find((c) => c.afterText.includes(codeQuote)) ?? null : null;
  // D70 review (S0): with no hunk a grounded quote picks, the edits its cited actions made, folded, in session order;
  // when edits are trimmed for the page's bound, their files are named as before.
  const folded = changes.slice(0, PAGE_LIMITS.namedEdits);
  const edit = picked ? changePreview(page, picked, codeQuote, madeLabel(picked), trim, 'after')
    + moreEdits(page, changes.filter((c) => c !== picked), true, trim)
    : changes.length && trim < TRIM.edits ? folded.map((c) => changePreview(page, c, null, madeLabel(c), trim)).join('')
      + moreEdits(page, changes.slice(folded.length), true, trim)
      : changedFilesLine(changes);
  const code = wrote.map(([label, quote, isCode]) => voice(label, quote, isCode)).join('')
    + (withheld ? note(PAGE_SENTENCES.quotesWithheld(withheld)) : '')
    + (lost.value ? note(PAGE_SENTENCES.howCodeMissing) : !wrote.length && !withheld && !changes.length
      ? note(PAGE_SENTENCES.howCodeNone) : '');
  return `<li class="finding how${notActingClass(d)}" id="decision-${k}"><span class="n">${two(k)}</span><div>`
    + `<div class="row"><span class="label">${esc(PAGE_LABELS.decision)}</span>${stepLink(page, stepNumber(step))}</div>`
    + notActingMark(d)
    + `<h4 class="title">${esc(headingCase(clip(oneLine(d.dimension ?? ''), PAGE_LIMITS.textChars)))}</h4>`
    + (yours.length ? yours.map(([label, quote]) => voice(label === PAGE_VOICE_LABELS.instruction ? PAGE_LABELS.youAsked
      : label, quote)).join('')
      : note(asked && lost.asked ? PAGE_SENTENCES.howAskedMissing : PAGE_SENTENCES.howAskedNone))
    + (own.length ? own.map(([label, quote]) => voice(label, quote)).join('')
      : note(lost.stated ? PAGE_SENTENCES.howWordsMissing : PAGE_SENTENCES.howWordsNone))
    + `<p class="note"><span class="label">${esc(PAGE_LABELS.chosen)}</span> ${words(d.chosen)}</p>`
    + `<div class="how-code"><span class="label">${esc(PAGE_LABELS.howCode)}</span>${code}${edit}</div>`
    + pivots.map(({ p }) => `<p class="note"><span class="label">${esc(PAGE_LABELS.pivotHere)}</span> ${esc(PAGE_SENTENCES.reviewWords)} ${esc(movedWords(p))}</p>`
      + pivotQuotes(page, p, voices.map(([, quote]) => quote))).join('')
    + failedCitedRows(page, [...actions, ...receiptIds([d.stated, d.valueReceipt], ...pivots.map(({ p }) => list(p.receipts)))])
    + codeCheckNote(page, d)
    + answerLines(page, d.id)
    + '</div></li>';
}

/** A decision you settled, folded with the others (D69 f (g)): its heading, your settling words (or the review's), your
 *  answer and its command. */
function settledItem(page, row) {
  const { x, view, k } = row;
  const { d, step } = x;
  const yours = view.voices.filter(([, , , part]) => part === 'settled');
  return `<li class="finding${notActingClass(d)}" id="decision-${k}"><span class="n">${two(k)}</span><div>`
    + `<div class="row"><span class="label">${esc(PAGE_LABELS.decision)}</span>${stepLink(page, stepNumber(step))}</div>`
    + notActingMark(d)
    + `<h4 class="title">${esc(headingCase(clip(oneLine(d.dimension ?? ''), PAGE_LIMITS.textChars)))}</h4>`
    + (yours.length ? yours.map(([label, quote]) => voice(label, quote)).join('')
      : `<p class="note"><span class="label">${esc(PAGE_LABELS.chosen)}</span> ${words(d.chosen)}</p>`
        + quoteNotes({ shown: 0, withheld: 0, missing: view.missing, none: PAGE_SENTENCES.decisionNoQuote,
          notFound: PAGE_SENTENCES.decisionQuotesMissing }))
    + codeCheckNote(page, d)
    + answerLines(page, d.id)
    + '</div></li>';
}

/** A change of approach's grounded receipts, at most two shown — none whose words the row it sits in already shows —
 *  and one the page withholds (`pageQuote`) counted. */
function pivotQuotes(page, p, shown = []) {
  const { session } = page;
  const receipts = list(p.receipts).filter((r) => plainObject(r) && Object.hasOwn(STORY_RECEIPT_LABELS, r.role))
    .map((r) => ({ r, view: seen(session, r) })).filter(({ view }) => view !== null && !(view.quote !== undefined && shown.includes(view.quote)));
  const withheld = receipts.filter(({ view }) => view.withheld).length;
  return receipts.filter(({ view }) => !view.withheld).slice(0, 2)
    .map(({ r, view }) => voice(r.role === 'commentary' && session.event(r.eventId)?.childId != null ? STORY_HELPER_STATEMENT_LABEL
      : STORY_RECEIPT_LABELS[r.role], view.quote, ['code', 'action'].includes(r.role))).join('')
    + (withheld ? `<p class="note">${esc(PAGE_SENTENCES.quotesWithheld(withheld))}</p>` : '');
}

/** A change of approach no shown decision of the agent's shares an event with, among the decisions. */
function pivotItem(page, { p, step, k }) {
  return `<li class="finding" id="pivot-${k}"><span class="n">${two(k)}</span><div><div class="row"><span class="label">${esc(PAGE_LABELS.pivot)}</span>`
    + `${stepLink(page, stepNumber(step))}</div>`
    + `<p class="title">${esc(movedWords(p))}</p>`
    + `${pivotQuotes(page, p)}${failedCitedRows(page, receiptIds(list(p.receipts)))}</div></li>`;
}

function decidedSentence(page, groups) {
  const { decisions, pivots } = page.facts;
  const also = pivots.length ? ` ${PAGE_SENTENCES.decidedPivots(pivots.length)}` : '';
  if (!decisions.length) return `<p class="decided">${esc(`${PAGE_SENTENCES.noDecisions}${also}`)}</p>`;
  const parts = PAGE_GROUP_ORDER.map((who) => [decisions.filter((x) => x.who === who).length, PAGE_DECIDED_WORDS[who]])
    .filter(([n]) => n > 0).map(([n, text]) => `${n} ${text}`);
  const only = groups.reduce((n, g) => n + g.only.length, 0);
  const notActing = decisions.filter((x) => x.d.notActing === true).length;
  return `<p class="decided">${esc(`The review recorded ${plural(decisions.length, 'decision')}: ${joined(parts)}.`
    + `${only ? ` ${PAGE_SENTENCES.reviewWordsOnly(only)}` : ''}${also}`)}</p>`
    + (notActing ? `<p class="note mark"><span class="flagchip">${esc(PAGE_LABELS.notActing)}</span> `
      + `${esc(PAGE_SENTENCES.notActingLead(notActing))}</p>` : '');
}

function decisionsPart(page, trim) {
  const { groups, pivots, loose } = page.plan;
  const head = `<h2 class="label">${esc(PAGE_LABELS.decisions)}</h2>${decidedSentence(page, groups)}`;
  if (!page.facts.decisions.length && !page.facts.pivots.length) return `<section class="part" id="decisions">${head}</section>`;
  const block = ({ who, voiced, only }) => {
    const total = voiced.length + only.length;
    if (!total) return '';
    const shown = [...voiced, ...only].filter((row) => row.k).length;
    const rest = total - shown;
    const restLine = rest ? `<p class="cut">${esc(notShown(rest, 'decision in this group', 'decisions in this group', shown))}</p>` : '';
    if (who === SETTLED) {
      const items = [...voiced, ...only].filter((row) => row.k).map((row) => settledItem(page, row)).join('');
      // D71 (d): a choice not to act among them is highlighted on the fold's own line too.
      const notActing = [...voiced, ...only].filter((row) => row.x.d.notActing === true).length;
      return `<details class="group fold"><summary><span class="label">${esc(PAGE_LABELS.settledFold(total))}</span>`
        + `${notActing ? ` <span class="flagchip">${esc(`${PAGE_LABELS.notActing} (${notActing})`)}</span>` : ''}</summary>`
        + (items ? `<ol class="findings">${items}</ol>` : '') + restLine + '</details>';
    }
    const item = who === CHOSE ? howItem : decisionItem;
    const voicedItems = voiced.filter((row) => row.k).map((row) => item(page, row, trim)).join('');
    const onlyItems = only.filter((row) => row.k).map((row) => item(page, row, trim)).join('');
    const lead = who === UNASKED ? PAGE_SENTENCES.unaskedLead : who === CHOSE ? PAGE_SENTENCES.howLead : null;
    const body = (lead ? `<p class="note lead">${esc(lead)}</p>` : '')
      + (voicedItems ? `<ol class="findings">${voicedItems}</ol>` : '')
      + (only.length ? `<h4 class="label sub">${esc(`${PAGE_LABELS.reviewWordsOnly} (${only.length})`)}</h4>` : '')
      + (onlyItems ? `<ol class="findings">${onlyItems}</ol>` : '')
      + restLine;
    const heading = esc(`${PAGE_GROUP_WORDS[who]} (${total})`);
    // D70 (b), its review S0: how the agent did what you asked is always open, with its heading — the page highlights
    // the how. The decisions made without asking you stay first and marked (accent bar, accent heading, lead sentence).
    return `<div class="group${who === UNASKED ? ' group-alert' : who === CHOSE ? ' how' : ''}">`
      + `<h3 class="label${who === UNASKED ? ' accent' : ''}">${heading}</h3>${body}</div>`;
  };
  const pivotBlock = loose.length ? `<div class="group"><h3 class="label">${esc(`${PAGE_LABELS.pivots} (${loose.length})`)}</h3>`
    + (pivots.length ? `<ol class="findings">${pivots.map((p) => pivotItem(page, p)).join('')}</ol>` : '')
    + (loose.length > pivots.length ? `<p class="cut">${esc(notShown(loose.length - pivots.length, 'change of approach', 'changes of approach', pivots.length))}</p>` : '')
    + '</div>' : '';
  // D71 (S4): the groups in the checklist's order (PAGE_GROUP_ORDER: your settled ones folded in their place), then the
  // changes of approach no decision holds.
  const body = groups.map(block).join('') + pivotBlock;
  return `<section class="part" id="decisions">${head}${body}</section>`;
}

// ---- what could not be checked ---------------------------------------------------------------------------------

/** The rows a list of steps holds, as the page links them: its shown decisions, claims and requests (D69 f (g)). */
function rowsInSteps(page, steps) {
  const decisions = page.plan.shownDecisions.filter((row) => steps.some((step) => step.decisions.includes(row.x)))
    .map((row) => ({ id: `decision-${row.k}`, text: `decision ${row.k}` }));
  const requests = [...new Set(steps.map((step) => step.request).filter((k) => k !== null && page.plan.anchored(k)))]
    .sort((a, b) => a - b).map((k) => ({ id: `request-${k}`, text: `request ${k}` }));
  return [...decisions, ...claimRefs(page, steps), ...requests];
}
/** Where a cause's losses were recorded (review.js `coverageCauseEvents`): its steps, linked, and the rows they hold.
 *  /22 (owner decision D84 (4) c): the windows the review did not complete are named by the report's window
 *  results — the steps not fully reviewed themselves (`incompleteSteps`), linked, and the rows they hold — never by a
 *  count alone. */
function placed(page, cause) {
  const ids = page.causeEvents.get(cause) ?? [];
  const named = cause === 'windows_incomplete' ? incompleteSteps(page) : [];
  const indexes = named.length ? named.map((step) => step.index)
    : [...new Set(ids.filter((id) => page.stepOfEvent.has(id)).map((id) => page.stepOfEvent.get(id)))]
      .sort((a, b) => a - b);
  if (!indexes.length) return '.';
  const steps = indexes.map((i) => page.facts.steps[i]);
  const rows = rowsInSteps(page, steps);
  return `: ${named.length ? '' : `${esc(PAGE_SENTENCES.inSteps)} `}${stepRunsLinks(page, steps.map((step) => step.n))}`
    + `${rows.length ? `, ${esc(PAGE_SENTENCES.holding(steps.length))} ${xrefs(rows)}` : ''}.`;
}

/**
 * D88 (owner decision 2026-10-14): every row Sonah could not check (review.js FOLDED_ROWS), in that order, each group
 * under its heading with how many rows of its kind the page holds: the asks not checked (each with your words, its
 * request, its evidence and why), the claims not checked against a recorded result and those resting on a check that
 * never completed (the actions it rests on shown), the failures whose handling could not be checked (with why), and the
 * statements written into files and not checked — each listed in full with its id, up to the page's display bounds
 * (the judgment-first review, low: `caps.foldedAsks` asks; `caps.promises` claims and written statements together, the
 * claims first, as What the agent told you shares them; `caps.failures` failures), and the rest of each group counted
 * inside it as not shown. Composed before the failures section, so the failed-command list counts what these rows
 * show. `items` is this composition's `failureItemsOf`. `{ html, count }`: `count` is every such row the page holds,
 * shown or past a bound.
 */
function foldedRows(page, trim, items) {
  const { facts, plan } = page;
  const asks = facts.asks.flatMap((ask) => ask.requirements.filter((r) => askRowKind(r) === 'asksNotChecked')
    .map((r) => ({ ask, r })));
  const shownAsks = asks.slice(0, page.caps.foldedAsks);
  const ofKind = (kind) => plan.promises.filter(({ p }) => claimRowKind(p) === kind);
  const shownOfKind = (kind) => plan.shownPromises.filter(({ p }) => claimRowKind(p) === kind);
  const written = plan.written.filter(({ w }) => writtenRowKind(w) === 'writtenOpen');
  const shownWritten = plan.shownWritten.filter(({ w }) => writtenRowKind(w) === 'writtenOpen');
  const W = FOLDED_SECTION_WORDS.groups;
  const rest = (n, one, many, shown) => (n > 0 ? `<p class="cut">${esc(notShown(n, one, many, shown))}</p>` : '');
  // The judgment-first review (low): every group is headed by how many rows of its kind the page holds, whether or not
  // all of them fit, and what does not fit is said inside its own group (a group none of whose rows fit is still headed,
  // so its cut line never reads as the group above's).
  const group = (kind, total, list, shown, cut) => (total > 0
    ? `<div class="group"><h3 class="label">${esc(`${W[kind]} (${total})`)}</h3>`
      + (shown.length ? `<${list}>${shown.join('')}</${list.split(' ')[0]}>` : '') + cut + '</div>' : '');
  const claimsGroup = (kind) => {
    const shown = shownOfKind(kind);
    return group(kind, ofKind(kind).length, 'ol class="findings"', shown.map((entry) => claimItem(page, entry)),
      rest(ofKind(kind).length - shown.length, 'claim', 'claims', shown.length));
  };
  const html = group('asksNotChecked', asks.length, 'ul class="rows"',
    shownAsks.map(({ ask, r }) => requirementItem(page, r, trim, ask.k)),
    rest(asks.length - shownAsks.length, 'ask', 'asks', shownAsks.length))
    + claimsGroup('claimsOpen') + claimsGroup('claimsIncomplete')
    + group('failuresNotChecked', items.uncheckedCount, 'ol class="findings"', items.unchecked, items.uncheckedCut)
    + group('writtenOpen', written.length, 'ol class="findings"', shownWritten.map((entry) => writtenItem(page, entry)),
      rest(written.length - shownWritten.length, 'statement', 'statements', shownWritten.length));
  const count = asks.length + ofKind('claimsOpen').length + ofKind('claimsIncomplete').length + items.uncheckedCount
    + written.length;
  return { html, count };
}

/**
 * D69 f (g): one section of everything the review could not check, each item in the reader's words and placed by
 * structure (event ids to steps to rows): the steps not reviewed; each coverage cause (your words first), with the steps
 * its losses were recorded in and the decisions, claims and requests those steps hold; the gaps no request opens, and
 * those of requests the page does not list; the decisions it could not check whether you asked for, by their closed
 * reason; the instructions only in the review's words; the encrypted hand-offs. The attention list links here. Every
 * reason stays a member of its closed vocabulary (ledger.js, review.js); only its words are the page's.
 * D88 (owner decision 2026-10-14): it is the page's last section, a native `<details>`, closed — "What Sonah could not
 * check (N)", N the rows Sonah could not check (`foldedRows`) — and after what could not be checked of the session it
 * lists each of those rows in full (`folded.html`), in place of the lines that only pointed at them.
 */
function uncheckedPart(page, gaps, causes, folded) {
  const { facts, honest, plan } = page;
  const items = [];
  const item = (label, html) => items.push(`<li><span class="label">${esc(label)}</span> ${html}</li>`);
  const total = facts.steps.length;
  const notReviewed = facts.steps.filter((s) => s.failure).map((s) => s.n);
  const all = honest.coverage === 'complete' ? [] : coverageCauses(honest);
  // Every step is said to be reviewed only when the review says so of each: no step's window failed, the session review
  // completed, no part's review (nor the session-wide entry's) fell short, and no review window is counted incomplete.
  // A recording's own limits (a coverage cause) do not make a step unreviewed: they are listed after it.
  const reviewShort = [...list(honest.parts), honest.sessionWideLimits].some((entry) => plainObject(entry)
    && list(entry.reasons).some((reason) => PART_REVIEW_REASONS.includes(reason)))
    || all.some(([cause]) => cause === 'windows_incomplete' || cause === 'no_windows');
  const lead = total && !notReviewed.length && honest.sessionReview === 'complete' && !reviewShort
    ? PAGE_SENTENCES.allReviewed(total) : '';
  if (notReviewed.length) item(PAGE_LABELS.stepsNotReviewed, `${esc(PAGE_SENTENCES.stepsNotReviewed(notReviewed.length, total))} `
    + `${stepRunsLinks(page, notReviewed)}. ${esc(PAGE_SENTENCES.stepsNotFinished(notReviewed.length))}`);
  if (honest.sessionReview !== 'complete' && !notReviewed.length) item(PAGE_LABELS.reviewRecord, esc(PAGE_SENTENCES.reviewIncomplete));
  for (const entry of causes.ask) item(PAGE_LABELS.missingWords, `${esc(capital(causeSentence(entry)))}${placed(page, entry[0])}`);
  for (const entry of causes.other) item(PAGE_LABELS.notCovered, `${esc(capital(causeSentence(entry)))}${placed(page, entry[0])}`);
  if (gaps.untied.length) item(PAGE_LABELS.untied, esc(PAGE_SENTENCES.noRequestTied(gapSentences(gaps.untied))));
  // The gaps of requests the page does not list, so none goes unsaid.
  const unlisted = [...new Set([...gaps.byAsk].filter(([k]) => !plan.anchored(k)).flatMap(([, reasons]) => reasons))];
  if (unlisted.length) item(PAGE_LABELS.unlisted, esc(PAGE_SENTENCES.requestsNotShown(gapSentences(PART_REASONS.filter((r) => unlisted.includes(r))))));
  const codex = page.session?.adapter === 'codex' ? 'codex' : 'other';
  if (facts.encryptedBriefs) item(PAGE_LABELS.notCovered, esc(`${capital(STORY_ENCRYPTED_BRIEFS[codex](facts.encryptedBriefs))}.`));
  if (facts.encryptedMessages.n) item(PAGE_LABELS.notCovered, esc(`${capital(STORY_ENCRYPTED_MESSAGES[codex](facts.encryptedMessages.n, facts.encryptedMessages.atLeast))}.`));
  // The decisions it could not check whether you asked for, by their closed reason; the shown ones linked.
  const unchecked = plan.groups.find((g) => g.who === UNCHECKED);
  const rows = unchecked ? [...unchecked.voiced, ...unchecked.only] : [];
  for (const reason of Object.keys(PAGE_COLUMN_REASON_WORDS)) {
    const of = rows.filter((row) => columnReason(row.x.d) === reason);
    if (!of.length) continue;
    const refs = of.filter((row) => row.k).map((row) => ({ id: `decision-${row.k}`, text: `decision ${row.k}` }));
    const hidden = of.length - refs.length;
    item(PAGE_LABELS.whetherAsked, `${esc(PAGE_SENTENCES.whetherAsked(PAGE_COLUMN_REASON_WORDS[reason]))} `
      + `${refs.length ? xrefs(refs) : ''}${hidden ? esc(`${refs.length ? ', and ' : ''}${notShown(hidden, 'decision', 'decisions', refs.length)}`) : '.'}`);
  }
  // The instructions it named only in its own words, by request.
  // (Code's own row for a message no row cites has no quote by construction: its reason is said where it is listed.)
  const reviewOnly = facts.asks.flatMap((ask) => ask.requirements.filter((r) => !r.quoted && r.checked?.codeMade !== true)
    .map(() => ask.k));
  if (reviewOnly.length) {
    const ks = [...new Set(reviewOnly)];
    const refs = ks.filter((k) => plan.anchored(k)).map((k) => ({ id: `request-${k}`, text: `request ${k}` }));
    const hidden = ks.length - refs.length;
    item(PAGE_LABELS.reviewWords, `${esc(PAGE_SENTENCES.reviewWordsRows(reviewOnly.length))} ${refs.length ? xrefs(refs) : ''}`
      + `${hidden ? esc(`${refs.length ? ', and ' : ''}${notShown(hidden, 'request', 'requests', refs.length)}`) : '.'}`);
  }
  // D88: the asks kept as not checked, the failures listed without a checked answer, and the claims and written
  // statements not checked are listed below, each in full (`foldedRows`), no longer pointed at from here.
  const anyGap = gaps.untied.length || gaps.byAsk.size || causes.ask.length;
  // A coverage short of complete that nothing above explains (D71 (a): by the coverage, never by a status).
  if (honest.coverage !== 'complete' && !notReviewed.length && !all.length && !anyGap && honest.sessionReview === 'complete')
    item(PAGE_LABELS.reviewRecord, esc(PAGE_SENTENCES.recordSilent));
  const quiet = !items.length && !all.length ? `<p class="note">${esc(PAGE_SENTENCES.nothingMissing)}</p>` : '';
  // D88: a native disclosure element, closed: the page runs no script.
  return `<section class="part" id="unchecked"><details class="unchecked"><summary>`
    + `<h2 class="label">${esc(FOLDED_SECTION_WORDS.summary(folded.count))}</h2></summary>`
    + (lead ? `<p class="note">${esc(lead)}</p>` : '') + quiet
    + (items.length ? `<ul class="checks">${items.join('')}</ul>` : '')
    + (folded.count ? `<p class="note lead">${esc(FOLDED_SECTION_WORDS.lead)}</p>${folded.html}` : '')
    + '</details></section>';
}

// ---- claims and failed commands -------------------------------------------------------------------------------

/** M1: a failed command as the page shows it (story.js `failedCommandText`, at the page's command bound): its recorded
 *  words with a leading `cd <dir>` dropped, or null when it names a path outside the working tree. */
export const commandText = (raw) => failedCommandText(raw, PAGE_LIMITS.commandChars);

// ---- D71 (S4): the evidence a checklist row shows ------------------------------------------------------------

/** A recorded action as a checklist row names it: the command it ran (`commandText`: its words, or the fixed sentence
 *  when they name a path outside the working tree), else the tool it called, as recorded; a helper's marked. Null when
 *  the recording holds no such event. */
function actionWords(page, id) {
  const event = typeof id === 'string' ? page.session.event(id) : null;
  if (!event) return null;
  const helper = event.childId != null ? ` <span class="pill">${esc(PAGE_LABELS.helper)}</span>` : '';
  if (event.operation === 'command') {
    const text = commandText(page.session.textSpansOf(event, 'command').join(' '));
    return `<span class="label">${esc(PAGE_LABELS.ran)}</span> ${text === null
      ? `<span class="note">${esc(PAGE_SENTENCES.commandWithheld)}</span>` : `<code>${esc(text)}</code>`}${helper}`;
  }
  const tool = typeof event.tool === 'string' && event.tool ? event.tool : typeof event.operation === 'string' ? event.operation : '';
  return `<span class="label">${esc(PAGE_LABELS.tool)}</span> <code>${words(tool, PAGE_LIMITS.commandChars)}</code>${helper}`;
}
/** A typed outcome (ledger.js `resultOutcome` / `actionOutcome`: its class and form, recorder fields only) in the page's
 *  words, or null for a class the failures section never lists. */
const outcomeWords = (outcome, exit = null) => (Object.hasOwn(PAGE_OUTCOME_WORDS, outcome?.class)
  ? PAGE_OUTCOME_WORDS[outcome.class](exit, outcome.form ?? null) : null);

/**
 * A checklist row's cited evidence (an ask's deliverable or shortfall, a failure's response), labelled by whose it is
 * and shown as `pageQuote` shows any receipt, grounded again in this render: code written only from a change's after
 * side (an edit's other lines are a file's recorded content); an action as its command or path; a quote the page never
 * shows counted; one that does not ground here said so. `label` names it instead (the end of a turn).
 */
function evidenceVoice(page, r, label = null) {
  const { session } = page;
  const note = (text) => `<p class="note">${esc(text)}</p>`;
  if (!grounds(session, r)) return note(PAGE_SENTENCES.evidenceMissing);
  if (r.role === 'code') {
    const after = pageQuote(session, r, 'after');
    if (typeof after?.quote === 'string') return voice(label ?? PAGE_VOICE_LABELS['added-code'], after.quote, true);
    const any = pageQuote(session, r);
    return typeof any?.quote === 'string' ? voice(label ?? STORY_CONTRADICTION_LABELS.file_content, any.quote, true)
      : note(PAGE_SENTENCES.quotesWithheld(1));
  }
  const view = pageQuote(session, r);
  if (view === null) return note(PAGE_SENTENCES.evidenceMissing);
  if (view.withheld) return note(PAGE_SENTENCES.quotesWithheld(1));
  const helper = r.role === 'commentary' && session.event(r.eventId)?.childId != null;
  return voice(label ?? (helper ? STORY_HELPER_STATEMENT_LABEL : STORY_RECEIPT_LABELS[r.role] ?? PAGE_LABELS.claim),
    view.quote, ['code', 'action'].includes(r.role));
}
const evidenceBlock = (label, body) => `<div class="evidence"><span class="label">${esc(label)}</span>${body}</div>`;

/** The actions a row rests on (`restsOn`, code-checked: its own actions whose check never completed), each with what the
 *  window that showed it recorded of its result (D59) and its step, at most `restsOn`, the rest counted. */
function restsOnLines(page, ids) {
  const actions = [...new Set(list(ids).filter((id) => typeof id === 'string' && page.session.event(id)))];
  if (!actions.length) return '';
  const shown = actions.slice(0, PAGE_LIMITS.restsOn);
  const items = shown.map((id) => {
    const said = outcomeWords(actionOutcome(page.session, page.session.event(id), { until: page.windowEndOf.get(id) ?? null }));
    const step = page.stepOfEvent.has(id) ? page.stepOfEvent.get(id) + 1 : null;
    return `<li>${actionWords(page, id)}${said ? ` <span class="note">${esc(said)}</span>` : ''}${step ? ` ${stepLink(page, step)}` : ''}</li>`;
  });
  return evidenceBlock(PAGE_LABELS.restsOn, `<ul class="rows">${items.join('')}</ul>`
    + (actions.length > shown.length ? `<p class="cut">${esc(capital(PAGE_SENTENCES.moreRestsOn(actions.length - shown.length)))}</p>` : ''));
}

/** D71 (S4): under one checklist ask, what code published it with — what settles it (its deliverable), what is missing
 *  (its shortfall), the checks it rests on that never completed, why it is not checked (its closed reason) and the
 *  fact beside it — each grounded again here; then the id `sonah decision` answers it by (/14: the command itself is
 *  printed once, `answerNote`). */
function checklistEvidence(page, row) {
  return (plainObject(row.deliverable) ? evidenceBlock(PAGE_LABELS.settles, evidenceVoice(page, row.deliverable)) : '')
    + (plainObject(row.shortfall) ? evidenceBlock(PAGE_LABELS.missing, evidenceVoice(page, row.shortfall)) : '')
    + restsOnLines(page, row.restsOn)
    + (Object.hasOwn(PAGE_REQUIREMENT_REASON_WORDS, row.reason) ? `<p class="note"><span class="label">${esc(PAGE_LABELS.whyNotChecked)}</span> `
      + `${esc(`${capital(PAGE_REQUIREMENT_REASON_WORDS[row.reason])}.`)}</p>` : '')
    + list(row.facts).filter((fact) => Object.hasOwn(PAGE_REQUIREMENT_FACT_WORDS, fact))
      .map((fact) => `<p class="note">${esc(PAGE_REQUIREMENT_FACT_WORDS[fact])}</p>`).join('')
    + answerLines(page, requirementRowId(row), PAGE_LABELS.rowId);
}

// ---- what the agent told you ----------------------------------------------------------------------------------

/** A claim's status as the page groups it: confirmed, resting on a check that never completed, or not checked. */
const claimStatus = (p) => promiseWords(p.status);

/** One claim the agent made (a published promise): its words (or the review's), the result's words that confirm it, the
 *  checks it rests on that never completed (D71 S2), why it is not checked when its own challenge did not settle (S6,
 *  S5 review H1), the failed commands it cites, and the id that answers it. The review's unchallenged mark that it
 *  is an assumption (D71 f) is not shown (S6, S5 review M3). */
function claimItem(page, entry) {
  const { session, plan } = page;
  const { p, step } = entry;
  const k = plan.claimK.get(entry);
  const quoted = plainObject(p.stated) && p.stated.role === 'commentary' && grounds(session, p.stated);
  const label = quoted ? (session.event(p.stated.eventId)?.childId != null ? PAGE_VOICE_LABELS.helper : PAGE_VOICE_LABELS.commentary) : PAGE_LABELS.claim;
  const body = quoted ? `<blockquote>${said(p.stated.quote)}</blockquote>`
    : `<p class="note">${esc(PAGE_SENTENCES.reviewWords)} ${words(p.text)}</p>`;
  const incomplete = claimStatus(p) === STORY_PROMISE_WORDS.incomplete;
  return `<li class="finding" id="claim-${k}"><span class="n">${two(k)}</span><div><div class="row"><span class="label">${esc(label)}</span>`
    + `${stepLink(page, stepNumber(step))}</div>${body}${confirmingVoice(session, p)}`
    + `<div class="chips"><span class="${incomplete ? 'flagchip' : 'pill'}">${esc(claimStatus(p))}</span>`
    + '</div>'
    + (incomplete ? restsOnLines(page, p.restsOn) : '')
    + (Object.hasOwn(CHECKLIST_CLAIM_REASON_WORDS, p.reason) ? `<p class="note"><span class="label">${esc(PAGE_LABELS.whyNotChecked)}</span> `
      + `${esc(`${capital(CHECKLIST_CLAIM_REASON_WORDS[p.reason])}.`)}</p>` : '')
    + `${failedCitedRows(page, receiptIds([p.stated], list(p.receipts)))}${codeCheckNote(page, p)}`
    + `${answerLines(page, p.id, PAGE_LABELS.rowId)}</div></li>`;
}

/** One statement the agent wrote into a file, with its side label; its code shown only from the after side of a write
 *  inside the repository (`pageQuote`), else in the review's words. */
function writtenItem(page, entry) {
  const { session, plan } = page;
  const { w, step } = entry;
  const k = plan.claimK.get(entry);
  const quoted = plainObject(w.stated) && w.stated.role === 'code' && Boolean(seen(session, w.stated, 'after')?.quote);
  const body = quoted ? `<blockquote>${said(w.stated.quote, { code: true })}</blockquote>`
    : `<p class="note">${esc(PAGE_SENTENCES.reviewWords)} ${words(w.text)}</p>`;
  const alert = w.label === 'contradicted';
  const helper = plainObject(w.stated) && session.event(w.stated.eventId)?.childId != null;
  return `<li class="finding${alert ? ' alert' : ''}" id="claim-${k}"><span class="n">${two(k)}</span><div><div class="row">`
    + `<span class="label${alert ? ' accent' : ''}">${esc(writtenWords(w))}</span>${stepLink(page, stepNumber(step))}</div>`
    + `${body}${helper ? `<div class="chips"><span class="pill">${esc(PAGE_LABELS.helper)}</span></div>` : ''}`
    + `${failedCitedRows(page, receiptIds([w.stated, w.contradictedBy]))}${codeCheckNote(page, w)}`
    + `${answerLines(page, w.id, PAGE_LABELS.rowId)}</div></li>`;
}

/** A group of rows under its heading (`alert`: marked as the place to look first), or a fold for one to check against. */
const rowGroup = (heading, items, { alert = false, fold = null, id = null } = {}) => (!items.length ? ''
  : fold !== null ? `<details class="group fold"${id ? ` id="${id}"` : ''}><summary><span class="label">${esc(fold)}</span></summary>`
    + `<ol class="findings">${items.join('')}</ol></details>`
    : `<div class="group${alert ? ' group-alert' : ''}"${id ? ` id="${id}"` : ''}><h3 class="label${alert ? ' accent' : ''}">`
      + `${esc(`${heading} (${items.length})`)}</h3><ol class="findings">${items.join('')}</ol></div>`);

/**
 * D71 (S4): what the agent told you — its claims by status, in this order: contradicted (each a finding, headed by what
 * contradicts it: a recorded result, your own message, a file's recorded content or the project's instruction file —
 * code's source, never the model's); and, folded, confirmed by a recorded result. D88: the claims not checked, and those
 * resting on a check that never completed (the actions it rests on shown), are listed under What Sonah could not check
 * (`foldedRows`); this section says how many. The statements it wrote into files are with the edits.
 */
function claimsPart(page, trim) {
  const { plan } = page;
  const contradicted = plan.findings.filter(({ f }) => f.kind === CLAIM_CONTRADICTED);
  const confirmedAll = plan.promises.filter(({ p }) => claimRowKind(p) === null);
  const hidden = page.findings.filter(({ f }) => f.kind === CLAIM_CONTRADICTED).length - contradicted.length
    + confirmedAll.length - plan.shownPromises.filter(({ p }) => claimRowKind(p) === null).length;
  const folded = plan.promises.length - confirmedAll.length;
  const groups = rowGroup(PAGE_LABELS.contradictedGroup, contradicted.map((x) => findingItem(page, x, trim)), { alert: true });
  const confirmed = plan.shownPromises.filter(({ p }) => claimRowKind(p) === null).map((entry) => claimItem(page, entry));
  const any = contradicted.length + plan.shownPromises.length + hidden + folded > 0;
  return `<section class="part" id="claims"><h2 class="label">${esc(PAGE_LABELS.claims)}</h2>`
    + (any ? '' : `<p class="note">${esc(PAGE_SENTENCES.noClaims)}</p>`)
    + groups + rowGroup('', confirmed, { fold: PAGE_LABELS.confirmedFold(confirmed.length) })
    + foldedHere(folded, 'claim')
    + closingLinesPart(page)
    + (hidden ? `<p class="cut">${esc(notShown(hidden, 'claim', 'claims', contradicted.length + confirmed.length))}</p>` : '')
    + (page.claimsRejected ? `<p class="note">${esc(PAGE_SENTENCES.claimsRejected(page.claimsRejected))}</p>` : '')
    + '</section>';
}

/**
 * S6 (S5 review M4, "on the page"): the lines of the agent's closing messages that no claim covers,
 * and, apart, those the review read as asserting nothing (its `notClaims`), each folded, every line as recorded (its
 * recorded spans, the way the window showed it), by the window records' positions (`closingLines`) — so a claim the
 * review passed over, or hid among lines it read as asserting nothing, stays in front of you. At most `closingLines` in
 * all; the rest counted.
 */
function closingLinesPart(page) {
  const { session } = page;
  const seenAt = new Set(), groups = { unreviewed: [], listed: [] };
  for (const window of list(page.honest.windowResults)) {
    for (const entry of list(plainObject(window) ? window.closingLines : null)) {
      const event = plainObject(entry) && typeof entry.eventId === 'string' ? session.event(entry.eventId) : null;
      if (event?.kind !== 'commentary') continue;
      let lines = [];
      try { lines = messageLines(session, event); } catch { lines = []; }
      const byK = new Map(lines.map((line) => [line.k, line]));
      for (const field of ['unreviewed', 'listed']) for (const k of list(entry[field])) {
        const line = byK.get(k);
        if (!line || !line.spans.length || seenAt.has(`${event.id}:${k}`)) continue;
        seenAt.add(`${event.id}:${k}`);
        groups[field].push({ k, spans: line.spans });
      }
    }
  }
  const cap = page.caps.closingLines;
  let room = cap;
  const fold = (rows, words) => {
    if (!rows.length) return '';
    const shown = rows.slice(0, Math.max(0, room));
    room -= shown.length;
    const items = shown.map(({ k, spans }) => `<li><span class="label">${esc(PAGE_LABELS.line(k))}</span> `
      + `${spans.map((span) => said(span)).join(' … ')}</li>`);
    return `<details class="group fold"><summary><span class="label">${esc(words(rows.length))}</span></summary>`
      + `<ul class="rows">${items.join('')}</ul>`
      + (rows.length > shown.length ? `<p class="cut">${esc(notShown(rows.length - shown.length, 'line', 'lines', shown.length))}</p>` : '')
      + '</details>';
  };
  return fold(groups.unreviewed, PAGE_LABELS.closingUnreviewedFold) + fold(groups.listed, PAGE_LABELS.closingListedFold);
}

/** D71 (S4): edits against what you said (every session finding but a contradicted claim) and the statements it wrote
 *  into files, each with its side label. D88: the statements contradicted; those not checked are listed under What Sonah
 *  could not check (`foldedRows`), and this section says how many. */
function editsPart(page, trim) {
  const { plan } = page;
  const forbidden = plan.findings.filter(({ f }) => f.kind !== CLAIM_CONTRADICTED);
  const contradicted = (rows) => rows.filter(({ w }) => writtenRowKind(w) === 'writtenContradicted');
  const shownWritten = contradicted(plan.shownWritten);
  const hidden = page.findings.filter(({ f }) => f.kind !== CLAIM_CONTRADICTED).length - forbidden.length
    + contradicted(plan.written).length - shownWritten.length;
  const folded = plan.written.filter(({ w }) => writtenRowKind(w) === 'writtenOpen').length;
  const body = rowGroup(PAGE_LABELS.forbiddenGroup, forbidden.map((x) => findingItem(page, x, trim)), { alert: true })
    + rowGroup(PAGE_LABELS.writtenGroup, shownWritten.map((entry) => writtenItem(page, entry)));
  return `<section class="part" id="edits"><h2 class="label">${esc(PAGE_LABELS.edits)}</h2>`
    + (body || hidden || folded ? body : `<p class="note">${esc(PAGE_SENTENCES.noEdits)}</p>`)
    + foldedHere(folded, 'statement')
    + (hidden ? `<p class="cut">${esc(notShown(hidden, 'row', 'rows', forbidden.length + shownWritten.length))}</p>` : '')
    + '</section>';
}

/** D80: the failed-command part's heading — naming the stopped commands only when it holds one. */
const failedHeading = (page) => (page.stopped.length ? PAGE_LABELS.failedStopped : PAGE_LABELS.failed);
/**
 * M1, D69 f: the commands the record says failed (its result, or a nonzero exit), whatever command they were — each one
 * a shown finding, decision, claim or change of approach cites is shown beside that row (`failedCitedRows`); the rest
 * are counted, with the steps they ran in, and (D69 f (g)) listed, folded, by their recorded words — the session's last
 * command first when it failed, by its place in the recording. Composed after every row, so it counts what the rows
 * showed.
 */
function failedPart(page, heading = true) {
  // /18 (D79): `flagged` is the failed commands and, apart, the ones the recorder typed as refused before they ran.
  const { flagged, failed, didNotRun, stopped } = page;
  const total = page.facts.whole.commands.length;
  const head = heading ? `<h3 class="label sub-h">${esc(failedHeading(page))}</h3>` : '';
  if (!flagged.length) return `${head}<p class="note">${esc(PAGE_SENTENCES.noFailed)}</p>`;
  const rest = flagged.filter((c) => !page.citedShown.has(c.event.id));
  const steps = [...new Set(rest.map((c) => page.stepOfEvent.get(c.event.id)).filter((s) => s !== undefined).map((s) => s + 1))]
    .sort((a, b) => a - b);
  const unplaced = rest.length - rest.filter((c) => page.stepOfEvent.has(c.event.id)).length;
  const sentence = esc(PAGE_SENTENCES.failedFolded(failed.length, didNotRun.length, total, flagged.length - rest.length,
    rest.length, stopped.length));
  const where = [steps.length ? `in ${stepRunsLinks(page, steps)}` : '', unplaced ? esc(`${plural(unplaced, 'of them', 'of them')} in no step`) : '']
    .filter(Boolean).join(', ');
  const last = page.lastFailed;
  const lastLine = last ? ` ${esc(PAGE_SENTENCES.lastFailed(page.citedShown.has(last.event.id)))}` : '';
  const listed = last && rest.includes(last) ? [last, ...rest.filter((c) => c !== last)] : rest;
  const shown = listed.slice(0, page.caps.failedList);
  // /18 (D79): the fold's words name failed commands only while every command in it failed.
  const onlyFailed = rest.every((c) => c.failed);
  const summary = (onlyFailed ? PAGE_LABELS.failedList : PAGE_LABELS.flaggedList)(rest.length);
  const cut = onlyFailed ? notShown(listed.length - shown.length, 'failed command', 'failed commands', shown.length)
    : notShown(listed.length - shown.length, 'command', 'commands', shown.length);
  const folded = rest.length ? `<details class="failed"><summary>${esc(summary)}</summary>`
    + (shown.length ? `<ul class="rows">${shown.map((c) => `<li>${failedLine(page, c)}`
      + `${c === last ? ` <span class="pill">${esc(PAGE_LABELS.lastCommand)}</span>` : ''}</li>`).join('')}</ul>` : '')
    + (listed.length > shown.length ? `<p class="cut">${esc(cut)}</p>` : '')
    + '</details>' : '';
  return `${head}<p class="note">${sentence}${where ? `, ${where}` : ''}.${lastLine}</p>${folded}`;
}

// ---- D71 (S4, owner decision c): the failures it passed over --------------------------------------------------------

/** A failure row's RESULT outcome, read again from the recording (ledger.js `resultOutcome`: class and form, recorder
 *  fields only); the row's own when the recording does not hold its RESULT. */
function failureOutcome(page, row) {
  const result = page.session.event(row.eventId);
  return result ? { ...resultOutcome(page.session, result), exit: result.exitCode ?? null }
    : { class: row.outcome, form: row.form ?? null, exit: null };
}
/** The tool a failure row's action called, as recorded (the row's own when the recording does not hold the action). */
const toolOf = (page, row) => {
  const tool = page.session.event(row.action)?.tool ?? row.tool;
  return typeof tool === 'string' && tool ? tool : null;
};

/** One failure row: what the agent did about it (code-checked, the challenge's), the action it was and what came back,
 *  the agent's words or action it cites (the end of its turn, for one passed over), why it is not checked, and the id
 *  that answers it. A failed command it is is counted as shown, so the failed-command list folds it. */
function failureItem(page, row, k) {
  const outcome = failureOutcome(page, row);
  const said = outcomeWords(outcome, outcome.exit);
  const alert = row.handling === PASSED_OVER;
  const handling = Object.hasOwn(PAGE_FAILURE_WORDS, row.handling) ? row.handling : FAILURE_NOT_CHECKED;
  const step = page.stepOfEvent.get(row.eventId) ?? page.stepOfEvent.get(row.action) ?? null;
  if (typeof row.action === 'string' && page.failedById.has(row.action)) page.citedShown.add(row.action);
  const action = actionWords(page, row.action);
  return `<li class="finding${alert ? ' alert' : ''}" id="failure-${k}"><span class="n">${two(k)}</span><div>`
    + `<div class="row"><span class="label${alert ? ' accent' : ''}">${esc(PAGE_FAILURE_WORDS[handling])}</span>`
    + `${stepLink(page, stepNumber(step))}</div>`
    + (action ? `<p class="note">${action}</p>` : '')
    + (said ? `<p class="note">${esc(said)}</p>` : '')
    + (plainObject(row.response) && handling !== FAILURE_NOT_CHECKED
      ? evidenceVoice(page, row.response, handling === PASSED_OVER ? PAGE_LABELS.turnEnded : null) : '')
    + (handling === FAILURE_NOT_CHECKED && Object.hasOwn(PAGE_FAILURE_REASON_WORDS, row.reason)
      ? `<p class="note"><span class="label">${esc(PAGE_LABELS.whyNotChecked)}</span> ${esc(`${capital(PAGE_FAILURE_REASON_WORDS[row.reason])}.`)}</p>` : '')
    + codeCheckNote(page, row)
    + answerLines(page, failureRowId(row), PAGE_LABELS.rowId)
    + '</div></li>';
}

/** The failure rows by where the page shows them: passed over (`failuresPart`); not checked (D88: under What Sonah could
 *  not check); acted on or told you about (`failuresPart`, folded) — by the shared rule (review.js `failureRowKind`).
 *  Read once a page. */
function failureGroups(page) {
  if (page.failureGroupsCache) return page.failureGroupsCache;
  const passed = [], unchecked = [], handled = [];
  for (const row of page.failures ?? []) {
    const kind = failureRowKind(row);
    (kind === 'passedOver' ? passed : kind === null ? handled : unchecked).push(row);
  }
  page.failureGroupsCache = { passed, unchecked, handled };
  return page.failureGroupsCache;
}
/** One composition's failure rows as shown: each group's items, at most `failures`, numbered across the groups in one
 *  order (passed over, not checked, acted on or told you), and each group's cut line. */
function failureItemsOf(page) {
  const { passed, unchecked, handled } = failureGroups(page);
  let k = 0;
  const items = (group) => group.slice(0, page.caps.failures).map((row) => failureItem(page, row, ++k));
  const cut = (group) => (group.length > page.caps.failures
    ? `<p class="cut">${esc(notShown(group.length - page.caps.failures, 'failure', 'failures', page.caps.failures))}</p>` : '');
  return { passed: items(passed), passedCut: cut(passed), unchecked: items(unchecked), uncheckedCut: cut(unchecked),
    handled: items(handled), handledCut: cut(handled), uncheckedCount: unchecked.length, handledCount: handled.length };
}

/**
 * D71 (S4, owner decision c): every RESULT code listed as failed, not run or with no end, with what the agent did about
 * it — the ones it passed over first and highlighted; folded, the ones it acted on or told you about (S7: a RESULT
 * recorded with none of its output shown is no failure row, so no fold of calls "nothing came back from" remains). D88:
 * the ones not checked are listed under What Sonah could not check, and this section says how many. Then the failed
 * commands no row on the page cites (composed after every row: `items` is this composition's `failureItemsOf`).
 * A report from before the checklist has no failure rows: its failed commands are listed as before.
 */
function failuresPart(page, trim, items) {
  const rows = page.failures;
  if (rows === null) return `<section class="part" id="failures"><h2 class="label">${esc(failedHeading(page))}</h2>`
    + `${failedPart(page, false)}</section>`;
  const notReviewed = page.facts.steps.some((step) => step.failure);
  return `<section class="part" id="failures"><h2 class="label">${esc(PAGE_LABELS.failures)}</h2>`
    + `<p class="note">${esc(rows.length ? PAGE_SENTENCES.failuresIntro : PAGE_SENTENCES.noFailures)}`
    + `${notReviewed ? ` ${esc(PAGE_SENTENCES.failuresNotReviewed)}` : ''}</p>`
    + rowGroup(PAGE_LABELS.passedOver, items.passed, { alert: true }) + items.passedCut
    + rowGroup('', items.handled, { fold: PAGE_LABELS.handledFold(items.handledCount) }) + items.handledCut
    + foldedHere(items.uncheckedCount, 'failure')
    + failedPart(page)
    + '</section>';
}

// ---- steps ------------------------------------------------------------------------------------------------

/**
 * D69 f (g): a step's title on the page, from the recorder's structure only, at most three phrases in this order: the
 * files it changed inside the repository and their common directory (by the recorded write operations; else the files
 * changed outside it, counted), the commands the record says failed, the files the recorder typed as reads (`isRead`,
 * counted, never placed: a read path never reaches the page), the helpers it spawned — and, only when none of these
 * applies, how many commands it ran. No program's name is read: the story's tables (`commandFacts`: read-only
 * programs, git writes, installs, scripts) are not on the page's path.
 */
function pageStepTitle(step) {
  const phrases = [];
  const { files } = step;
  if (files.length) {
    const ops = new Set(files.flatMap((file) => [...file.operations]));
    const verb = ops.size !== 1 ? 'changed' : ops.has('edit') ? 'edited' : ops.has('delete') ? 'deleted' : 'wrote';
    const dir = commonDirectory(files.map((file) => file.path));
    phrases.push(`${verb} ${plural(files.length, 'file')}${dir ? ` in ${clipPath(dir, STORY_LIMITS.titleDirChars)}` : ''}`);
  } else if (step.outside) phrases.push(`changed ${plural(step.outside, 'file')} outside the repository`);
  const failed = step.commands.filter((c) => c.failed).length;
  if (failed) phrases.push(`${plural(failed, 'command')} failed`);
  // /18 (D79): the commands the recorder typed as refused before they ran, apart from the failed ones.
  const didNotRun = step.commands.filter((c) => c.didNotRun).length;
  if (didNotRun) phrases.push(`${plural(didNotRun, 'command')} ${PAGE_LABELS.didNotRun}`);
  // D80: and the ones it typed as stopped before they finished.
  const stopped = step.commands.filter((c) => c.stopped).length;
  if (stopped) phrases.push(stoppedPhrase(stopped));
  const reads = new Set(step.events.filter(isRead).flatMap((event) => list(event.paths).map((p) => p?.path))
    .filter((path) => typeof path === 'string' && path)).size;
  if (reads) phrases.push(`read ${plural(reads, 'file')}`);
  if (step.spawns) phrases.push(`spawned ${plural(step.spawns, 'helper')}`);
  if (!files.length && phrases.length === (step.outside ? 1 : 0) && step.commands.length)
    phrases.push(`ran ${plural(step.commands.length, 'command')}`);
  const title = phrases.slice(0, 3).join(' · ');
  return title ? capital(title) : STORY_SENTENCES.noActions;
}

/** A step's row: its title and, unless trimmed, what the review placed in it, its helpers, and how many files it changed
 *  outside the repository. The files it changed inside are listed once, in "Files changed", with the steps of each. */
function stepRow(page, step, trim) {
  const findings = step.findings.filter(sessionFinding);
  const flagged = findings.length > 0 || step.decisions.some((x) => x.who === UNASKED);
  const lines = [`<p class="said-line">${esc(pageStepTitle(step))}</p>`];
  if (trim < TRIM.steps) {
    const claims = step.promises.length + step.written.length;
    const small = [step.request !== null ? `request ${step.request}` : null,
      findings.length ? plural(findings.length, 'finding') : null,
      step.decisions.length ? plural(step.decisions.length, 'decision') : null,
      claims ? plural(claims, 'claim') : null].filter(Boolean);
    if (small.length) lines.push(`<p class="small">${esc(capital(small.join(' · ')))}</p>`);
    if (step.outside) lines.push(`<p class="small">${esc(`${plural(step.outside, 'file')} ${STORY_SENTENCES.outside}`)}</p>`);
    for (const helper of step.helpers) {
      const brief = clip(oneLine(helper.brief || 'no brief recorded'), PAGE_LIMITS.briefChars);
      const run = helper.run === undefined ? '' : ` (${helper.runName})`;
      const report = helper.report !== null ? ` — ${STORY_SENTENCES.helperReported} ${helper.report}` : '';
      const elsewhere = helper.request !== null && step.request !== null && helper.request !== step.request
        ? ` (${STORY_SENTENCES.helperForRequest(helper.request)})` : '';
      lines.push(`<p class="said-line code">${esc(`Helper${run}: ${brief}${report}${elsewhere}`)}</p>`);
    }
  }
  if (step.failure) lines.push(`<span class="flagchip">${esc(STORY_SENTENCES.notReviewed)}</span>`);
  return `<li class="turn-row${flagged ? ' flag' : ''}" id="step-${step.n}"><span class="t">step ${step.n}</span>`
    + `<span class="rail"><span class="pip"></span></span><div class="what">${lines.join('')}</div></li>`;
}

/** A card folded under its bar (D69 f (g): the steps and the files are there to check against, not to read first). */
const foldedCard = (id, cls, title, count, body) => `<section class="card-ui${cls}" id="${id}"><details class="card-fold">`
  + `<summary class="card-bar"><h2>${esc(title)}</h2><span class="mono">${esc(count)}</span></summary>${body}</details></section>`;

function stepsCard(page, trim) {
  const { steps } = page.facts;
  const count = plural(steps.length, 'step');
  if (!steps.length) return foldedCard('steps', ' timeline', PAGE_LABELS.steps, count, `<div class="content"><p class="note">${esc(STORY_SENTENCES.noSteps)}</p></div>`);
  const shown = steps.slice(0, page.shownSteps);
  const rest = steps.length - shown.length;
  return foldedCard('steps', ' timeline', PAGE_LABELS.steps, count,
    (trim >= TRIM.steps ? `<p class="cut pad">${esc(PAGE_SENTENCES.stepsTrimmed)}</p>` : '')
    + (shown.length ? `<ol class="turns">${shown.map((step) => stepRow(page, step, trim)).join('')}</ol>` : '')
    + (rest ? `<p class="cut pad">${esc(rest === 1 ? `Step ${steps.length} is not shown.` : `Steps ${shown.length + 1}–${steps.length} are not shown.`)}</p>` : ''));
}

// ---- files ------------------------------------------------------------------------------------------------

/** Every file changed inside the repository, once: its counts over the session, a helper's marked, and the steps that
 *  changed it (linked). */
function filesCard(page, trim) {
  const { whole, steps } = page.facts;
  const count = plural(whole.files.length, 'file');
  const outside = whole.outside ? `<p class="cut">${esc(`${plural(whole.outside, 'file')} ${STORY_SENTENCES.outside}.`)}</p>` : '';
  // D80: the writes of a failed or stopped command, never among the changed files: listed apart, each with its step,
  // at most as many as the files, the rest counted.
  const unsure = whole.unconfirmed.slice(0, page.caps.files);
  const unconfirmed = unsure.length && trim < TRIM.files
    ? `<p class="note"><span class="label">${esc(PAGE_LABELS.unconfirmedWrites)}</span></p><ul class="files">`
      + unsure.map((row) => {
        const step = page.stepOfEvent.has(row.event.id) ? page.stepOfEvent.get(row.event.id) + 1 : null;
        return `<li>${row.outside ? `<span class="note">${esc(STORY_SENTENCES.writeNotNamed)}</span>`
          : `<code>${esc(clipPath(oneLine(row.path), PAGE_LIMITS.pathChars))}</code> `
            + `<span class="mono">${countsWord(page, row.counts)}</span>`}${unconfirmedChip(row)}`
          + `${step ? ` <span class="turn">${stepLink(page, step)}</span>` : ''}</li>`;
      }).join('') + '</ul>'
      + (whole.unconfirmed.length > unsure.length ? `<p class="cut">${esc(notShown(
        whole.unconfirmed.length - unsure.length, 'write', 'writes', unsure.length))}</p>` : '') : '';
  if (!whole.files.length) {
    return foldedCard('files', '', PAGE_LABELS.files, count,
      `<div class="content"><p class="note">${esc(PAGE_SENTENCES.noFiles)}</p>${unconfirmed}${outside}</div>`);
  }
  if (trim >= TRIM.files) return foldedCard('files', '', PAGE_LABELS.files, count, `<div class="content"><p class="cut">${esc(PAGE_SENTENCES.filesTrimmed)}</p>${outside}</div>`);
  const shown = whole.files.slice(0, page.caps.files);
  const rows = shown.map((file) => {
    const ns = steps.filter((step) => step.files.some((f) => f.path === file.path)).map((step) => step.n);
    return `<li><code>${esc(clipPath(oneLine(file.path), PAGE_LIMITS.pathChars))}</code> `
      + `<span class="mono">${countsWord(page, file.counts)}</span>${file.helper ? ` <span class="pill">${esc(PAGE_LABELS.helper)}</span>` : ''}`
      + `${ns.length ? ` <span class="turn">${stepRunsLinks(page, ns)}</span>` : ''}</li>`;
  });
  return foldedCard('files', '', PAGE_LABELS.files, count, `<div class="content"><ul class="files">${rows.join('')}</ul>`
    + `${whole.files.length > shown.length ? `<p class="cut">${esc(notShown(whole.files.length - shown.length, 'file',
      'files', shown.length))}</p>` : ''}${unconfirmed}${outside}</div>`);
}

// ---- footer -----------------------------------------------------------------------------------------------

/** What the page itself left out, and how to read it. What the review could not check is its own section. */
function footer(page, trim) {
  const { honest } = page;
  const lines = [];
  // D87: with a code pass the code was read, as it is now, beside the session (`codePart`).
  if (honest.reviewScope === 'session-only') lines.push(page.codePass ? PAGE_CODE_WORDS.footer : PAGE_SENTENCES.sessionOnly);
  if (page.codeFindings) lines.push(PAGE_SENTENCES.codeFindings(page.codeFindings));
  if (trim >= TRIM.edits) lines.push(PAGE_SENTENCES.editsTrimmed);
  // D79: a long attached file is shown in part too, under its message or before your requests.
  if (trim >= TRIM.asks && [...page.facts.asks.flatMap((ask) => [ask, ...ask.attachments]), ...page.facts.unattached]
    .some((ask) => [...visible(ask.text)].length > PAGE_LIMITS.askChars)) lines.push(PAGE_SENTENCES.asksTrimmed);
  if (trim >= TRIM.lists) lines.push(PAGE_SENTENCES.listsTrimmed);
  lines.push(PAGE_SENTENCES.legend);
  if (page.inexactShown) lines.push(PAGE_SENTENCES.countLegend);
  return `<footer class="foot">${lines.map((line) => `<p>${esc(line)}</p>`).join('')}`
    + `<p class="gen">${esc(PAGE_SENTENCES.generated)}</p></footer>`;
}
// ---- the page -----------------------------------------------------------------------------------------------

const LOGO = '<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect class="l-bg" width="64" height="64" rx="14"/>'
  + '<rect class="l-fg" x="14" y="17" width="26" height="6" rx="3"/><rect class="l-fg l-dim" x="14" y="29" width="22" height="6" rx="3"/>'
  + '<rect class="l-ac" x="40" y="27" width="10" height="10" rx="2"/><rect class="l-fg" x="14" y="41" width="30" height="6" rx="3"/></svg>';

const DARK = `--bg: #161310; --card: #1e1a16; --panel: rgba(255,255,255,.04); --footer: #1b1814; --ink: #f1ece6;
    --muted: #b5aca2; --faint: #a39a90; --line: #2e2823; --line-strong: #463e37; --wash: #24201b; --accent: #f59a2e;
    --accent-ink: #ffb45e; --accent-soft: rgba(245,154,46,.14); --accent-edge: rgba(245,154,46,.40);
    --add: rgba(90,190,120,.14); --del: rgba(240,110,90,.14);
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 24px 60px -24px rgba(0,0,0,.6);`;

/** The page's one stylesheet: sonah.dev's tokens and components (light), and a warm dark derived from them. D69 f (g):
 *  `--faint` (the labels that say who spoke, step links, counts) at least 4.6:1 on the card, the wash and the flagged
 *  ledger in both themes (WCAG 2.2 AA 1.4.3 needs 4.5:1 for text this size); an accent label's text in `--accent-ink`,
 *  `--accent` kept for borders, marks and the timeline pip. */
export const PAGE_CSS = `
:root {
  color-scheme: light dark;
  --bg: #f7f7f4; --card: #ffffff; --panel: rgba(235,232,228,.6); --footer: #eeede6; --ink: #251f19;
  --muted: #68615a; --faint: #746b62; --line: #ebe8e4; --line-strong: #d4cdc7; --wash: #f7f6f2; --accent: #f48d16;
  --accent-ink: #9a5300; --accent-soft: rgba(244,141,22,.10); --accent-edge: rgba(244,141,22,.35);
  --add: rgba(46,140,74,.10); --del: rgba(200,64,40,.09);
  --shadow: 0 1px 2px rgba(37,31,25,.04), 0 24px 60px -24px rgba(37,31,25,.22);
  --sans: "Geist", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --display: "DM Sans", "Inter", system-ui, -apple-system, sans-serif;
  --mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    ${DARK}
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  ${DARK}
}
:root[data-theme="light"] { color-scheme: light; }
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--sans); font-size: 16px; line-height: 1.5;
  -webkit-font-smoothing: antialiased; }
h1, h2, h3, h4, p, dl, dd, figure, blockquote, pre, ol, ul { margin: 0; }
a { color: inherit; }
code, .mono { font-family: var(--mono); }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.page { max-width: 860px; margin: 0 auto; padding: 32px 16px 80px; display: flex; flex-direction: column; gap: 24px; }
.masthead { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; }
.wordmark { display: inline-flex; align-items: center; gap: 9px; font: 600 22px/1 var(--display); letter-spacing: -0.02em; }
.logo { width: 26px; height: 26px; flex-shrink: 0; }
.l-bg { fill: var(--ink); } .l-fg { fill: var(--bg); } .l-dim { opacity: .55; } .l-ac { fill: var(--accent); }
.title-words { font-size: 14px; color: var(--muted); overflow-wrap: anywhere; }
.card-ui { width: 100%; margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 20px; overflow: hidden;
  box-shadow: var(--shadow); }
.card-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 14px 18px;
  background: var(--wash); border-bottom: 1px solid var(--line); }
.card-bar h1, .card-bar h2 { font: 600 14px/1.3 var(--display); }
.card-bar .mono { font-size: 12px; color: var(--faint); }
.content { padding: clamp(16px, 4vw, 24px); }
.label { font-size: 11px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); }
.label.accent { color: var(--accent-ink); }
.pill { display: inline-block; font-size: 12px; line-height: 1.4; color: var(--muted); background: var(--wash);
  border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; white-space: nowrap; }
.pill.reading { border-style: dashed; }
.flagchip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px;
  background: var(--accent-soft); border: 1px solid var(--accent-edge); color: var(--accent-ink); font-size: 12px;
  font-weight: 500; line-height: 1.4; }
.decided { margin-top: 8px; font-size: 15px; color: var(--muted); }
.note .more { margin-left: 4px; color: var(--accent-ink); }
.more { font-size: 13px; color: var(--muted); }
.attention { margin-top: 16px; display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: 12px;
  background: var(--wash); border: 1px solid var(--line); }
.attention ul { list-style: none; margin: 2px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.attention li, .attention p { font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.attention a { color: var(--accent-ink); }
.attention li.hl { padding-left: 8px; border-left: 3px solid var(--accent); }
.attention li.hl a { font-weight: 700; }
.attention p.folded, .note.folded { color: var(--muted); }
.attention p.folded a, .note.folded a { color: inherit; }
details.unchecked > summary h2 { display: inline; }
.finding.not-acting > div { padding-left: 10px; border-left: 3px solid var(--accent); }
.mark { margin-top: 6px; }
.evidence { margin-top: 8px; }
.evidence > .label { display: block; }
.evidence .rows li { font-size: 13px; }
.part { margin-top: 28px; }
.group { margin-top: 18px; }
.group-alert { padding-left: 14px; border-left: 3px solid var(--accent); }
.group .note.lead { margin-top: 6px; font-size: 14px; line-height: 1.45; color: var(--muted); overflow-wrap: anywhere; }
.how-code { margin-top: 10px; }
.how-code > .label { display: block; }
.label.sub { display: block; margin-top: 14px; }
.findings { list-style: none; padding: 0; }
.finding { display: grid; grid-template-columns: 28px minmax(0, 1fr); column-gap: 10px; padding: 16px 0;
  border-top: 1px solid var(--line); }
.finding:first-child { border-top: none; }
.finding .n { font-family: var(--mono); font-size: 12px; color: var(--faint); padding-top: 2px; }
.finding.alert .n { color: var(--accent-ink); }
.finding .row { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; column-gap: 12px; row-gap: 2px; }
.turn { font-family: var(--mono); font-size: 11px; color: var(--faint); white-space: nowrap; }
a.turn, .turn a { text-decoration: none; }
a.turn:hover, .turn a:hover { color: var(--accent-ink); text-decoration: underline; }
.finding .title { margin-top: 4px; font-family: var(--display); font-size: 16px; font-weight: 500; line-height: 1.35;
  overflow-wrap: anywhere; }
.finding blockquote { margin: 6px 0 0; padding: 2px 0 2px 12px; border-left: 2px solid var(--accent); font-family: var(--mono);
  font-size: 12.5px; line-height: 1.55; color: var(--muted); overflow-wrap: anywhere; }
.finding .note, .part > .note, .content > .note { margin-top: 8px; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
.note > .label { margin-right: 6px; }
.note.gap { color: var(--accent-ink); }
.meta { color: var(--muted); }
.chips { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
.voice { margin-top: 10px; }
.voice > .label { display: block; }
q.said { quotes: "\\201C" "\\201D"; color: var(--ink); background: var(--accent-soft); border-radius: 3px; padding: 0 2px;
  -webkit-box-decoration-break: clone; box-decoration-break: clone; }
q.said::before, q.said::after { color: var(--accent-ink); font-weight: 700; }
q.said code { font: inherit; }
.ask-whole { margin-top: 8px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.cut { margin-top: 8px; font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }
.cut.pad { margin: 0; padding: 12px clamp(14px, 3vw, 22px) 0; }
.rows { list-style: none; margin-top: 8px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.rows li { font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.rows .pill { margin-right: 8px; }
.rows .turn { margin-left: 6px; }
details.change, details.checked, details.whole, details.fold, details.failed { margin-top: 10px; }
details.row-steps { margin-top: 4px; }
details.row-steps > summary { font-size: 12px; }
.xref a, .checks a, .row-steps a { color: var(--accent-ink); }
.rows .xref { margin-top: 2px; font-size: 12.5px; }
.cmd { margin-top: 8px; }
.cmd code { display: block; font-size: 11.5px; line-height: 1.5; color: var(--muted); background: var(--wash);
  border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; overflow-wrap: anywhere; }
.note.answer { color: var(--ink); }
.checks { list-style: none; margin-top: 8px; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.checks li { font-size: 14px; line-height: 1.45; overflow-wrap: anywhere; }
.checks .label { margin-right: 6px; }
.ask-lines { list-style: none; margin-top: 6px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.ask-lines li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; font-size: 13px; }
.ask-lines .mono { font-size: 12px; color: var(--faint); }
details.group.fold > summary { margin-top: 18px; }
.card-fold > summary.card-bar { color: var(--ink); font-size: 14px; }
.card-fold > summary.card-bar h2 { margin-right: auto; }
.card-fold:not([open]) > summary.card-bar { border-bottom: none; }
details > summary { list-style: none; cursor: pointer; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px;
  font-size: 13px; color: var(--muted); }
details > summary::-webkit-details-marker { display: none; }
details > summary::before { content: ""; flex-shrink: 0; align-self: center; width: 0; height: 0; border-style: solid;
  border-width: 4px 0 4px 6px; border-color: transparent transparent transparent var(--accent); transition: transform .15s ease; }
details[open] > summary::before { transform: rotate(90deg); }
summary code { font-size: 12.5px; color: var(--ink); overflow-wrap: anywhere; }
pre.diff { margin-top: 8px; font: 12.5px/1.55 var(--mono); color: var(--ink); background: var(--wash); border: 1px solid var(--line);
  border-radius: 12px; padding: 10px 0; overflow-x: auto; }
pre.diff .lines { display: inline-block; min-width: 100%; }
pre.diff .ln { display: block; padding: 0 14px; white-space: pre; }
pre.diff .add { background: var(--add); }
pre.diff .del { background: var(--del); }
pre.diff .key { box-shadow: inset 2px 0 0 var(--accent); }
.sub-h { display: block; margin-top: 24px; }
.files { list-style: none; margin-top: 4px; padding: 0; }
.files li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; padding: 8px 0; border-top: 1px solid var(--line);
  font-size: 13px; }
.files li:first-child { border-top: none; }
.files code { overflow-wrap: anywhere; min-width: 0; }
.files .mono { color: var(--muted); }
.turns { list-style: none; padding: clamp(14px, 3vw, 22px); }
.turn-row { display: grid; grid-template-columns: 64px 14px minmax(0, 1fr); column-gap: 10px; }
.turn-row .t { font-family: var(--mono); font-size: 11px; color: var(--faint); padding-top: 3px; white-space: nowrap; }
.turn-row .rail { position: relative; display: flex; justify-content: center; }
.turn-row .rail::before { content: ""; position: absolute; top: 14px; bottom: 0; width: 1px; background: var(--line); }
.turn-row:last-child .rail::before { display: none; }
.turn-row .pip { position: relative; margin-top: 5px; width: 9px; height: 9px; border-radius: 999px; background: var(--card);
  border: 1.5px solid var(--line-strong); }
.turn-row.flag .pip { background: var(--accent); border-color: var(--accent); }
.turn-row .what { min-width: 0; padding-bottom: 18px; }
.turn-row:last-child .what { padding-bottom: 0; }
.said-line { margin-top: 4px; font-family: var(--display); font-size: 14.5px; line-height: 1.5; overflow-wrap: anywhere; }
.what > .said-line:first-child { margin-top: 0; }
.said-line.code { font-family: var(--mono); font-size: 12.5px; color: var(--muted); }
.turn-row .small { margin-top: 2px; font-size: 12px; color: var(--faint); }
.turn-row .flagchip { margin-top: 8px; }
.foot { display: flex; flex-direction: column; gap: 8px; padding: 24px clamp(16px, 4vw, 24px); border-radius: 20px;
  background: var(--footer); font-size: 14px; color: var(--muted); }
.foot .gen { margin-top: 4px; padding-top: 14px; border-top: 1px dashed var(--line-strong); }
@media (prefers-reduced-motion: reduce) {
  details > summary::before { transition: none; }
}
`;

function compose(page, { trim, lists, findings }) {
  page.inexactShown = false;
  page.citedShown = new Set();
  page.caps = capsOf(lists, findings);
  page.shownSteps = Math.min(page.facts.steps.length, page.caps.steps);
  const { facts, kind, title } = page;
  const gaps = gapsByRequest(page);
  const causes = causesOf(page);
  page.plan = planOf(page, gaps);
  const source = [kind, plural(facts.steps.length, 'step'), durationWord(facts.events)].filter(Boolean).join(', ');
  page.answerShown = false;
  // Every row that may show a failed command is composed before the failures section, whose failed-command list counts
  // the rest (`failedPart`, after every row) — D88: the rows Sonah could not check too (`foldedRows`).
  const decisions = decisionsPart(page, trim);
  const requests = requestsPart(page, trim, gaps, causes);
  const claims = claimsPart(page, trim);
  const edits = editsPart(page, trim);
  const failureItems = failureItemsOf(page);
  const folded = foldedRows(page, trim, failureItems);
  const failures = failuresPart(page, trim, failureItems);
  const code = codePart(page);
  const unchecked = uncheckedPart(page, gaps, causes, folded);
  // D71 (a), (S4); D88 (owner decision 2026-10-14): the page is the checklist, led by the agent's judgment and the
  // settled problems — where your attention is needed, then what the agent decided (its choices not to act highlighted,
  // its changes of approach), what you asked, the failures it passed over, what the agent told you, the edits against
  // what you said and the statements it wrote into files, what the code review found, and last, collapsed, what Sonah
  // could not check. Then the steps and the files, folded. No verdict.
  const intro = answerNote(page);
  const card = `<figure class="card-ui review" aria-labelledby="review-title"><div class="card-bar"><h1 id="review-title">${esc(PAGE_LABELS.review)}</h1>`
    + `<span class="mono">${esc(source)}</span></div><div class="content">`
    + attentionBlock(page) + intro
    + decisions + requests + failures + claims + edits + code + unchecked
    + '</div></figure>';
  // The sections after the card are composed before the footer, which says whether a line count was inexact.
  const body = [
    `<header class="masthead"><p class="wordmark">${LOGO}Sonah</p>${title ? `<p class="title-words">${esc(title)}</p>` : ''}</header>`,
    card, stepsCard(page, trim), filesCard(page, trim),
  ].filter(Boolean);
  const foot = footer(page, trim);
  // One list item a line, so a reader of the source (and a snapshot's diff) can follow it. Recorded text never holds a
  // tag (it is escaped), and no list item is inside a <pre>, so this changes no rendered text.
  const html = [...body, foot].join('\n').replace(/<\/li>/g, '</li>\n');
  const themeAttribute = page.theme === SYSTEM ? '' : ` data-theme="${page.theme}"`;
  const colorScheme = page.theme === SYSTEM ? 'light dark' : page.theme;
  return `<!doctype html>
<html lang="en"${themeAttribute}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="${colorScheme}">
<meta name="generator" content="${PAGE_VERSION}">
<title>${esc(title ?? 'Sonah session review')}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main class="page">
${html}
</main>
</body>
</html>
`;
}

/**
 * What each composition leaves out, in order, until the page fits `maxBytes`: nothing; the step details (titles kept);
 * the file list (counted); the edits; a long request's whole text (its start kept); then, with a decision's checked
 * instructions only counted, every list but the findings halved until none is shown, then the findings halved until
 * none is. The last holds only fixed words and counts, so it fits: `maxBytes` is a hard bound.
 */
function* compositions() {
  for (const trim of [TRIM.none, TRIM.steps, TRIM.files, TRIM.edits, TRIM.asks]) yield { trim, lists: 1, findings: 1 };
  for (let lists = 1; ; lists /= 2) {
    yield { trim: TRIM.lists, lists, findings: 1 };
    if (LIST_BOUNDS.every((key) => key === 'findings' || Math.floor(PAGE_LIMITS[key] * lists) === 0)) break;
  }
  for (let findings = 1 / 2; ; findings /= 2) {
    yield { trim: TRIM.lists, lists: 0, findings };
    if (Math.floor(PAGE_LIMITS.findings * findings) === 0) break;
  }
}

/**
 * The review page of one session, as one self-contained HTML document. `session` is the redacted Session the adapter
 * built; `report` the finished review report of that session. `options.title` names the page; `options.theme` is one
 * of `PAGE_THEMES` (D69 f (g): `system` unless given — the reader's own setting; `light` and `dark` fix it);
 * `options.sessionHash` is the session's redacted hash (redact/index.js `sliceHash`), which the answer command, printed
 * once, names; `options.decisionReviews` (a Map or an object, ledger decision id -> `{ verb, reason }`) your earlier
 * answers, each shown under its decision. Pure: the same inputs give the same bytes. A page past `PAGE_LIMITS.maxBytes` keeps only step titles, then only counts the changed files,
 * then leaves the edits out, then shows a long request only in part, then shortens its lists until it fits
 * (`compositions`), and says so.
 */
export function renderSessionPage(session, report, options = {}) {
  // D84: rendered from the session as a person may read it (story.js `asPeopleRead`), never the one the model read.
  return asPeopleRead(session, (view) => {
    const page = pageFacts(view, plainObject(report) ? report : {}, plainObject(options) ? options : {});
    let html = '';
    for (const composition of compositions()) {
      html = compose(page, composition);
      if (bytes(html) <= PAGE_LIMITS.maxBytes) break;
    }
    return html;
  }, report, Array.isArray(options?.codeSecrets) ? options.codeSecrets : []);
}
