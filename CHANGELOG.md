# Changelog

## 0.3.0-beta.6 (2026-10-22)

Sonah now reads a Claude Code session whole, even after a compaction, and puts what needs your action first. On every
review, Must act and Must know come right after the count line, before your prompt, and inside Must act the items where
two recorded quotes disagree come first. A long prompt is folded after them, with its counts in sight. When the .md must
be shortened for a GitHub comment, it cuts everything else first and the evidence of Must act and Must know last. The
title is the first words that you typed. A review that you stopped and resumed gives the cost of the whole review. And
the page reads as a review: what Sonah could not check moves into folds, with its counts.

Each compaction now shows among your messages, with how much of the agent's context it dropped, and files that Claude
Code restores after a compaction no longer read as files that you attached. A new kind of row from Claude Code no longer
makes a review incomplete when it cannot hold your session, and every review says what it cost. Commands, the page and
the files under `~/.sonah` can still change between betas.

To update, run `npm install -g getsonah@latest`. [Update](docs/INSTALL.md#update) gives the other ways. After you
update, Sonah asks the session review again for a session that opens on a compaction, and for a session that holds a
file that Claude Code restored after a compaction. It asks again for one part of a session that holds a row it now reads
by its structure. The page, the .md and the report model each have a new version.

### Must act comes first

- The page and the .md show Must act and Must know right after the count line, then your prompt, then Good to know,
  so the first Must act item is on the first screen, even on a long session.
- When your prompt holds more than 30 asks, the page and the .md fold it after Must act and Must know. Its heading keeps
  the count of each status, and every link to an ask still lands.
- When the .md must be shortened to fit a GitHub comment, it keeps the evidence of Must act and Must know last of all.
  First your long messages keep their start and Good to know's evidence folds are left out; then the table of your
  prompt keeps the asks that are not done, and the .md counts your messages instead of showing them; then the lists of
  What the agent did and What Sonah could not check keep their counts; then the code excerpts give way to their place,
  and Good to know to a count of each kind. An evidence fold is never printed empty.

### Must act leads with what the recording contradicts

- Inside Must act, the items where two recorded quotes disagree come first: a claim of the agent's that a recorded
  result, a file or your own words contradict; a statement that the agent wrote into a file and that a result
  contradicts; and an edit against your words. They come first also when a finding of the code review holds them. The
  asks that the agent did only in part, which rest on a part that Sonah did not find, follow. Nothing is dropped and no
  item changes section; the links on the first screen and the terminal's Must act labels follow the new order. With the
  code review, the level that it proposed still comes first.

### The title is your first words

- When your message opens with lines that are each one markup tag, such as the tags that wrap a paste, the title
  leaves them out, with what they wrap, and shows the words that you typed after them. When a message holds nothing
  but such wrapped text, the title comes from your next message with words of your own. Sonah reads the form of the
  line, never the tag's name.

### The page reads as a review, and what Sonah could not check is folded

- What Sonah could not check is said in the fold "What Sonah could not check", word for word and with its count, instead
  of on the first screen; each row's own reason is in that row's fold. Nothing is left out: open the fold to read it.
- The header's "Sonah did not check: …" line, the results that Sonah could not read an exit code or an end of, and
  "This does not mean that the work is correct." are the fold's first lines. The count line keeps "N not checked", and
  "Sonah found nothing for Must act or Must know." stays.
- A session whose earlier part Sonah could not read says "This session continues from an earlier part." beside the
  title; the fold says that Sonah did not read it.
- An ask row shows its status, and its own small fold holds why it is not checked, or that the session review cited
  only the agent's words for it. An item's evidence fold holds that Sonah could not find its quote, or could not check
  whether you asked for it.
- "Sonah checked only the marked parts of your message." is said once, in the page's legend, not under each message.
- The terminal no longer prints the "Coverage: …" and "Not covered: …" lines, or, on the "Code review: on" line, that
  Sonah does not yet see every edit of helper agents or scripts after a `cd`. Each is in the page's and the .md's fold,
  and a .md that Sonah shortens still lists every cause with its count.
  The exit codes do not change.

### A session continued after a compaction is read whole

- When a recording opens on a compaction, Sonah finds the earlier recording that it continues in the same folder, by the
  link that Claude Code writes on the compaction's first row, and reads the two as one session, in order. It repeats
  this for each earlier recording that also opens on a compaction, up to 16. A message that both recordings hold is read
  once, where you wrote it. The review of such a session now reads its earlier recordings too, so it reads more and
  takes longer.
- The terminal says how many earlier recordings the review reads, after the line that names the recording. The page
  and the .md say it beside the title.
- When Sonah cannot find the earlier recording, finds more than one that differ, or cannot read it, the review says so
  and why, under What Sonah could not check, and counts that part as missing from your messages. Before, it said
  nothing.
- The code review's window starts where the earliest recording starts.
- An earlier recording that is still being written is read too, such as the original of a session that you resumed
  in a new recording while the original still runs. Sonah reads it up to the compaction that the later recording
  continues, and only that part must not change while Sonah reads it.
- A recording that does not open on a compaction is read as before.

### Compactions are shown

- Each compaction of the agent's context shows among your messages, at its place, with how many tokens it dropped of
  how many, from what Claude Code recorded: "Compaction 1: Claude Code compacted the agent's context here and dropped
  956,238 of its 967,925 tokens."
- In the .md, the asks table is cut at each compaction, under one line "Before compaction N." above the asks that you
  gave before it.

### Restored files are not your attachments

- After a compaction, Claude Code attaches again the files of a message that the compaction kept. These are no longer
  said to be files that you attached, and they are no asks.

### A new kind of row from Claude Code no longer makes a review incomplete when it cannot hold your session

- Each Claude Code release adds rows that Sonah did not know, such as the session's budget in dollars (`budget_usd`).
  Before, each such row made the review say that the session evidence was incomplete and that a record has a form that
  Sonah cannot read. Now Sonah reads a row that it does not know by its structure, never by its name. A new row can
  hold the words, commands or results of your session if it has text with spaces, a value or a name longer than 64
  characters, a name with spaces, a message or a part of a message. Such a row still makes the review say that the
  session evidence is incomplete. A row with none of these is the harness's own context: Sonah counts it and the review
  stays complete.
- Sonah's record of each review counts each new kind of row that it read by structure, with the Claude Code version
  that wrote it.

### Every review says what it cost

- The usage line at the end of a review now gives the input tokens with their part written to and read from the cache,
  the list cost that the `claude` CLI states for the calls, and how far each usage limit of your plan moved from the
  first call that reported it to the last. When the code review runs, the line always gives its part of the calls,
  the tokens, the cost and the time.
- The report's footer says how many model calls the review made, how many of them the code review made, the tokens,
  the time and how far each usage limit moved. A review that you stopped and resumed gives these for the whole review,
  over its runs that made model calls with the same backend and model, not for its last run alone.
- Sonah keeps the same figures in its record of the review (`report.private.json`, as `instrument.usage`), as counts
  only. It also keeps what each run cost in `usage.private.json` beside it, for a run that stopped where you asked, was
  interrupted or failed too, so a review that you resume over several runs keeps the cost of each run.

## 0.3.0-beta.5 (2026-10-20)

The code review now reviews the session's own change as the change, in every git repository that the session wrote to,
and the other files that differ apart from it, marked outside the evaluated session. It lists the folders outside every
repository that the session wrote to, and says when edits by scripts or helper agents can be missing. It takes your asks
from the session review's list. When no code was reviewed, the first lines of every report say so and why, and so does
the pull request check. When a session ran shell commands, the reason no longer says that it wrote nothing, and
`--code-repo` points the code review at the repository that they changed. An ask that the session review could not check
still reads "Not checked", and now says when the code review found that it holds in the code. The header and the files
list count the same files, and Sonah says what it did not read one kind at a time. Sonah reads the row in which Claude
Code lists its deferred tools with their definitions (seen from Claude Code 2.1.295 on). Each line that the report shows
about an ask of the session review now says only what Sonah's checks show. A question of the code review points to
another part of the report only where code checked the link. A command that you run in Claude Code itself is no longer
an ask. Two decisions in one sentence are two items, and a failure that the agent passed over is in Must know whatever
its call. Commands, the page and the files under `~/.sonah` can still change between betas.

To update, run `npm install -g getsonah@latest`. [Update](docs/INSTALL.md#update) gives the other ways. After you
update, Sonah asks the code review again for a session that an earlier version reviewed. The session review's stored
answers stay, but Sonah asks the session review again for the part of a session that holds a command that you ran in
Claude Code itself, and for a session whose recording holds the row in which Claude Code lists its deferred tools with
their definitions.

### The code review reviews the session's own change

- With git, the change now holds only the files that a recorded write of the session could have changed, and the files
  whose last change came while the session ran. Before, it held every file that differs from the commit where the
  session started, so a repository that moved after the session gave the code review later work as the session's.
- Sonah names the other files on the page as files that changed outside the session's recorded writes: the first 10,
  then how many more. They are never part of the change. A file that a command of the session moved or deleted is among
  them, since its time does not place it in the session.
- A file that the session wrote and that changed again later still says so, as before.
- When the change holds no file, the page and the line `Sonah's review: …` that the review prints give the same
  reason: the recording shows no write of the session that could have changed a file, Sonah found no write that it can
  read but the session ran shell commands, no file that the session wrote differs in the working directory, or no file
  differs. The code review then does not run, and the page says neither where the change runs from nor that the code
  review proposed no finding.
- The dry run counts the files that Sonah leaves out of the change. It says that Sonah gives them to the code review
  only if there is room in its input.
- Those other files are now outside the evaluated session, and Sonah says so in those words wherever it names them.
  When the change holds a file to review, Sonah reads them too and gives them to the code review after the change and
  apart from it. When the review is too large, Sonah leaves them out first. Your session's change and its coverage
  lines stay as they are.
- A finding of the code review about such a file, and a question from one, says "It is about code outside the evaluated
  session." It never names your asks or the agent's claims, and it never marks a claim as contradicted by the code. An
  ask not met or a contradicted claim about such a file is withheld, and its row says why by its kind.
- A broken contract, a broken rule or a contradicted claim that a line of your session's change causes is your session's
  finding, even when it shows in such a file. It is not marked, and it keeps its link to your ask or the agent's claim.
  A finding whose only changed lines are in such files is marked and has no such link, and so is one that the code
  review's item-by-item check adds.
- When the check of a finding about such a file fails or its input is too large to send, the code review's coverage,
  what Sonah could not cover, the line `Sonah's review: …` and the exit code stay as they are. Before, they said that
  the code review did not cover all of the change and its checks. Sonah counts those checks apart.
- Sonah withholds a finding about such a file that is not about lines that a change touched, as it withholds one about
  the files of your session's change.
- The count line on the page, in the Markdown report and on the terminal counts these items, and marks them where it
  names them. The pull request comment counts these findings apart from your session's own. What the agent did lists the
  files apart, each marked. The code review's notes say what it saw of them.

### The code review reviews the session's change in every git repository that the session wrote to

- The change now also holds the files that the session wrote outside your working directory in a git repository: a
  sibling worktree or another repository, a repository inside yours, or elsewhere in your repository. Before, Sonah only
  counted these files, so a session whose work lay in another repository had no change to review.
- In another git repository, the change runs from the commit where that repository stood when the session started, by
  the same rule as in your working directory. As there, the change also holds a file there that no recorded write of
  the session touched when its last change came while the session ran. The other files that differ there are outside
  the evaluated session, as in your working directory: Sonah names them, and gives them to the code review apart from
  the change when there is room.
- Such a repository counts only when a file that the session wrote there is there now and differs from that commit. A
  repository where every file that the session wrote is gone, or has no difference, is only counted, and Sonah reads
  nothing in it. A repository inside your working directory follows the rule of your own repository: a file that the
  session wrote there is part of the change when it differs from that commit, a deleted one too, and a file with no
  difference is not counted as a path that the code review could not read.
- A file that the session wrote in a folder that no git repository holds, such as a notes folder or a temporary folder,
  is not reviewed. The page and the dry run list each such folder with how many files the session wrote there. These
  files do not change the code review's coverage, and its agents do not read those folders.
- A path that a shell command wrote and that holds a shell variable or command substitution as recorded, such as
  `cat > "$DIR/notes.md"`, names no file that Sonah can find. It is not a file of the change, it never makes a
  repository part of the change, and Sonah counts it apart (see "The header and the files list count the same files").
- When the session ran a shell command, the page, the Markdown report and the line that Sonah prints before the review
  say: "Sonah does not yet see every edit made by helper agents or by scripts after a cd. The change can miss some of
  them." A hand-off to a helper agent alone does not make Sonah say it.
- Two spellings of one file outside your working directory, such as `/tmp/x` and `/private/tmp/x` on macOS, are one
  file.
- The code review and its checks can read each repository that holds a file of the change, and nothing more. A file in
  Claude Code's or Codex's own folders or in Sonah's own folders, or a file named from your home folder (`~/…`), is
  still only counted.
- The page shows the files of your working folder's repository first, then each other repository's, those with more
  files first. It says where the change runs from in each, how many files lie in each, and where each file of the list
  lies. The header counts the repositories when there is more than one.
- The dry run names each of these repositories, how many paths lie in it and how many files of the change it holds. It
  says which of them the code review reads right after them, and then lists the folders that it does not review.
- Sonah reads only the repositories that hold a file of the change, so work that someone else does in another one
  during the review does not read as a change of what the code review read.
- The line that Sonah prints before the review says how many other folders the code review reads. The dry run counts a
  repository inside your working directory as read. When no git repository holds your working directory, the line and
  the dry run say that the code review reads your working directory.
- Sonah does not follow a link that git lists out of your working directory or out of another repository. A file under
  your working directory in a folder that Sonah cannot open is named as not readable again, as before.
- When the code review or a check names a file of another repository by its path from that repository's top folder,
  such as `docs/INSTALL.md`, Sonah now reads that repository's file and checks the quote there. Before, it looked for
  the path in your working directory, so it withheld a real finding and dropped the notes on those files. A path that
  names a file in more than one repository of the change names none of them: Sonah withholds a finding that cites it,
  says why, and asks the code review once to name the file by its full path.

### The code review takes your asks from the session review

- Sonah now shows the code review your messages as messages, and then your asks as the session review lists them, each
  by its key. Before, it showed your messages as what you asked, so text that a message only quotes, such as data or an
  example, could read as an ask.
- The checks of the code review's findings and questions, and its item-by-item check, get the same list. A check still
  sees no words of the agent's, and neither does the check of a finding that the item-by-item check adds.
- The code review names an ask by its key when a finding or a question is about it.
- Every saved code review asks again, because its input changed. The session review's stored answers stay.

### Each line about an ask says what Sonah checked

- An ask that the session review tied only to the agent's words now says so, and no more: "The session review cited
  the agent's words as what does it, not a recorded result or change." Before, it also said that Sonah found no
  recorded result or change for the ask. Sonah never searched for one, and the recording can hold one.
- The header counts these asks in the same words.
- An ask that the session review did not check, where its part of the recording holds the end, now says: "The session
  review did not check whether the agent did this ask: it cited nothing that does it." Before, it said that the session
  review found nothing that does the ask before the recording ended. The agent can still have done it.
- An ask that an agent wrote into a helper's brief is now named so. Before, the page said that Sonah could not read
  such asks. Sonah read them. They are not your asks, so your prompt does not list them.
- Sonah says that it could not read an ask only when the ask's record has no form that Sonah reads. Of any other ask
  that your prompt does not list, it says that it could not place the ask among the asks of your prompt.

### A question of the code review points only where code checked the link

- A question now names an item or an ask only when the question and that part name one place: the same recorded
  event, such as a message or an edit, or the same file. Before, a question could point to an unrelated item. One long
  session's page pointed a question about the write permissions of one file to a decision about another file.
- The line beside an ask that names a question follows the same rule.
- A question with no recorded place names no other part of the report.
- A question now puts the item it names in a higher tier only when code checked the link. Before, a question with no
  recorded place could move a decision on how to do your ask from Good to know to Must know. That item then named the
  question, but the question named no item.
- None of the changes in this section changes a request to a model.

### The first lines say when no code was reviewed

- When the code review read no code, the first lines of the page, of the Markdown report, of the pull request comment
  and of the terminal output now say "No code was reviewed." and give one reason. The reasons: the review ran without
  the code review; the code review needs Claude Code; Sonah could not read the session's working directory; the
  recording shows no write that could have changed a file; Sonah found no write that it can read, but the session ran
  shell commands; Sonah found no changed file in the folder, or none that the session wrote; Sonah could show the code
  review no changed lines; its input was too large to send; it did not answer; it saw none of the files of the change;
  or the review was saved by an earlier version of Sonah, which did not record why. The page and the terminal also name
  the folder that Sonah looked in, by its full path. The Markdown report is meant for a pull request, so it names only
  the folder's name, and your home folder itself as `~`. It never names the path of your home folder or your user name
  there. The pull request comment names no folder.
- Before, a session whose code review had no change to review showed nothing about it on the first screen. The
  terminal said "Sonah's review: complete" and "code pass complete". Now it says "Sonah's review: complete, but no code
  was reviewed" and "code pass reviewed no code". The pull request check's title says "Sonah finished its advisory
  review, but no code was reviewed".
- Every one of these places decides it the same way. A pull request review of the earlier kind, which reviewed the
  code of the pull request itself, says none of it.

### Point the code review at a repository with `--code-repo`

- `sonah review --code-repo DIR` reads the git repository that holds `DIR` as if the session had written there. Give it
  once for each repository. It is for a session that changed a repository with no write that Sonah sees: a script, a
  write after a `cd`, or a session that started in a folder that no git repository holds.
- In that repository, the change runs from the commit where it stood when the session started, by the same rule as
  in your working directory. It holds the files that a recorded write could have changed there and the files whose
  last change came while the session ran, each marked as written by no recorded edit. The other files that differ
  there are outside the evaluated session. The code review and its checks read that folder too.
- The page and the Markdown report name each repository that you gave with its count of files, none included. When you
  give the repository that holds the working directory, they say so: Sonah reads it by the working directory's own rule.
- When no code was reviewed after all, the reason says what Sonah found in the repositories that you gave, and does not
  tell you to give them again.
- A folder that is not there, or that no git repository holds, stops the review before anything is read or sent:
  `code_repo_not_found`, `code_repo_not_git`. Without `--code-repo`, the review reads and sends what it did before.

### An ask that the code review found to hold in the code says so

- When the session review could not check an ask in the recording, and the code review's item-by-item check found in
  the code that it holds, the ask's row now says so after the session review's reason: "The code review found that it
  holds in the code (Sonah found its quote word for word at `path:line`). Sonah did not check whether it holds." The
  places are the lines where Sonah found each quote of that check word for word in the files as they are now. It shows
  with `--code-repo`, where the session review never sees what a script wrote.
- The ask still reads "Not checked", and every count is as before: the header's "Sonah did not check", the count line
  and the heading of your prompt, the count under What Sonah could not check and the pull request comment count it as
  not checked. No check of Sonah's tests the code review's verdict, and the code can do an ask that the agent did not do
  in this session.
- Only an ask that no check of Sonah's speaks against gets the note: the session review found nothing in the recording
  that settles it, or Sonah did not find the evidence that it cited word for word, or not after your ask. An ask whose
  cited run or write did not run to its end (or whose end Sonah could not read), whose status Sonah's own check refuted
  or did not settle, or whose missing part Sonah did not find gets no note, whatever the code review says. Neither does
  an ask for which the code review quoted the files as they were at the session's start commit.
- An ask that the code review says does not hold, or that it ties to a finding, a question or a withheld finding, reads
  as before. So does every other ask, and every report whose code review left no such verdict.

### A session that changed files only through a script is not said to have written nothing

- When the recording shows no write that could have changed a file but the session ran shell commands, the reason is
  now "Sonah found no write of the session that it can read. The session ran shell commands, and Sonah does not yet see
  what a script writes. Check each repository that they could change, with git status and git diff. To review that
  code, run sonah review again with --code-repo <the repository's folder>." Before, it said
  that the recording shows no write of the session that could have changed a file, so a session whose script changed
  files in another repository read as one that changed nothing. Every place that says the reason says this one: the
  page, the Markdown report, the terminal, the pull request comment and the pull request check.
- Sonah still does not see what a script writes, or a write after a `cd`, so the code review does not review those
  files unless you give their repository with `--code-repo` (below). Running the review from another folder does not
  change this: the code review reads the folder that the recording names.
- In that case, "What the agent did" no longer says "0 files" or "Sonah found no file in the repository that the agent
  changed". It says that Sonah found no write of the agent that it can read, and that Sonah does not yet see what a
  script writes. When the code review ran and found that no git repository holds the working directory, an empty files
  list says "in the working directory", not "in the repository". When the code review did not run (it was off, the
  reviewer was not `claude`, or Sonah could not read the working directory), Sonah did not look for a repository there,
  and an empty files list still says "Sonah found no file in the repository that the agent changed", as before.
- The coverage line that a session review prints no longer starts with "code missing". That part named the code review
  of a pull request of the earlier kind, which a session review never has, so it read as a contradiction of "code pass
  complete" on the same line. A pull request review of the earlier kind still shows it.
- `docs/TROUBLESHOOTING.md` no longer says "Nothing to review" for a session that ran shell commands, and no longer
  tells you to run the review from another folder.

### Claude Code's list of deferred tools is read when it holds their definitions

- Claude Code can write its list of deferred tools with one more part, the definitions of the tools that it names (seen
  from Claude Code 2.1.295 on). Sonah did not know that part, so it read no row of that kind. A review of a recording
  with such a row said that the session evidence was incomplete and that a record has a form that Sonah cannot read,
  and a decision could show "Sonah could not check whether you asked for this". Sonah now reads that row as the
  harness's own context, as it reads the rest of the list. It reads nothing in the new part.
- Sonah still does not read every row that a recent Claude Code writes. A row of another form that Sonah does not read
  yet, such as the session's budget in dollars (`budget_usd`), still makes a review say that the session evidence is
  incomplete and how many records have a form that Sonah cannot read.

### The header and the files list count the same files

- The number of files in the header now comes from the list that "What the agent did" shows. With git it is git's list
  of the change. Without git it is the session's writes in the folder of the review. Before, a session whose change held
  no file could show "15 files changed" in the header and no file in the list.
- When that list is empty, the header shows no file count.
- A path that the agent wrote with a shell command and that holds a shell variable or the output of a command as
  recorded (such as `$P/run.sh`) is no longer a file of the change. Sonah cannot tell where it is. "What the agent did"
  names these paths apart and counts them. The code review does not get them, and still counts them as writes of the
  session.
- The recording keeps such a path without the command's quotes. So when the path, spelled as recorded, names a file or
  folder that is there (a relative path in the session's working folder, an absolute path where it points), such as a
  route file `app/routes/users.$id.tsx` that a shell command wrote, it is a file of the change. So is such a file that
  the session deleted, when git lists it as changed since the commit the session started from. A path that a file tool
  wrote is taken as spelled, even with a `$` in its name. When the code review is off, Sonah does not look for such
  files, and the path is counted apart.
- A path named from your home folder (`~/notes.md`, `$HOME/notes.md`) is counted among the files that the agent changed
  outside the repository, also when the code review is off. It is never a file of the change.

### Sonah says what it did not read one kind at a time

- The line "N parts of the evidence that Sonah read are incomplete" added up things of different kinds, such as lines of
  a workflow's journal and entries of its folder, and said "read" for things that Sonah did not read. It is now one line
  for each kind, with one count: workflow runs that Sonah did not read with the recordings of their agents, other
  entries of workflow run folders, workflow calls with no launch recorded, helper recordings that Sonah read only in
  part, calls whose recorded input Sonah holds only in part, and calls of the agent's code cells that no recorded item
  accounts for. Any other kind is counted by kind: "Sonah holds N kinds of evidence only in part".
- None of the changes in this section changes a request to a model.

### A command that you run in Claude Code itself is not an ask

- Sonah no longer lists a local command, such as `/model` or `/agents-info`, as an ask. Claude Code runs such a
  command itself, and the command sends nothing to the agent. Claude Code 2.1.295 marks some of these commands as your
  messages. Before, your prompt showed them as asks that Sonah did not check.
- Sonah finds such a command by the note that Claude Code writes before it and the output that Claude Code writes
  after it. Sonah never reads the name of the command.
- A slash command that sends a prompt to the agent is still an ask. A message that you send while the agent works is
  still an ask too.
- For a session with such a command, Sonah asks the session review again for the part that holds the command.

### Two decisions in one sentence are two items, and a failure passed over is in Must know

- When the agent states two decisions in one sentence, the report now shows each decision as an item of its own, in
  its own tier. Before, the report showed the shorter decision folded inside the item of the longer one.
- A failure that the agent passed over is now in Must know whatever its call. Before, a read that the recording marks
  as refused before it ran went to Good to know. The code review can still move such an item, as before.
- Neither change changes a request to a model. Every saved code review asks again once, because the table of tiers
  that its stored answers rest on changed.

### Versions

- These versions move: `sonah.session-page/44`, `sonah.session-story/39`, `sonah.report-model/5`,
  `sonah.code-snapshot/13`, `sonah.code-pass/13`, `sonah.code-verify/4`, `sonah.code-account/2` and `sonah.tiers/3`.
  Each moves once from 0.3.0-beta.4.

## 0.3.0-beta.4

The code review now runs on long sessions too, and the page says exactly what it saw. It gets the changed files
whole. Its one repair loses no finding. A code finding shows what it rests on, the code review accounts for each ask,
and one point is one item. Commands, the page and the files under `~/.sonah` can still change between betas.

To update, run `npm install -g getsonah@latest`. [Update](docs/INSTALL.md#update) gives the other ways. After you
update, Sonah asks the code review again for a session that an earlier version reviewed. The session review's stored
answers stay.

### The code review fits its input, and says what it saw

- Sonah now builds the code review's input within one size bound. Before, Sonah dropped the review when a long
  session's input was too large.
- Sonah lists each command once, numbered. Before, it repeated every command for each changed file.
- Each changed file names the first command after its last edit.
- Sonah shows rule and skill files whole. It no longer cuts out their middle.
- Sonah cuts no text inside a line. A long command or output shows its first and last lines, with their numbers.
- When the input is still too large, Sonah leaves out whole parts. It leaves out the lines the session read first,
  then the whole files.
- Then it leaves out early commands, then large file changes, then large rule files.
- The input names each part that Sonah leaves out. The code review can read a file that Sonah left out.
- Sonah skips the code review only when even the smallest input is too large. The page then says that its input was
  too large to send.
- The page never says that the code review saw a file when Sonah did not send it the input.
- Sonah now keeps which lines of which files the code review read. It keeps paths and numbers, never text.
- Saved answers keep this record, so a review that Sonah reuses shows it too.
- The page names each file that the code review saw only in part, with its lines. It also names each file that the
  code review saw only where the change touched it.
- The page lists a file that the code review read whole nowhere. Seeing a file does not mean that the file is fine.
- The page names rule and skill files that the code review saw only in part or did not see.
- Sonah marks the code review complete only when the review saw every changed line, on both sides of the change.
  A read shows a file as it is now, never as it was before. So a changed file whose changes Sonah left out keeps the
  review short of complete, even when the review reads it whole. A new file counts once the review reads its lines.
- When the code review read a changed file whole, but Sonah did not show it how the file was before, the page says
  so. It does not count that file's change as seen.
- Sonah keeps the path of every file that the code review read. When Sonah cannot tell which lines it read, the page
  says so. It never calls that file unseen.
- A read that failed or that Claude Code refused read nothing. Sonah keeps it apart, with its path and why. The page
  counts its file as one that the code review did not see, and never says that the review read it.
- Sonah counts where the code review's quotes sit: in lines that it saw, or outside them. Sonah counts a quote apart
  when it cannot tell which lines of that file the code review read. The count goes to the private record, not to
  the page.
- The terminal says that a code review too large to send did not run.
- Every saved code review asks again, because its input changed.

### The code review sees the code around the change

- Sonah now shows the code review each changed file whole, and the lines the session read in unchanged files.
- It names each changed file that does not fit, with its line count.
- It shows a changed file whole when the whole file fits, even if its changes do not fit.
- When Sonah shows no line that the session read, it says why. It never says that the session read nothing.
- The code review's instructions say which changed files it must open itself.
- A rule file that the session read from a parent folder does not show twice.
- When the input is too large, the whole files and the session's reads give way first. Then the code review gets the
  same input as with this off.
- So they never cost the code review a part that it gets with this off. They never make it too large to send.
- This is on by default. The code review's input is larger, so a review costs more.
- On one long session, the code step made 13 calls with 3.4 MB of input. With this off, it made 6 calls with 1.2 MB.
- A measure on new sessions will still decide whether it stays on.

### The code review's repair loses nothing

- The code review gets one repair of its answer. Sonah now matches each item of the repair by what it is, not by its
  place or its order.
- Two findings match when they have the same kind and file, and their lines overlap. Two questions match when they
  have the same words about the same item.
- An item of the repair takes the place of a failed item only when each matches only the other. Otherwise Sonah does
  not choose one.
- Each item of either answer now ends in one place. It stays, the repair replaces it, it folds into an item that it
  matches, or Sonah withholds it.
- A finding or question that only the repair found now goes to its checker like any other. Before, Sonah dropped it
  unchecked.
- The repair's copy of an item of the first answer that stands folds into that item. Sonah never publishes the copy
  beside it.
- Two failed findings of one kind can have lines that overlap. When the repair fixes both, Sonah checks both fixes. It
  can publish both, as for a first answer. Before, it published one.
- A note of the repair applies only to the item that the repair wrote it for. The note of a failed item applies to a
  fix only when each of the two matches only the other.
- A finding that only the repair found goes to the default section of its kind.
- A question in other words is a new question. The report can then show both questions.
- When Sonah withholds an item, it says whether an item of the repair matched it. The words say only what Sonah
  compared.
- Sometimes Sonah cannot compare an item, because its lines are not all lines of the file. Then the words say so.
- A report that an earlier version wrote keeps its words about the repair.
- The cause for an item past its list's limit now names the list, not only a text.
- This closes a known limit of 0.3.0-beta.2. A repair that dropped a failed item no longer loses that item. The next
  item no longer shows twice.
- This rule alone changes no request to the code review.
- The checks of the items that only the repair found are new calls. A new run pays for them.

### The code review's coverage lines add up

- Every count about the files of the change now comes from one tally. The coverage line, the footer, the header's
  count and the record all read it, so the parts add up to the whole.
- The coverage line now says how many files the code review saw whole, in part, or only where the change touched
  them, and how many it did not see. Before, a deleted file could be counted twice, and some files in no group.
- A file that the session wrote whole, and that Sonah showed only where a later edit touched it, is now seen in part,
  with its lines. Before, the page said that the review saw it only where the change touched it.
- Sonah sometimes shows the review an edit that it cannot place in the file now. Such a file now reads as seen in
  lines that Sonah could not number. Before, the page said that the review did not see it.
- A file that the session wrote in another repository is now named so. A helper can work in another folder and write
  into your working folder. Such a file is now named and counted too. Before, the page said that both lay outside the
  repository and did not count them as files that the code review did not see.
- Only writes outside every folder that the code review can read are now only counted.
- Sonah names files that it left out of the input for room as left out for room. It no longer says that they were too
  large. A file that is too large on its own keeps its own words.
- With git, when Sonah finds no recorded edit of the session that wrote some files of the change, the page says so,
  and that the change can hold work done after the session.
- The page no longer says that the change is the one the session made.
- The page says how many of the open questions were checked. It no longer says "each" when one was not checked.
- The private record now gives each file the state that the input shows. Its count of files that the code review
  could not read is the tally's.
- The code review's checks can read files that the code review did not see. The coverage line now says how many, and
  that Sonah counts as seen only what it sent the code review and what the code review read itself. The first lines
  say it too: "56 files of the change that the code review did not see (its checks read 8 of them)". Before, one long
  session's page said only that the code review did not see 56 files, though its checks had read 8 of them.
- The page's first lines now count the same files as the coverage line. They say "a change of 110 files" and "56 files
  of the change that the code review did not see". Before, one long session's page said "56 files changed". It also
  said that the code review did not see 56 changed files, of 110.
- With git, the first lines no longer say that the recording changed the files of the change. The change runs from
  the commit where the session started, so it can hold other work.
- The first lines give the lines of the change only when Sonah holds the lines of every file.
- The list of files that the agent changed is now the same list. The page says apart the writes that Sonah counts but
  did not review. Before, the page said that the agent changed them outside the repository, though some lay in your
  working folder.
- The page no longer says that a write in an agent's home folder lies outside what the code review reads. That
  folder can be in your working folder.
- When the code review's call did not answer, the page no longer says that it saw any file. It says that Sonah counts
  none of them as seen.
- A file whose change is too large for the input on its own is now said to be too large. Before, the page said that
  Sonah left it out for room.
- When the records show no check of the open questions, the page now says that Sonah publishes them unchecked.
  Before, it said "checked 0 of the 1 open questions".
- The page says how the code review works only when the code review read what Sonah sent it. Before, the page said
  that the code review read the change, even beside the line that says that it did not answer, or that its input was
  too large to send.
- The page no longer says that the code review read the change, or that Sonah reviewed it. It says that the code
  review read what Sonah sent it. The coverage line says how much of the change it saw.
- A report from 0.3.0-beta.1 or earlier no longer says how the code review works. That code review worked another way.
- This changes no request to the model. Stored answers still replay.

### A code finding shows what it rests on

- The check of a code finding now lists what the finding rests on, with up to six premises.
- For each premise, the check names where its evidence is: lines of the repository, documented language behaviour, or
  neither.
- Sonah shows a finding as checked only when its check quotes lines or names language behaviour for each premise.
- For a premise that names lines, the check quotes at least one. Sonah must find each quote word for word.
- When the check names anything else for a premise, the finding is now an item to verify. Sonah never shows it as
  checked.
- Its item names each premise that Sonah could not check, in the check's own words.
- An item to verify goes to Good to know. The code review can raise it to Must know, never to Must act.
- An item to verify never changes the status of your ask. Your ask shows a line that names the item.
- Sonah asks once more when a check leaves out its premises, or quotes a line that Sonah cannot find.
- Every reader works out the label again from the saved check. A finding never shows as checked without its premises.
- A finding that no longer shows as checked also stops contradicting a claim or counting against an ask.
- The page shows each premise of a checked finding beside the lines that its check quotes.
- The page no longer says that a second reviewer checked a finding. The same model reviews the code and checks it.
- Every saved check of a code finding asks again, because its request changed.

### The code review accounts for each ask

- After the code review, Sonah asks it for an item-by-item check of each ask of the session review. These are your
  asks, and the asks that an agent wrote into a helper's brief.
- This check also covers each statement that the agent wrote into a file, and each decision not to act. It covers
  no other claim or decision.
- For each item, the code review answers breaks, holds, outside the repository, or not examined.
- Each answer except not examined must quote the code. Sonah finds each quote word for word, or does not count it.
- A break names a finding or question of the code review, or brings a finding of its own.
- Sonah checks such a new finding like any other finding.
- When this check repeats a finding that Sonah withheld, Sonah withholds it once, not again.
- Sonah sends at most 30 items in one call, and at most 4 calls in one review. The asks go first.
- The page counts the items that this check did not examine in a way that Sonah could use.
- It counts these asks by whose words each one rests on. Sonah reads that from the recorded message that the ask
  cites, never from its words.
- It calls an ask yours only when it rests on your own words: your message, or a project file that you wrote.
- An ask that an agent wrote into a helper's brief is counted as such. Sonah counts any other ask, or one whose source
  it cannot read, as one that it could not trace to your own words. Before, one long session's page said "3 of your
  asks" of three asks that the agent wrote into a helper's brief.
- The count says nothing about the code review's findings. A published finding can still concern a counted item.
- The page counts the items past the limit of 4 calls too, so the limit hides nothing.
- The page never lists or counts the items that the code review examined. Those stay in the private report.
- While any item is counted, the code review shows as not complete.
- Sometimes only counted items keep the code review from being complete. Then the page does not say that the code
  review did not finish its work, because every call can have answered. The terminal says that the code review
  covered the whole change, but that its item-by-item check did not examine every item in a way that Sonah could use.
- When the code review did not finish every part of its work, the page now says only that. It no longer says that
  the list below shows what the code review did not cover, because that list can also hold these counts.
- With --code-pass on the command line, a counted item keeps the review incomplete. Sonah then exits with code 1.
- A review with more than 120 items always ends this way, because of the limit of 4 calls.
- By default, and with the setting, the code review never changes the exit code.
- Sometimes an answer says that an ask holds, but a published finding breaks it. Then Sonah drops that answer and
  keeps the finding.
- These calls are new, so a new run pays for them.
- The terminal says how many calls this check adds. It names the three kinds of items.

### One point, one item

- A question of the code review about an item, such as a decision of the agent's, now shows inside that item when
  the two name one place. Before, it was an item of its own.
- One place is a recorded message or edit, or a file, that both name. When both name lines of one file, the lines
  must overlap.
- A question whose quote Sonah found only in the session review's words about the item names no place. It stays an
  item of its own. Before this rule, one long session's page folded a question about one file inside a decision about
  another file.
- The item that a question joins is never in a lower section than the question.
- It keeps its own lines there: its question, its impact, its action and its check.
- The item goes to the higher section of the two. A question in a lower section shows folded, with its own section's
  name.
- A question about an ask stays its own item, as before. Your prompt still points to it.
- Two decisions that quote the same message, one quote inside the other, are now one item. The longer quote leads.
- The shorter one shows folded inside that item. Sonah drops neither.
- Inside each section, the items that the code review rated come first, highest first. Then come the items with no
  rating, by kind as before.
- The agent may pass over a read that the recording marks as refused before it ran. Sonah now puts such a read in Good
  to know.
- A refused shell command and a refused write stay in Must know. A decision not to act stays in Must know.
- The code review can still move each of these items, as before.
- None of this changes a request to a model.

### Known limits

- The known limits of 0.3.0-beta.3 below still hold, except the first. This version fixes it. On a long session, the
  code review now runs, unless even its smallest input is too large. The page names a file of the change as seen only
  when the code review saw it. This version also fixes the repair limit of 0.3.0-beta.2: a repair no longer drops a
  failed item from the report.
- Sometimes the repair fixes the lines, the file or the words that Sonah matches items by. Then Sonah cannot match
  the fix to the item that failed.
- Sometimes one fix of the repair matches two failed items, or two fixes match one failed item. Then Sonah matches
  none of them.
- In both cases, Sonah publishes the fix as a new item and withholds the item that failed. The report shows both.
- The fix gets no note from the review, so it goes to the default section of its kind.
- The repair's copy of an item that already stands can move to lines apart. Then Sonah checks that copy as a new item.
  The report can show both.
- A file that a helper wrote in your working folder while it worked in another folder is named and counted, but Sonah
  does not give it to the code review.
- With git, the list of files that the agent changed still holds every file of the change. It can hold files that no
  recorded edit of the session wrote. The code review's section says how many.
- A check can leave out a premise, or quote a line that does not show its premise. Sonah cannot tell.
- A check can call a compiler's behaviour documented behaviour of the language. Sonah cannot check that either.
- A finding that rested on the compiler was folded before. Now it shows as an item to verify.
- The code review can say that an item holds after a short look. Sonah cannot tell.
- Sonah does not yet ask the code review to trace the run that an ask rests on. So the item-by-item check can say
  that such an ask holds without a trace of its run.
- A quote from a path over 300 characters fails that call's whole answer. Its items then count as unchecked.
- The code review can write one point as a finding and as a question. The report still shows both as items.

### Versions

- These versions move: `sonah.session-page/43`, `sonah.session-story/38`, `sonah.report-model/4`,
  `sonah.code-snapshot/12`, `sonah.code-pass/12`, `sonah.code-verify/3`, `sonah.review-agent-transport/2` and
  `sonah.tiers/2`.
- This version adds `sonah.code-account/1`.

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
