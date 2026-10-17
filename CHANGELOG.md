# Changelog

## 0.3.0-beta.3

Sonah states fewer false things about a recording, and it reads more of each long output. A finished background run
now shows its end. Each check that Sonah could not do now names the test that stopped it. Commands, the page and the
files under `~/.sonah` can still change between betas.

To update, run `npm install -g getsonah@latest`. [Update](docs/INSTALL.md#update) gives the other ways. After you
update, Sonah reviews again every long session that an earlier version reviewed. It also reviews again about half of
the short ones.

### One reading per recorder fact

- Claude Code 2.1.284 and later write extra keys on a background task's notice. Sonah now reads these notices. A
  finished background run shows its end, not "no end".
- A command that moved to the background at its timeout now joins its notice too. Sonah reads the run's id from the
  recorder's own field, not from a sentence.
- A notice that Claude Code queued while the agent worked now closes its run too. A new key on its row no longer
  hides it.
- Sonah now reads what a call changed by one rule in every part. A write inside a refused command changed nothing.
  The page no longer counts it as an unknown write, a missing body or a change outside the repository.
- A failed edit no longer counts as a write whose body the recording lacks.
- A write stopped before it finished may have changed its file. Sonah keeps it in the change list, with an unknown
  outcome.
- The page and the .md list such a write apart from the changed files. They no longer call it a changed file.
- The page's header and the code review find a file's last edit by the same rule. A refused write after a test run no
  longer hides that run.
- Sonah no longer tells the code review that a refused command ran after a file's last edit. Like the page, Sonah
  tells it that no command ran after that edit. The page still lists each refused command, as one that did not run.
- The code review's list of changed files holds only changes that could have happened.
- Sonah never takes a refused write's body as a file's earlier state.
- Sonah reviews a session again only where its recording's evidence moved.

### A run has no end only when the recording proves it

- A background run may end in a notice that Sonah cannot read. Sonah now checks the recording before it says the run
  has no end.
- Later records can mention such a run. There the page reads: "Later records mention this run, but Sonah could not
  read whether or how it ended."
- Otherwise the page reads: "Sonah could not check whether the recording holds an end of this run." This happens
  when the run's id is only in records before its start, or Sonah could not search for it.
- The page lists such a run under What Sonah could not check, never as a failure. A claim that rests on it stays open.
- The page's header says that Sonah could not read whether or how these runs ended. It never says that they ended.
- An ask that cites such a run is not checked. Its reason says that Sonah could not read the end.
- A run that its notice marks as stopped or killed now reads "stopped before it finished".
- The header and the failure items no longer say that a stopped or cancelled run has no recorded end.
- A Workflow or a background agent with no receipt follows the same rule.
- So does a Workflow that Sonah could not link to a result, when Sonah could not read its end. The page names it
  under What Sonah could not check, as a run whose end Sonah could not read.
- Sonah now counts each record that one reader knew and another could not read. It counts them by reason and recorder
  version, Codex included. The counts go to the review's private record, not to the page.
- The counts include every notice that Sonah labels, also one that no reader kept.
- The counts name the kind of each run whose end Sonah could not read: a command, Workflow or agent. A check can
  then account for every notice linked to a command.
- Sonah reviews a session again only where its recording's evidence moved.

### Sonah says what it could not read, never that something is missing

- Sonah read every fixed sentence of the page, the .md, the PR comment and the terminal. A sentence that says something
  is missing now needs code that proves it.
- Where no code proves it, the sentence says what Sonah found or could not read. For example: "Sonah found no command
  in the recording."
- A command with no result that Sonah read no longer "has no recorded end". The header says "for 1 Sonah found no
  result".
- The causes of what Sonah could not check no longer speak for the recording. They say what Sonah holds or could not
  read.
- A claim rests on "a check that Sonah did not see finish".
- The code review's lines say that Sonah could not read the working directory, or the start from git.
- The report says that git did not show a commit on GitHub. Git on your computer can miss a push from another one.
- A run that Claude Code marks as completed reads "completed, Sonah read no exit code". Its notice can name the
  exit code.
- A call that failed or was refused reads "The recorder does not mark which." Its recorded text can still say which.
- A code finding that Sonah withheld for its lines now names both checks that could fail.
- A write whose command failed or stopped reads "Sonah could not read whether this write happened". A later record can
  still show the file.
- A test now fails when a word table gains a sentence that no one read.
- The test also checks how far each sentence claims. A sentence about the whole recording needs a proof that searched it.
- What Sonah sends for a review does not change.

### Why an ask is not checked

- Sonah now names the check that refused the quote for an ask. Before, it always said that it did not find the quote
  word for word.
- For a quote that is too long, Sonah writes words like these. "The session review quoted 134 characters, more than
  the 120 that Sonah checks, so Sonah did not check it."
- Sonah says that it did not find the quote only when it searched for it and did not find it. These words name only
  where Sonah searched: the place that the session review cited. Sonah searched only the text that it showed the
  session review for the answer that gave the quote. The quote can be in another part of the recording.
- The words for the other checks also say no more than the check read. Sonah says that the session review named a
  kind of text, not that it quoted one. A cited part that Sonah does not hold is "not in the recording as Sonah read
  it".
- The words never say that the quote is in the recording, or where it is. Sonah did not check the quote, so it is no
  evidence.
- The words say no more than the check found. Sonah names a mark like the ones that it writes only as a mark. The
  recording itself can hold such a mark.
- A quote from another agent than the one you asked now has its own reason. Sonah says that it could not place the
  quote in the same agent's work as your ask.
- For a quote not after your ask, Sonah says that it could not place it after your ask.
- Sonah counts the characters of a quote as you see them. Where its check counted a different number, the words give
  both numbers. An emoji is one character, and the check counts it as two.
- The status of the ask does not change. Sonah still did not check it.
- The stored report keeps the cause of each refused quote beside its reason, and where Sonah found the quote. No page
  and no .md shows where.
- The stored report also counts the causes of quotes that Sonah refused in a second answer about an ask.
- A report that an earlier version wrote keeps its words.
- This changes the known limit of 0.3.0-beta.2 about asks that Sonah did not check. The reason now names the check
  that refused the quote.

### Sonah says what it saw only in part

- Sonah can show its reviewer only the start and the end of a long output. The report now says so.
- An item, an ask, a claim or a run that cites such an output gets a mark. The mark names the output's run
  or place, and the lines that Sonah left out.
- When Sonah cut inside a line, the mark says so. For a file read, it also names the lines of the file.
- The mark changes no status. A confirmed claim stays confirmed and carries the mark.
- The mark says what Sonah left out, and nothing more. It does not say what those lines would change.
- What Sonah could not check counts these outputs. The count does not lower the coverage of the review.
- Sonah reviews a long session in parts. It counts each such output once, also when only a later part saw it.
- The page no longer links to a run or a claim that it leaves out to keep its size. It keeps the words.
- No request to the model changed. Sonah reuses its saved answers and shows the marks without a new call.

### Sonah reads more of each long output

- In a Claude Code session, Sonah now shows its reviewer each tool output whole, up to 24,000 bytes.
- A longer output shows its first and last 12,000 bytes. Sonah names the lines it left out, and the reviewer can
  ask for them.
- Codex sessions keep the old size: 3,600 bytes at each end.
- Long Claude Code reviews make about 14% more calls.
- Saved reviews of Claude Code sessions ask again where a request changed.
- Separate checkers test each item Sonah reports. A checker now sees whole each output that its item quotes or names.
- The output of an action that an item names, such as a decision's commands, still shows in part.
- When an output is too large for the checker's request, the checker sees its first and last parts. Sonah tells it
  why and names the bytes it left out.
- Whole outputs make a checker's request larger, so it holds fewer items. A long review can make more checker calls.
- An item can cite more output than a checker can see whole at once. Sometimes the checker can still see one of those
  outputs whole. Such an item shares a checker with other items where that output stays whole. If it fits nowhere, it
  goes to a checker alone. An item that shows no output whole shares a checker where it fits, as before. An item that
  goes alone does not stop the items around it from sharing.
- Rarely, an item still goes alone and its checker sees no output whole. One cause: the note that names a cut output
  makes a shared request too large. The other: the checker that it would share sees whole an output that this item cuts.

### A second answer never erases a first

- The session review can ask again and show more of a long output. Sonah now merges the two answers by one rule.
- For each ask, claim, failed command, decision or change of approach, the second answer wins. If Sonah's own check
  refuses the second answer's evidence but accepts the first answer's evidence, the first answer stays.
- This is the check that Sonah applies before it shows you each of them. For an ask, it also checks the words of your
  message that the ask quotes. For a decision or a change of approach, it checks each place that the answer cites.
  Sonah must have shown its reviewer that place, as the answer names it.
- Sonah checks each part of a decision on its own: what the agent chose, the value and who decided it. The first
  decision stays only when Sonah refuses a part of the second and accepts that part of the first. Sonah must also
  accept in the first each part that it accepts in the second.
- If both answers quote the same words of your message for an ask, the two are one ask. The rule above chooses the
  answer that Sonah shows. If the second answer quotes only part of those words, Sonah can still show two asks.
- Neither answer can drop a contradiction that the other answer found. Sonah checks each contradiction as usual.
- Sometimes a claim of the first answer cites no contradiction and no other evidence that Sonah accepts. A claim of the
  second answer can quote the same message. Their quotes can be one inside the other. Sonah drops the first claim only
  after every check upholds the second claim. Otherwise Sonah keeps the first claim and checks it as usual.
- Sonah reads its saved answers again with this rule. It asks again only where the merged answer changes.

### In the terminal

- A long review no longer warns of a memory leak. Twelve calls at once are normal, and Node still warns of a real leak.
- In a folder that the system keeps your terminal out of, `sonah review` now says so and gives the fix, not `EPERM`.

### Known limits

- On a long session, the code review often does not run, because what Sonah would send it is too large. The page can
  then still name the files of the change as if the code review saw them. A later beta fixes both.
- A long session can take many calls to review. One session of 3 MB took about 100 calls.
- The code review reads the repository as it is now. A repository that moved after the session gives it later work
  to review too.
- A helper agent's background command carries no id, so Sonah does not read it as a background run.
- An edit with no recorded result still counts as a changed file. Most such edits come from helper agents, and most
  of them did happen.
- The known limits of 0.3.0-beta.2 below still hold, except two. A write inside a refused command no longer shows as a
  write. A quote that Sonah could not check now gets its true reason.

### Versions

- These versions move: `sonah.session-page/42`, `sonah.session-story/37`, `sonah.report-model/3`,
  `sonah.code-snapshot/11`, `sonah.code-pass/11`, `sonah.narrative/38`, `sonah.challenge/45` and
  `sonah.challenge-dossier/15`.

## 0.3.0-beta.2

Sonah writes one report, ordered by what you must do. The code review is now an agent that reads your repository
itself. Sonah no longer masks or withholds what it reads, sends and shows. Commands, the page and the files under
`~/.sonah` can still change between betas.

To update from 0.3.0-beta.1, run `npm install -g getsonah@latest` ([Update](docs/INSTALL.md#update) gives the other
ways). Then read the part below about what Sonah reads, sends and shows. Sonah no longer masks secrets in the page,
the Markdown report or the terminal.

### One report, ordered by what you must do

- The page is now one report. It starts with a header and a count line. Then it shows your prompt, with each ask
  marked. Then come three sections of items: Must act, Must know and Good to know. Last come What the agent did and
  What Sonah could not check. Sonah folds Good to know and the last two parts, and each section shows its count.
- The header says what the work was and how large the change is. It counts the commands that the agent ran after its
  last edit, by their results. It also says what Sonah did not check.
- Sonah marks each ask in your prompt: done, partly done, not done or not checked. Sonah counts an ask apart when a
  finding of the code review concerns it. It never counts that ask as plain done.
- Each item starts with its type: Fix, Decide, Read or Verify. Then it says what the item is and where it is. With the
  code review, it also says the impact on you and one action. A decision that you did not ask for carries the mark
  "You did not ask for this." Sonah folds the evidence under each item.
- Sonah puts each item in a section by its kind. The code review can propose high, medium or low for an item, with a
  reason. Sonah keeps that proposal inside fixed bounds for the kind. An unmet ask, a bug that a second reviewer found,
  or a contradicted claim never goes to Good to know. Must act never holds an item that cites a call that a permission
  rule or auto mode refused. A decision on how to do something that you asked goes to Good to know, unless a finding or
  question of the code review concerns it. The fold of each item gives the reason for its section.
- The code review also writes one line for each changed file. The page shows this line in italics, as the code
  review's words, beside the file's added and removed lines. Sonah checks the form of these lines, not their meaning.
- `--format html --output X.html` also writes `X.md` beside the page. `X.md` holds the same report in Markdown, for a
  pull request comment. `--format md --output X.md` writes the .md alone. With no `--output`, the .md goes to the
  terminal. Only you can read the two files. If either file exists, Sonah stops before its first model call.
- The .md is at most 60,000 bytes, so it fits in a GitHub comment. For a longer report, Sonah first shortens the
  evidence and the lists, and says so once. The .md pings no one. Sonah puts a mention, an issue number or a commit
  hash from the recording in a code span.
- At the end, the terminal prints the count line and the Must act items. Then it prints a command for the GitHub CLI:
  `gh pr comment --body-file X.md`, which posts on the pull request of your current branch. Sonah posts nothing
  itself.
- After you commit and push the work, the page and the .md link each place in the code to GitHub. Sonah reads these
  facts from your local git only, and fetches nothing. Did you run Sonah before you committed? Then the terminal tells
  you to commit, push and run the same command with a new `--output` file. Sonah reuses its stored answers, so that run
  makes no model call. Keep the report files outside the repository. Otherwise the code review reads them as part of
  the change.
- Sonah's fixed sentences now follow plain English at about 80% of ASD-STE100. A sentence has at most 20 words and
  uses the active voice. One term names one thing. A linter checks these rules in the tests.
- Removed: the Markdown story and its charts, and the checklist layout of the page. The .md report replaces them. The
  terminal no longer prints "Where your attention is needed": the count line replaces it.
- The words of the count-only PR comment changed. Sonah finds a comment that it posted by a hash of the comment's text.
  Maybe beta.1 could not confirm that it posted its comment (`operation_uncertain`). Then this version does not find
  that comment, and it would post a new one. Look at the pull request yourself before you post again.

### The code step is a review agent

- After the session review, a review agent reviews the change the session made, the way a reviewer reviews a pull
  request: Claude Code with three read-only tools (Read, Grep and Glob) over your repository as it is now. It is given
  the change (every file that differs from the commit the session started from, read with git, which Sonah never writes
  to; with no git history, the session's recorded edits), your words, the project instruction and skill files the
  session loaded, and Sonah's review of the session. It cannot run or write anything. It runs with the `claude-cli`
  backend only: with `codex-cli` or `anthropic-api` it does not run, and the page and the terminal say so.
- It checks the change, your asks and the agent's claims and decisions against the code. Each finding names the input
  that shows it and quotes every step from that input to the line it is about. Every quote is checked word for word by
  code against the file it names; an answer that breaks the contract goes back to the agent once, naming what is wrong.
  At most 20 findings and 20 questions of one review are checked; any past that is listed, unchecked.
- A checking agent with the same tools then tries to refute each finding, never shown the agent's own account, and one
  more checks the questions it asks. A finding is shown only when its checker upholds it with quotes of the code; a
  supporting sentence the checker finds false is cut and not shown; a behaviour that is as stated but may be what you
  wanted becomes a question for you; anything withheld is listed with its reason.
- Each finding and each question of the code review is an item of the report. What Sonah could not check lists what
  the code review did not cover and what its checks withheld. The report shows nothing as found to hold, and it never
  says that it covered everything. A claim that a finding shows false says so beside its status. The code review never
  changes that status. Beside each of your asks, the report names the items that the code review tied to it.
- With `--code-pass` on the command line, the code step must also cover the whole change and finish its checks. The code
  review does not read as complete while any part of the change went unshown, or while the repository changed during
  the review.
- A file the session wrote that changed again after its last recorded edit (a formatter, a script, your own edit) is
  shown with its change from where the session started, like any changed file, and a finding on its changed lines is
  checked like any other. The report says that Sonah cannot tell whether all of its lines are the agent's. It no
  longer keeps the code review from reading as complete.
- What Sonah writes in its state folder and in `~/.sonah` is never part of the change, and neither that nor what Claude
  Code and Codex write in their own folders during the review counts as the repository changing; a file git tracks, or
  one the session wrote, is always part of the change, wherever it lies. A `--state-dir` that is the folder the session
  worked in, or holds it, is refused while the code step runs. In a git repository, run it again on the same
  `--state-dir` with nothing changed since, and nothing is asked again. Any other file written in the repository after
  the session began is part of the change, so a later review asks again: a page saved there with `--output`, or, when
  your home folder is the repository, what Claude Code or Codex wrote in their own folders, the review's own agents
  included.
- The dry run and the line printed before the first call say what the code step adds: one review agent, and one
  checking agent per finding. The usage line at the end counts the agents' turns.
- `sonah doctor` checks, with no model call, that your Claude Code accepts the options the code step's agents need
  (`--restricted`, `--max-turns` and `--json-schema`), and says how to fix it when it does not.

### The session review

- When the review names who decided a choice not to act (such as stopping to ask you), and its check rejects the
  words the review quotes for that choice because they do not state it, the reviewer is asked once more for the agent's
  own words that do. The choice is shown only when its own check upholds those words, never on the rejected ones. Who
  decided it is shown only when its check upholds that too; otherwise the choice reads "could not tell", with why.

### What is read, sent and shown

- With the code step, the change the session made is sent, with the project instruction and skill files the session
  loaded, and the code step's agents read any file of your repository they need, as it is now: nothing in it is
  withheld, a `.env` or a `.claude` folder inside it included. Paths outside the working directory that differ from the
  start commit are counted, and the agents may still read them where they lie in the repository.
- The session review withholds nothing either: the output of a read of a credential-shaped file (a `.env`, a key
  file) or of a file in Claude Code's or Codex's own folders, and a file's lines from before an edit, are sent as
  recorded, like any other.
- Nothing Sonah writes for you is masked any more: the page, the Markdown report, the terminal and `sonah slice` show the
  session and the code as they were recorded, secrets included, and a quote, a command or a file that names a place
  outside the repository is shown as recorded. Treat them, like the recording itself, as sensitive. The PR comment
  still carries counts and fixed sentences only. A review no longer stops with `output_not_masked`, and `sonah decision`
  refuses a reason only for its length.
- Text in a recording that looks like an earlier Sonah page's marks (`‹redacted…›`) is read as the recording's own
  words: a message where you pasted such a page is reviewed whole, never taken as withheld.
- [docs/PRIVACY.md](docs/PRIVACY.md) says what Sonah reads, sends, keeps and shows now.

### Known limits

- The code review is often shallow. Its agent can stop after a few turns and a few file reads. It can miss a problem
  that a careful reviewer finds. A short list of findings does not mean that the change is correct.
- On some changes, the code review of 0.3.0-beta.1 found a problem that this version misses.
- The code review can propose a lower level for a bug. Then a bug that a second reviewer found goes to Must know, not
  Must act. Read Must know too.
- Must know can show one point in two items. An example is a decision and the code review's question about it.
- Sonah marks an ask "not checked" when it cannot find the cited evidence word for word. The agent can still have done
  the work. Open the evidence of the ask to see what Sonah found.
- Sonah can show a write inside a refused command as a write with no recorded result.
- The code review gets one repair of its answer. Sometimes the repair returns another item at the place of a failed
  item. Then Sonah withholds the failed item. The report lists it with the reason. Rarely, the repair drops a failed
  item and changes the next item of the same kind and file. Then the failed item is missing from the report,
  and the next item can show twice.
- The known limits of 0.3.0-beta.1 below still hold, except the one about masking: Sonah masks nothing now.

## 0.3.0-beta.1

The first public beta. Sonah reads the recording of an AI coding session (Claude Code or Codex; Cursor is
experimental) and writes a checklist for the person who ran it: whether the agent did what you asked, and what it
decided on its own, each with the recorded words that show it. It never says the work is right, ready or approved.
Commands, the page and the files under `~/.sonah` can change between betas.

### The page leads with the agent's judgment

- First, what the agent decided on its own: choices it made without asking you, then choices where you asked and it
  chose how, and its changes of approach. A choice not to act is highlighted.
- Then what you asked, each ask shown done, partly done or not done with the evidence that settles it; the failures it
  passed over; what it told you that a recorded result contradicts or confirms; edits against what you said; and what
  the code review found.
- What Sonah could not check is kept, each row with why, in one folded section at the end. The summary at the top
  counts only what needs your attention and says how many rows are folded.
- What you wrote in your project's instruction file (a `CLAUDE.md`, or an `AGENTS.md` the agent was given) counts as
  your words. One the agent wrote or edited itself in the session counts as the agent's, and the reviewer is never
  shown what the agent wrote in it as yours. A file you wrote that the agent edits later is still shown as it was when
  the agent was given it.
- Every quote is checked by code to appear word for word in the recording. Every claim the agent made, and every edit
  against what you said, must survive three independent checking passes. What the checks reject is left off the page;
  what they cannot settle is marked not checked.
- `sonah decision accept|change|clarify` records your answer to a row on your computer, and the page shows it the next
  time it is written.
- The exit code says only whether Sonah's own review ran, never anything about the agent's work. With the code step on
  by default (or by your setting), the session review decides it; what the code step could not read is shown on the
  page and in the terminal. With `--code-pass` on the command line, the code step must read every file it shows too.

### The code step

- After the session review, Sonah reads the change the session made (every file that differs from the commit the
  session started from, read with git, which it never writes to; with no git history, the session's recorded edits)
  and the files the session changed or read, as they are now, and sends them to the reviewer.
- The reviewer first checks the agent's claims, decisions, your asks and the failures it passed over against the code,
  then reads the change four ways: behaviour, tests, contracts, and your ask.
- Each finding names the input that shows it and quotes every step from that input to the line it is about. It is
  shown only when all three of its checking passes uphold it, and those passes never see the agent's own account. A
  concern no line can show becomes a question for you.
- The page lists the findings under "What the code review found", each beside the row of the session review it follows
  from, then the questions and what the code review did not cover. Each checked row says what the code shows of it,
  beside its own status, which the code step never changes.
- `--code-model ID` (or `SONAH_CODE_MODEL`) runs the code step on a model of its own, such as `claude-opus-5-5[1m]`,
  checked as `--model` is, whenever the code step runs. The session review stays on its own model, its requests and
  stored answers unchanged. The code step's stored answers are kept per model, and the usage line names the code step's
  model with its share of the calls. Without it, the code step uses the session review's model.

### Turning the code step on or off

- The code step is on by default.
- `sonah config code-pass off` turns it off for every review, and `sonah config code-pass on` turns it back on.
  `sonah config` shows the setting, kept in `~/.sonah/config.json`, readable by you only.
- For one review, `--no-code-pass` or `--code-pass` wins over the setting.
- The dry run and the line printed before the first call say whether the code step will run and roughly how many calls
  it adds. `sonah doctor` reports the setting.
- A settings file that cannot be read stops a review given no flag, before anything is read or sent, and says how to
  fix it.
- The session's own requests are the same whether the code step is on or off.

### Privacy

- The reviewer reads the session as it was recorded, secrets and pasted images included, through your own login. If
  the reviewer is a different provider or login from the one that ran the session, the session goes there for the
  first time; reviewing with the same provider and login avoids that.
- With the code step, the files the session changed or read are sent too. Never sent: credential-shaped files, anything
  in `~/.claude` or `~/.codex` (or the homes you set for them, or the one the recording lies in, when it lies in Claude
  Code's or Codex's own folder layout) and Claude Code's `~/.claude.json`, binary files, files outside the project, files too large for a request, and files that changed
  since the session. Paths outside the project are counted, never named.
- When the repository is your home folder (or holds it), as in a dotfiles repository, the code step reads only the files
  the session itself changed or read. Every other file git shows changed is counted, never named or sent, and Sonah
  never searches your home folder for new files.
- Secrets are masked in everything Sonah writes for you: the page, the Markdown story, the terminal and a PR comment,
  including secrets found in the files the code step read and wherever the reviewer repeats one. If masking cannot
  run, nothing is written or posted.
- Besides the model requests and a PR comment you ask for, Sonah makes no network request: no telemetry, no update
  check. Stored answers and reviews stay under `~/.sonah`, readable by you only.
- [docs/PRIVACY.md](docs/PRIVACY.md) says exactly what is sent and kept.

### Install and run

- Install from npm with `npm install -g getsonah` (the package is `getsonah`; the command it installs is `sonah`), or
  run it once with `npx getsonah`, or install from a checkout with one command (`node scripts/install.mjs`).
  `sonah doctor` checks Node, your sign-in, one tiny model request and the code step's setting, with a fix for each
  problem.
- In your project, `sonah review` reviews the newest Claude Code or Codex session recorded there, helper agents
  included. `sonah sessions`, `--choose N` and `--repo DIR` pick another; a Cursor session is read when you pass its
  path.
- The default reviewer is `claude-sonnet-5-5[1m]` through your own `claude` login; `--backend codex-cli` and
  `--backend anthropic-api` are the alternatives.
- Before the first call a review says roughly how long it will take. Ctrl-C stops it and keeps its answers; the same
  command continues. A rerun reuses stored answers and asks only what is new or failed.
- `--format html --output FILE` writes and opens the page; `--format md` writes the same review as a short Markdown
  story.
- A count-only PR comment is off unless you ask for it, and is posted only after you confirm it.
- `sonah feedback` writes setup facts and counts, with no session text, for a bug report.
- If you used an early preview, [what changed for you](docs/INSTALL.md#if-you-used-an-early-preview) is at the end of
  the installation guide.

### Licence

- Sonah is source-available under the Business Source License 1.1: free for teams of up to three people using it, for
  non-profits and for a 30-day trial, with no licence key and no licence check. Every version becomes Apache-2.0 two
  years after it is first published. See [Pricing and licence](README.md#pricing-and-licence).

### Known limits

- A long session can take tens of minutes to review.
- A helper agent's work is reviewed only when its recording is found beside the parent's; a missing one is named.
- A file changed through the shell (`sed -i`, a heredoc) is recorded only as its command, so there is no edit of it to
  show or check.
- The code step reads files as they are on this computer now: a recording from another computer leaves it nothing to
  read. The page and the terminal say so; the exit code still follows the session review, unless you add
  `--code-pass`, which makes the code step's coverage count.
- A Cursor recording can omit tool outputs, so a review of it checks less. Windows has not been verified.
- A secret with no telling name and no known shape can get through the masking.
- The review can miss a decision or file it under the wrong heading: check the rows that matter to you against their
  evidence.
