// D143: the commit-to-session link's hook. `sonah hook add` turns on a prepare-commit-msg hook that appends
// `Agent-Session: <id>` to a commit that Claude Code's agent makes, the id in that command's environment
// (CLAUDE_CODE_SESSION_ID). Two rules hold: a message changes only by Agent-Session lines added at its end, byte for byte
// (each case commits the same message once with no hook and once with Sonah's, and compares), and Sonah never breaks a
// commit or another tool's hook. These tests run real git commits in throwaway repositories, under a folder whose name
// holds a space, with a sealed environment (no global or system git config, no harness variable unless a case sets one):
// git's own commit flows, the comment and cleanup modes, the coexistence with another tool's hook, core.hooksPath,
// husky's folder, a linked worktree, a linked hooks folder, and the files lefthook and pre-commit leave (their layouts,
// made by hand: neither tool is needed to run these tests). No recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile }
  from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_SESSION_RUNNER, AGENT_SESSION_SCRIPT, HOOK_LINE, HOOK_WORDS, LEFTHOOK_HOOK_CALL, LEFTHOOK_RUN,
  PRE_COMMIT_HOOK_ID, PRE_COMMIT_STEPS, commitLinkFacts, commitLinkStatus, lefthookLines, runHookCommand }
  from '../src/agent-session-hook.js';
import { COMMIT_LINK_ROUTES, COMMIT_LINK_STATES, HOOK_PROBLEMS } from '../../evidence/src/ledger.js';
import { commitLinkLine, doctor } from '../src/doctor.js';

const exec = promisify(execFile);
const S1 = '11111111-2222-4333-8444-555555555555';
const S2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const S3 = '33333333-3333-4333-8333-333333333333';
const CX = '01a091c7-46e5-7032-8000-000000000001';

/** The environment of every git call: the caller's PATH and nothing of its git, harness or user configuration. */
function sealedEnv(home) {
  const keep = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(?:GIT_|CLAUDE_CODE_|CODEX_|SHELLOPTS$)/.test(k)));
  return { ...keep, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1', LANG: 'C', LC_ALL: 'C',
    GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic',
    GIT_COMMITTER_EMAIL: 's@example.invalid', GIT_EDITOR: 'false', GIT_SEQUENCE_EDITOR: 'false' };
}

async function sandbox(t, { template = null } = {}) {
  // A space in every path: the hook's arguments and the runner's line must hold it.
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sonah d143 ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  await mkdir(home);
  const repo = join(root, 'my repo');
  const env = sealedEnv(home);
  const gitIn = async (dir, args, extra = {}) => {
    const r = spawnSync('git', args, { cwd: dir, env: { ...env, ...extra }, encoding: 'utf8' });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const g = async (args, extra = {}, dir = repo) => {
    const r = await gitIn(dir, args, extra);
    assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  /** The git runner the command uses, sealed the same way. */
  const sealedGit = async (dir, args) => {
    try { return (await exec('git', ['-C', dir, ...args], { env })).stdout; } catch { return null; }
  };
  const hook = async (argv, cwd = repo) => {
    let out = '', err = '';
    const code = await runHookCommand(argv, { cwd, git: sealedGit,
      stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { err += s; } } });
    return { code, out, err };
  };
  await mkdir(repo);
  await g(['init', '-q', '-b', 'main', ...(template ? [`--template=${template}`] : [])]);
  await writeFile(join(repo, 'a.txt'), 'a\n');
  await g(['add', 'a.txt']);
  await g(['commit', '-q', '-m', 'base']);
  const put = async (name, text) => { await writeFile(join(repo, name), text); await g(['add', name]); };
  /** A commit's message exactly as stored (`git log --format=%B` adds a line of its own). */
  const message = async (rev = 'HEAD', dir = repo) => {
    const raw = await g(['cat-file', 'commit', rev], {}, dir);
    return raw.slice(raw.indexOf('\n\n') + 2);
  };
  /** The ids git reads back as trailers of one commit. */
  const ids = async (rev = 'HEAD', dir = repo) => {
    const v = (await g(['log', '-1', '--format=%(trailers:key=Agent-Session,valueonly,separator=%x2C)', rev], {}, dir)).trim();
    return v ? v.split(',') : [];
  };
  const agent = (id) => ({ CLAUDE_CODE_SESSION_ID: id });
  /** One empty commit with no hook (core.hooksPath=/dev/null), then the same with Sonah's: both stored messages. */
  const twice = async (args, extra = {}) => {
    await g(['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--allow-empty', ...args], extra);
    const base = await message();
    await g(['commit', '-q', '--allow-empty', ...args], extra);
    return { base, stamped: await message() };
  };
  return { root, home, repo, env, g, gitIn, hook, put, message, ids, agent, sealedGit, twice };
}

/** The stamped message is the message stored without the hook, byte for byte, then only Agent-Session lines. */
function onlyAppended({ base, stamped }, expectedIds, label = '') {
  assert.ok(stamped.startsWith(base), `${label}: the message before the end is unchanged:\n${JSON.stringify(base)}\n`
    + `${JSON.stringify(stamped)}`);
  const rest = stamped.slice(base.length);
  assert.match(rest, /^\n{0,2}(?:Agent-Session: [0-9a-f-]{36}\n)*$/, `${label}: only Agent-Session lines were added: `
    + JSON.stringify(rest));
  assert.deepEqual([...rest.matchAll(/Agent-Session: ([0-9a-f-]{36})/g)].map((m) => m[1]), expectedIds, label);
}

test('hook add writes the script and the runner, and the closed vocabularies hold', async (t) => {
  const s = await sandbox(t);
  const r = await s.hook(['add']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.err, '');
  const hooks = join(s.repo, '.git', 'hooks', 'prepare-commit-msg');
  const script = join(s.repo, '.git', 'sonah', 'agent-session.sh');
  assert.equal(await readFile(hooks, 'utf8'), AGENT_SESSION_RUNNER);
  assert.equal(await readFile(script, 'utf8'), AGENT_SESSION_SCRIPT);
  assert.ok(((await stat(hooks)).mode & 0o111) !== 0, 'the runner is executable');
  assert.ok(r.out.includes(HOOK_WORDS.turnedOn(hooks)));
  assert.ok([HOOK_WORDS.optIn, HOOK_WORDS.publicLine, HOOK_WORDS.stopIt].every((w) => r.out.includes(w)), 'the opt-in words');
  assert.ok(!r.out.includes(HOOK_WORDS.optInOnce));
  const facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.deepEqual([facts.state, facts.route], ['on', 'runner']);
  assert.equal(commitLinkStatus(facts).line, HOOK_WORDS.status.on.runner);
  const again = await s.hook(['add']);
  assert.equal(again.code, 0);
  assert.ok(again.out.startsWith(HOOK_WORDS.alreadyOn));
  assert.equal(await readFile(hooks, 'utf8'), AGENT_SESSION_RUNNER);
  assert.deepEqual(COMMIT_LINK_STATES, ['off', 'on', 'moved', 'not_run', 'not_checked']);
  assert.deepEqual(COMMIT_LINK_ROUTES, ['runner', 'pre-commit']);
  assert.deepEqual(HOOK_PROBLEMS, ['hook_not_git', 'hook_bare_repository', 'hook_file_foreign', 'hook_path_link']);
  assert.deepEqual(Object.keys(HOOK_WORDS.status.on), COMMIT_LINK_ROUTES, 'each route has its words');
  assert.deepEqual(Object.keys(HOOK_WORDS.problems), HOOK_PROBLEMS, 'each problem has its words');
});

test('the hook cases: what git does with each commit flow', async (t) => {
  const s = await sandbox(t);
  assert.equal((await s.hook(['add'])).code, 0);
  // 1: a plain message.
  await s.put('b.txt', '1\n');
  await s.g(['commit', '-q', '-m', 'first'], s.agent(S1));
  assert.equal(await s.message(), `first\n\nAgent-Session: ${S1}\n`);
  assert.deepEqual(await s.ids(), [S1]);
  // 2: a subject that looks like a trailer stays the subject.
  await s.put('b.txt', '2\n');
  await s.g(['commit', '-q', '-m', 'fix: the bug'], s.agent(S1));
  assert.equal(await s.message(), `fix: the bug\n\nAgent-Session: ${S1}\n`);
  assert.deepEqual(await s.ids(), [S1]);
  // 3: a body that ends with a trailer block: the line joins that block.
  await s.put('b.txt', '3\n');
  const coauthored = 'third\n\nbody\n\nCo-authored-by: A <a@example.invalid>';
  await s.g(['commit', '-q', '-m', coauthored], s.agent(S1));
  assert.equal(await s.message(), `${coauthored}\nAgent-Session: ${S1}\n`);
  assert.deepEqual(await s.ids(), [S1]);
  // 4: --no-verify does not skip prepare-commit-msg.
  await s.put('b.txt', '4\n');
  await s.g(['commit', '-q', '--no-verify', '-m', 'fourth'], s.agent(S1));
  assert.deepEqual(await s.ids(), [S1]);
  // 5: an amend by another session keeps both ids; 6: the same amend again adds none.
  await s.g(['commit', '-q', '--amend', '--no-edit'], s.agent(S2));
  assert.deepEqual(await s.ids(), [S1, S2]);
  await s.g(['commit', '-q', '--amend', '--no-edit'], s.agent(S2));
  assert.equal(await s.message(), `fourth\n\nAgent-Session: ${S1}\nAgent-Session: ${S2}\n`);
  // 7: a person's commit, with no harness variable, is left as written.
  await s.put('b.txt', '7\n');
  await s.g(['commit', '-q', '-m', 'by hand']);
  assert.equal(await s.message(), 'by hand\n');
  // 8: a body with a `---` line: the line goes to the true end, and git reads it back.
  await s.put('b.txt', '8\n');
  const divided = 'eighth\n\nnotes\n---\nmore notes';
  await s.g(['commit', '-q', '-m', divided], s.agent(S1));
  assert.equal(await s.message(), `${divided}\n\nAgent-Session: ${S1}\n`);
  assert.deepEqual(await s.ids(), [S1]);
  // 9: the editor flow, left empty: git still stops the commit.
  const head = (await s.g(['rev-parse', 'HEAD'])).trim();
  await s.put('b.txt', '9\n');
  const empty = await s.gitIn(s.repo, ['commit', '-q'], { ...s.agent(S1), GIT_EDITOR: 'true' });
  assert.notEqual(empty.code, 0, 'an empty message still stops the commit');
  // 10: an unedited template: git still stops the commit.
  await writeFile(join(s.root, 'template.txt'), 'template subject\n');
  const template = await s.gitIn(s.repo, ['commit', '-q', '-t', join(s.root, 'template.txt')],
    { ...s.agent(S1), GIT_EDITOR: 'true' });
  assert.notEqual(template.code, 0, 'an unedited template still stops the commit');
  assert.equal((await s.g(['rev-parse', 'HEAD'])).trim(), head);
  // 11: a message written in an editor is the person's: not stamped.
  await s.g(['commit', '-q', '-v'], { ...s.agent(S1), GIT_EDITOR: 'f() { printf "edited subject\\n" > "$1"; }; f' });
  assert.equal(await s.message(), 'edited subject\n');
  // 12: a merge whose message git writes with no final newline: subject intact, the line read back.
  await s.g(['checkout', '-q', '-b', 'side']);
  await s.put('side.txt', 'side\n');
  await s.g(['commit', '-q', '-m', 'on side']);
  await s.g(['checkout', '-q', 'main']);
  await s.g(['merge', '-q', '--no-ff', '-m', 'merge side', 'side'], s.agent(S1));
  assert.equal(await s.message(), `merge side\n\nAgent-Session: ${S1}\n`);
  //     and git's default merge message.
  await s.g(['checkout', '-q', '-b', 'side2']);
  await s.put('side2.txt', 'side2\n');
  await s.g(['commit', '-q', '-m', 'on side2']);
  await s.g(['checkout', '-q', 'main']);
  await s.g(['merge', '-q', '--no-ff', '--no-edit', 'side2'], s.agent(S1));
  assert.equal(await s.message(), `Merge branch 'side2'\n\nAgent-Session: ${S1}\n`);
  // 13: a squash merge, then its commit.
  await s.g(['checkout', '-q', '-b', 'side3']);
  await s.put('side3.txt', 'side3\n');
  await s.g(['commit', '-q', '-m', 'on side3']);
  await s.g(['checkout', '-q', 'main']);
  await s.g(['merge', '-q', '--squash', 'side3']);
  await s.g(['commit', '-q', '--no-edit'], s.agent(S1));
  assert.deepEqual(await s.ids(), [S1]);
  // 14: a cherry-pick of a person's commit is a replay: not stamped.
  await s.g(['checkout', '-q', '-b', 'side4']);
  await s.put('side4.txt', 'side4\n');
  await s.g(['commit', '-q', '-m', 'on side4']);
  await s.g(['checkout', '-q', 'main']);
  await s.g(['cherry-pick', 'side4'], s.agent(S1));
  assert.equal(await s.message(), 'on side4\n');
  // 15: a revert has no replay marker: stamped.
  await s.g(['revert', '--no-edit', 'HEAD'], s.agent(S1));
  assert.deepEqual(await s.ids(), [S1]);
  // 16: a rebase of a person's commits is a replay: not stamped.
  await s.g(['checkout', '-q', '-b', 'side5', 'HEAD~3']);
  await s.put('side5.txt', '1\n');
  await s.g(['commit', '-q', '-m', 'first on side5']);
  await s.put('side5.txt', '2\n');
  await s.g(['commit', '-q', '-m', 'second on side5']);
  await s.g(['rebase', '-q', 'main'], s.agent(S1));
  assert.equal(await s.message('HEAD'), 'second on side5\n');
  assert.equal(await s.message('HEAD~1'), 'first on side5\n');
  // 17: an interactive reword is a replay too: not stamped.
  await s.g(['rebase', '-q', '-i', 'HEAD~1'], { ...s.agent(S1),
    GIT_SEQUENCE_EDITOR: 'f() { sed "s/^pick/reword/" "$1" > "$1.x" && mv "$1.x" "$1"; }; f',
    GIT_EDITOR: 'f() { printf "reworded\\n" > "$1"; }; f' });
  assert.equal(await s.message('HEAD'), 'reworded\n');
  // 18: a squash of two stamped commits keeps both lines in the message, and the rebasing session adds none.
  await s.put('side5.txt', '3\n');
  await s.g(['commit', '-q', '-m', 'third on side5'], s.agent(S1));
  await s.put('side5.txt', '4\n');
  await s.g(['commit', '-q', '-m', 'fourth on side5'], s.agent(S2));
  await s.g(['rebase', '-q', '-i', 'HEAD~2'], { ...s.agent(S3),
    GIT_SEQUENCE_EDITOR: 'f() { sed "2s/^pick/squash/" "$1" > "$1.x" && mv "$1.x" "$1"; }; f', GIT_EDITOR: 'true' });
  const squashed = await s.message();
  assert.ok(squashed.includes(`Agent-Session: ${S1}`) && squashed.includes(`Agent-Session: ${S2}`), squashed);
  assert.ok(!squashed.includes(S3), 'the rebasing session is not stamped');
  // 19: the person's trailer settings change nothing: the line is last, and both ids stay on an amend.
  await s.g(['config', 'trailer.ifexists', 'replace']);
  await s.g(['config', 'trailer.where', 'start']);
  await s.put('side5.txt', '5\n');
  await s.g(['commit', '-q', '-m', 'fifth on side5\n\nCo-authored-by: A <a@example.invalid>'], s.agent(S1));
  await s.g(['commit', '-q', '--amend', '--no-edit'], s.agent(S2));
  assert.equal(await s.message(), `fifth on side5\n\nCo-authored-by: A <a@example.invalid>\nAgent-Session: ${S1}\n`
    + `Agent-Session: ${S2}\n`);
  assert.deepEqual(await s.ids(), [S1, S2]);
});

test('a message changes only by the line at its end: URLs, Key:value, # paragraphs, every cleanup mode, CRLF', async (t) => {
  const s = await sandbox(t);
  assert.equal((await s.hook(['add'])).code, 0);
  const file = join(s.root, 'MSG');
  const F = async (text, ...more) => { await writeFile(file, text); return s.twice(['-F', file, ...more], s.agent(S1)); };
  // A last paragraph that git parses as a trailer block keeps its bytes; the line joins it.
  onlyAppended(await F('subj\n\nhttps://example.com/issue/1\n'), [S1], 'URL');
  onlyAppended(await F('subj\n\nReviewed-by:Bob\n'), [S1], 'Key:value');
  onlyAppended(await F('subj\n\nReviewed-by :   Bob\n'), [S1], 'Key : value');
  onlyAppended(await F('subj\n\nSigned-off-by: A <a@example.invalid>\n'), [S1], 'a trailer block');
  assert.deepEqual(await s.ids(), [S1]);
  // A last paragraph that git reads as trailers only once the line joins it: the line goes in its own paragraph, so git
  // reads no line of the person's as a trailer that it did not read before.
  const mixed = await F('subj\n\nSigned-off-by: A <a@example.invalid>\nline a\nline b\nline c\nline d\n');
  assert.equal(mixed.stamped, `${mixed.base}\nAgent-Session: ${S1}\n`);
  assert.equal((await s.g(['log', '-1', '--format=%(trailers:only,unfold)'])).trim(), `Agent-Session: ${S1}`);
  // A last paragraph that starts with #: kept where it is, in each cleanup mode.
  for (const mode of [[], ['--cleanup=whitespace'], ['--cleanup=strip'], ['--cleanup=verbatim'], ['--cleanup=scissors']]) {
    onlyAppended(await F('subj\n\nbody\n\n#123\n', ...mode), [S1], `# paragraph ${mode.join(' ') || 'default'}`);
    assert.deepEqual(await s.ids(), [S1], `read back ${mode.join(' ') || 'default'}`);
  }
  for (const mode of [[], ['--cleanup=verbatim']]) {
    onlyAppended(await s.twice(['-m', 'subj\n\nbody\n\n# Conflicts:\n#\tfile.txt', ...mode], s.agent(S1)), [S1],
      `-m with # lines ${mode.join(' ')}`);
  }
  // CRLF, a message with no final newline, trailing blank lines.
  onlyAppended(await F('subj\r\n\r\nbody line\r\n'), [S1], 'CRLF');
  onlyAppended(await F('subj\r\n\r\nbody line\r\n', '--cleanup=verbatim'), [S1], 'CRLF verbatim');
  onlyAppended(await F('subj', '--cleanup=verbatim'), [S1], 'no final newline');
  onlyAppended(await F('subj\n\nbody\n\n\n'), [S1], 'trailing blank lines');
  // An edited message with git's scissors line: nothing is added below the cut (git would drop it).
  const scissors = await s.twice(['-v', '-e', '-m', 'verbose subject'], { ...s.agent(S1), GIT_EDITOR: 'true' });
  assert.equal(scissors.stamped, scissors.base);
  //     and a message that holds that line as text: git's trailer reader stops there, so no line goes below it.
  const cut = await F('subj\n\n# ------------------------ >8 ------------------------\nmore\n', '--cleanup=verbatim');
  assert.equal(cut.stamped, cut.base);
  // A template that the editor changed: the person's message, not stamped.
  await writeFile(join(s.root, 'template.txt'), 'template subject\n');
  const templated = await s.twice(['-t', join(s.root, 'template.txt')],
    { ...s.agent(S1), GIT_EDITOR: 'f() { printf "edited from the template\\n" > "$1"; }; f' });
  assert.equal(templated.stamped, templated.base);
  // An agent's amend of a person's message rewrites nothing of it.
  await writeFile(file, 'person\n\nsee https://example.com/a and Key:value\n');
  await s.g(['commit', '-q', '--allow-empty', '-F', file]);
  const before = await s.message();
  await s.g(['commit', '-q', '--amend', '--no-edit', '--allow-empty'], s.agent(S2));
  onlyAppended({ base: before, stamped: await s.message() }, [S2], 'amend');
});

test('a conflicted merge committed with --no-edit keeps its # Conflicts block where git put it', async (t) => {
  const s = await sandbox(t);
  assert.equal((await s.hook(['add'])).code, 0);
  await s.g(['checkout', '-q', '-b', 'other']);
  await s.put('a.txt', 'theirs\n');
  await s.g(['commit', '-q', '-m', 'theirs']);
  await s.g(['checkout', '-q', 'main']);
  await s.put('a.txt', 'ours\n');
  await s.g(['commit', '-q', '-m', 'ours']);
  assert.notEqual((await s.gitIn(s.repo, ['merge', '-q', 'other'])).code, 0, 'the merge conflicts');
  await s.put('a.txt', 'both\n');
  await s.g(['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-edit']);
  const base = await s.message();
  assert.match(base, /# Conflicts:/, 'git keeps its # Conflicts block with --no-edit');
  await s.g(['reset', '-q', '--hard', 'HEAD~1']);
  assert.notEqual((await s.gitIn(s.repo, ['merge', '-q', 'other'])).code, 0);
  await s.put('a.txt', 'both\n');
  await s.g(['commit', '-q', '--no-edit'], s.agent(S1));
  onlyAppended({ base, stamped: await s.message() }, [S1], 'conflicts');
  assert.deepEqual(await s.ids(), [S1]);
});

test('an empty message stays empty, so git still refuses it', async (t) => {
  const s = await sandbox(t);
  assert.equal((await s.hook(['add'])).code, 0);
  const head = (await s.g(['rev-parse', 'HEAD'])).trim();
  const file = join(s.root, 'EMPTY');
  for (const [label, args, text] of [['-m ""', ['-m', ''], null], ['an empty -F', ['-F', file], ''],
    ['a blank -F', ['-F', file], '\n  \n\n'], ['a comment-only -F, stripped', ['-F', file, '--cleanup=strip'], '# only\n'],
    // git's own rule: Signed-off-by lines alone are an empty message too.
    ['-s -m ""', ['-s', '-m', ''], null], ['-s with an empty -F', ['-s', '-F', file], ''],
    ['a sign-off-only -F', ['-F', file], 'Signed-off-by: Bot <b@example.invalid>\n'],
    ['sign-offs and blank lines', ['-F', file], '\nSigned-off-by: A <a@example.invalid>\n\nSigned-off-by: B <b@example.invalid>\n'],
    ['-s --amend -m ""', ['--amend', '-s', '-m', ''], null]]) {
    if (text !== null) await writeFile(file, text);
    const r = await s.gitIn(s.repo, ['commit', '-q', '--allow-empty', ...args], s.agent(S1));
    assert.notEqual(r.code, 0, `${label}: git refuses it`);
    assert.equal((await s.g(['rev-parse', 'HEAD'])).trim(), head, label);
  }
});

test('Codex gets no line yet, and an id of another shape gets none', async (t) => {
  const s = await sandbox(t);
  assert.equal((await s.hook(['add'])).code, 0);
  await s.put('c.txt', '1\n');
  await s.g(['commit', '-q', '-m', 'codex tool call'], { CODEX_THREAD_ID: CX, CODEX_TOOL_CALL_ID: 'call_1' });
  assert.equal(await s.message(), 'codex tool call\n');
  for (const [n, id] of [['3', 'not-a-session-id'], ['4', S2.toUpperCase()], ['5', '*'], ['6', `${S1}x`],
    ['7', `${S1}\nEvil: line`], ['8', ` ${S1}`]]) {
    await s.put('c.txt', `${n}\n`);
    await s.g(['commit', '-q', '-m', `odd id ${n}`], s.agent(id));
    assert.equal(await s.message(), `odd id ${n}\n`, `no line for ${JSON.stringify(id)}`);
  }
});

test('the script prints nothing and exits 0, even when git, the message file or nounset fails it', async (t) => {
  const s = await sandbox(t);
  assert.equal((await s.hook(['add'])).code, 0);
  const script = join(s.repo, '.git', 'sonah', 'agent-session.sh');
  const msg = join(s.root, 'MSG');
  await writeFile(msg, 'subject');
  const run = (args, extra) => spawnSync('/bin/sh', [script, ...args], { cwd: s.repo, env: { ...s.env, ...extra }, encoding: 'utf8' });
  for (const [args, extra] of [[[msg, 'message'], s.agent(S1)], [[msg, 'message'], {}], [[join(s.root, 'none'), 'message'],
    s.agent(S1)], [[msg, ''], s.agent(S1)], [[], s.agent(S1)], [[msg, 'message'], { ...s.agent(S1), PATH: '/nonexistent' }]]) {
    const r = run(args, extra);
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''], JSON.stringify(args));
  }
  assert.equal(await readFile(msg, 'utf8'), `subject\n\nAgent-Session: ${S1}\n`);
  // lefthook's placeholder for a source that git did not pass is no source: no line, whatever the file holds.
  const placeholder = join(s.root, 'PLACEHOLDER');
  await writeFile(placeholder, 'words already here\n');
  assert.deepEqual([run([placeholder, '{2}'], s.agent(S1)).status, await readFile(placeholder, 'utf8')], [0, 'words already here\n']);
  const away = spawnSync('/bin/sh', [script, msg, 'message'], { cwd: s.home, env: { ...s.env, ...s.agent(S2) }, encoding: 'utf8' });
  assert.deepEqual([away.status, away.stdout, away.stderr], [0, '', '']);
  // An inherited nounset (bash as sh reads SHELLOPTS): no error, and the line is still added.
  await s.put('n.txt', '1\n');
  const nounset = await s.gitIn(s.repo, ['commit', '-q', '-m', 'nounset'], { ...s.agent(S1), SHELLOPTS: 'nounset' });
  assert.deepEqual([nounset.code, nounset.stderr], [0, '']);
  assert.deepEqual(await s.ids(), [S1]);
  await s.put('n.txt', '2\n');
  const byHand = await s.gitIn(s.repo, ['commit', '-q', '-m', 'nounset by hand'], { SHELLOPTS: 'nounset' });
  assert.deepEqual([byHand.code, byHand.stderr, await s.message()], [0, '', 'nounset by hand\n']);
});

test('a linked worktree whose path holds a space shares the hook; one opt-in covers it', async (t) => {
  const s = await sandbox(t);
  assert.equal((await s.hook(['add'])).code, 0);
  const wt = join(s.root, 'wt two');
  await s.g(['worktree', 'add', '-q', '-b', 'wt', wt]);
  await writeFile(join(wt, 'w.txt'), 'w\n');
  await s.g(['add', 'w.txt'], {}, wt);
  await s.g(['commit', '-q', '-m', 'in the worktree'], s.agent(S1), wt);
  assert.deepEqual(await s.ids('HEAD', wt), [S1]);
  const facts = await commitLinkFacts(wt, { git: s.sealedGit });
  assert.deepEqual([facts.state, facts.route], ['on', 'runner']);
  assert.ok((await s.hook(['add'], wt)).out.startsWith(HOOK_WORDS.alreadyOn));
});

test('another tool\'s hook is never changed; a line in it is not checked, never reported on', async (t) => {
  const s = await sandbox(t);
  const hookFile = join(s.repo, '.git', 'hooks', 'prepare-commit-msg');
  const theirs = '#!/bin/sh\necho "their hook" >/dev/null\n';
  await writeFile(hookFile, theirs);
  await chmod(hookFile, 0o755);
  const r = await s.hook(['add']);
  assert.equal(r.code, 1, 'the person has a line to add');
  assert.equal(await readFile(hookFile, 'utf8'), theirs, 'their hook is unchanged');
  assert.ok(r.out.includes(HOOK_WORDS.notOnForeign(hookFile)) && r.out.includes(HOOK_WORDS.addLine(hookFile))
    && r.out.includes(`\n${HOOK_LINE}\n`), r.out);
  assert.ok(r.out.includes(HOOK_WORDS.optInOnce) && !r.out.includes(HOOK_WORDS.optIn), 'no "now" while it is off');
  let facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.deepEqual([facts.state, commitLinkStatus(facts).attention], ['not_checked', false]);
  await writeFile(hookFile, `${theirs}${HOOK_LINE}\n`);
  facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.deepEqual([facts.state, facts.lineIn], ['not_checked', hookFile]);
  assert.equal(commitLinkStatus(facts).line, `${HOOK_WORDS.status.lineNotChecked(hookFile)} ${HOOK_WORDS.status.check}`);
  await s.put('d.txt', '1\n');
  await s.g(['commit', '-q', '-m', 'through their hook'], s.agent(S1));
  assert.deepEqual(await s.ids(), [S1], 'git reached the line here');
  // A hook that exits before the line: the line never runs, and doctor still does not say on.
  await writeFile(hookFile, `#!/bin/sh\nexit 0\n${HOOK_LINE}\n`);
  facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.equal(facts.state, 'not_checked');
  await s.put('d.txt', '2\n');
  await s.g(['commit', '-q', '-m', 'exits first'], s.agent(S1));
  assert.equal(await s.message(), 'exits first\n');
  const removed = await s.hook(['remove']);
  assert.equal(removed.code, 0);
  assert.ok(removed.out.includes(HOOK_WORDS.lineLeft(hookFile)));
  assert.equal(await readFile(hookFile, 'utf8'), `#!/bin/sh\nexit 0\n${HOOK_LINE}\n`);
  assert.equal((await commitLinkFacts(s.repo, { git: s.sealedGit })).state, 'off');
});

test('a hook file git skips, as not executable, is never on: add makes Sonah\'s own executable, or says how', async (t) => {
  const s = await sandbox(t);
  assert.equal((await s.hook(['add'])).code, 0);
  const runner = join(s.repo, '.git', 'hooks', 'prepare-commit-msg');
  await chmod(runner, 0o644);
  let facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.deepEqual([facts.state, facts.notExecutable], ['not_run', runner]);
  assert.deepEqual(commitLinkStatus(facts), { line: `${HOOK_WORDS.status.notExecutable(runner)} ${HOOK_WORDS.status.fix}`,
    attention: true });
  await s.put('x.txt', '1\n');
  await s.g(['commit', '-q', '-m', 'skipped'], s.agent(S1));
  assert.equal(await s.message(), 'skipped\n', 'git skipped the hook');
  const repaired = await s.hook(['add']);
  assert.equal(repaired.code, 0);
  assert.ok(repaired.out.startsWith(HOOK_WORDS.madeExecutable(runner)) && !repaired.out.includes(HOOK_WORDS.alreadyOn));
  assert.equal((await commitLinkFacts(s.repo, { git: s.sealedGit })).state, 'on');
  await s.put('x.txt', '2\n');
  await s.g(['commit', '-q', '-m', 'runs again'], s.agent(S1));
  assert.deepEqual(await s.ids(), [S1]);
  // In a core.hooksPath folder, outside the git folder: Sonah prints the command and changes nothing.
  const dir = join(s.root, 'team hooks');
  await mkdir(dir);
  await s.g(['config', 'core.hooksPath', dir]);
  const theirs = join(dir, 'prepare-commit-msg');
  await writeFile(theirs, AGENT_SESSION_RUNNER, { mode: 0o644 });
  facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.deepEqual([facts.state, facts.notExecutable], ['not_run', theirs]);
  const r = await s.hook(['add']);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes(HOOK_WORDS.notOnNotExecutable(theirs)) && r.out.includes(`chmod +x '${theirs}'`), r.out);
  assert.equal((await stat(theirs)).mode & 0o111, 0, 'their file is left as it was');
  await chmod(theirs, 0o755);
  assert.deepEqual([(await commitLinkFacts(s.repo, { git: s.sealedGit })).state], ['on']);
});

test('lefthook\'s command, with git\'s arguments put in as they are, in a linked worktree whose paths hold spaces', async (t) => {
  const s = await sandbox(t);
  assert.equal((await s.hook(['add'])).code, 0);
  // lefthook puts the raw text of git's arguments in place of {1} and {2} (and leaves a placeholder when git passes
  // none), then runs the command with sh: this hook does the same with Sonah's command.
  const hooks = join(s.repo, '.git', 'hooks');
  await writeFile(join(hooks, 'prepare-commit-msg'), `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const run = ${JSON.stringify(LEFTHOOK_RUN)}.replace(/\\{(\\d)\\}/g, (m, n) => process.argv[1 + Number(n)] ?? m);
process.exit(spawnSync('sh', ['-c', run], { stdio: 'inherit' }).status ?? 1);
// ${LEFTHOOK_HOOK_CALL}
`);
  await chmod(join(hooks, 'prepare-commit-msg'), 0o755);
  const wt = join(s.root, 'my repo wt');
  await s.g(['worktree', 'add', '-q', '-b', 'wt', wt]);
  // A file at the message path's first word: nothing may be written to it.
  const before = join(s.root, 'my');
  await writeFile(before, 'notes\n');
  await writeFile(join(wt, 'w.txt'), 'w\n');
  await s.g(['add', 'w.txt'], {}, wt);
  await s.g(['commit', '-q', '-m', 'agent in the worktree'], s.agent(S1), wt);
  assert.deepEqual(await s.ids('HEAD', wt), [S1]);
  assert.equal(await readFile(before, 'utf8'), 'notes\n');
  // An editor flow: git passes no source, lefthook leaves {2}: no line.
  await writeFile(join(wt, 'w.txt'), 'w2\n');
  await s.g(['add', 'w.txt'], {}, wt);
  await s.g(['commit', '-q'], { ...s.agent(S1), GIT_EDITOR: 'f() { printf "by the editor\\n" > "$1"; }; f' }, wt);
  assert.equal(await s.message('HEAD', wt), 'by the editor\n');
});

test('with core.hooksPath set, Sonah writes nothing there and prints the file to create', async (t) => {
  const s = await sandbox(t);
  const dir = join(s.root, 'shared-hooks');
  await mkdir(dir);
  await s.g(['config', 'core.hooksPath', dir]);
  const r = await s.hook(['add']);
  assert.equal(r.code, 1);
  assert.deepEqual(await readdir(dir), [], 'nothing written where core.hooksPath points');
  // Even a folder inside the git folder: core.hooksPath is the person's or their tool's.
  const inside = join(s.repo, '.git', 'team-hooks');
  await mkdir(inside);
  await s.g(['config', 'core.hooksPath', inside]);
  assert.equal((await s.hook(['add'])).code, 1);
  assert.deepEqual(await readdir(inside), []);
  await s.g(['config', 'core.hooksPath', dir]);
  assert.ok(r.out.includes(HOOK_WORDS.notOnHooksPath(dir)) && r.out.includes(HOOK_WORDS.createFile(join(dir, 'prepare-commit-msg'))));
  await assert.rejects(lstat(join(s.repo, '.git', 'hooks', 'prepare-commit-msg')), 'and none in .git/hooks either');
  const facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.deepEqual([facts.state, commitLinkStatus(facts).attention], ['not_run', true]);
  await s.put('e.txt', '1\n');
  await s.g(['commit', '-q', '-m', 'not run'], s.agent(S1));
  assert.equal(await s.message(), 'not run\n');
  // The file the person creates from those lines, in a folder outside the git folder: remove names it, keeps it.
  await writeFile(join(dir, 'prepare-commit-msg'), AGENT_SESSION_RUNNER);
  await chmod(join(dir, 'prepare-commit-msg'), 0o755);
  assert.equal((await commitLinkFacts(s.repo, { git: s.sealedGit })).route, 'runner');
  const removed = await s.hook(['remove']);
  assert.ok(removed.out.includes(HOOK_WORDS.lineLeft(join(dir, 'prepare-commit-msg'))), removed.out);
  assert.equal(await readFile(join(dir, 'prepare-commit-msg'), 'utf8'), AGENT_SESSION_RUNNER);
});

test('husky\'s folder: the line goes in the hook beside it; doctor reads it there, not checked', async (t) => {
  const s = await sandbox(t);
  await mkdir(join(s.repo, '.husky', '_'), { recursive: true });
  // husky 9's layout: its stub in .husky/_ runs .husky/<hook> (a stub made by hand here, not husky's own text).
  const stub = '#!/usr/bin/env sh\nh="$(dirname "$(dirname "$0")")/$(basename "$0")"; [ -f "$h" ] && sh -e "$h" "$@"\nexit 0\n';
  await writeFile(join(s.repo, '.husky', '_', 'prepare-commit-msg'), stub);
  await chmod(join(s.repo, '.husky', '_', 'prepare-commit-msg'), 0o755);
  await s.g(['config', 'core.hooksPath', '.husky/_']);
  const r = await s.hook(['add']);
  assert.equal(r.code, 1);
  const husky = join(s.repo, '.husky', 'prepare-commit-msg');
  assert.ok(r.out.includes(HOOK_WORDS.addLine(husky)), r.out);
  await writeFile(husky, `${HOOK_LINE}\n`);
  const facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.deepEqual([facts.state, facts.lineIn], ['not_checked', husky]);
  await s.put('h.txt', '1\n');
  await s.g(['commit', '-q', '-m', 'through husky'], s.agent(S1));
  assert.deepEqual(await s.ids(), [S1]);
  const removed = await s.hook(['remove']);
  assert.ok(removed.out.includes(HOOK_WORDS.lineLeft(husky)), removed.out);
  assert.equal(await readFile(husky, 'utf8'), `${HOOK_LINE}\n`, 'husky\'s file is the person\'s: left as it is');
});

test('lefthook: .old is moved and off; the command is printed in its file\'s own format, never a second key', async (t) => {
  const s = await sandbox(t);
  const yml = join(s.repo, 'lefthook.yml');
  await writeFile(yml, 'prepare-commit-msg:\n  commands:\n    echo:\n      run: "true"\n');
  const first = await s.hook(['add']);
  assert.equal(first.code, 0);
  assert.ok(first.out.includes(HOOK_WORDS.lefthookAhead(yml)) && first.out.includes(HOOK_WORDS.mergeLefthook(yml))
    && first.out.includes(lefthookLines('lefthook.yml', true)), first.out);
  const hooks = join(s.repo, '.git', 'hooks');
  // What `lefthook install` leaves (lefthook 2.x): the hook renamed to .old, and its own hook calling its runner.
  await rename(join(hooks, 'prepare-commit-msg'), join(hooks, 'prepare-commit-msg.old'));
  await writeFile(join(hooks, 'prepare-commit-msg'), `#!/bin/sh\n${LEFTHOOK_HOOK_CALL} "$@"\n`);
  let facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.deepEqual([facts.state, facts.file], ['moved', join(hooks, 'prepare-commit-msg.old')]);
  assert.deepEqual(commitLinkStatus(facts), { line: `${HOOK_WORDS.status.moved(facts.file)} ${HOOK_WORDS.status.fix}`,
    attention: true });
  const again = await s.hook(['add']);
  assert.equal(again.code, 1);
  assert.ok(again.out.includes(HOOK_WORDS.mergeLefthook(yml)) && again.out.includes(HOOK_WORDS.lefthookShared), again.out);
  assert.ok(!again.out.includes('prepare-commit-msg:\n  commands:'), 'no second prepare-commit-msg key');
  // Merged under the existing commands: doctor sees Sonah's command, but does not say on.
  await writeFile(yml, `prepare-commit-msg:\n  commands:\n    echo:\n      run: "true"\n${lefthookLines('lefthook.yml', true)}\n`);
  facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.deepEqual([facts.state, facts.lineIn], ['not_checked', yml]);
  // lefthook's own hook with no file that names the script: nothing runs it.
  await writeFile(yml, 'pre-commit:\n  commands: {}\n');
  await rm(join(hooks, 'prepare-commit-msg.old'));
  facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.equal(facts.state, 'not_run');
  const full = await s.hook(['add']);
  assert.ok(full.out.includes(HOOK_WORDS.addLefthook(yml)) && full.out.includes(lefthookLines('lefthook.yml', false)));
  // TOML and JSON files get their own format, and doctor finds the command in each.
  await rm(yml);
  for (const [name, text] of [['lefthook.toml', '[pre-commit.commands.lint]\nrun = "true"\n'],
    ['lefthook.json', '{ "prepare-commit-msg": { "commands": {} } }\n']]) {
    await writeFile(join(s.repo, name), text);
    const r = await s.hook(['add']);
    const lines = lefthookLines(name, name.endsWith('.json'));
    assert.ok(r.out.includes(lines), `${name}:\n${r.out}`);
    assert.ok(!r.out.includes(lefthookLines('lefthook.yml', false)), `${name}: no YAML`);
    if (name.endsWith('.json')) {
      // The file names prepare-commit-msg: only the command, under its commands; never a second key, which would
      // silently replace the person's commands (the last key wins).
      assert.ok(r.out.includes(HOOK_WORDS.mergeLefthook(join(s.repo, name))), r.out);
      assert.ok(!r.out.includes('"prepare-commit-msg"'), `${name}: no second key`);
    } else {
      assert.ok(!/^\[prepare-commit-msg\]$/m.test(r.out), `${name}: no second table`);
    }
    await writeFile(join(s.repo, name), `${text}\n${lines}\n`);
    assert.equal((await commitLinkFacts(s.repo, { git: s.sealedGit })).lineIn, join(s.repo, name), name);
    await rm(join(s.repo, name));
  }
  assert.ok(!LEFTHOOK_RUN.includes('\''), 'the command needs no quoting in YAML or TOML');
});

test('pre-commit: its .legacy is on; its own hook gets steps, never a line inside it', async (t) => {
  const s = await sandbox(t);
  assert.equal((await s.hook(['add'])).code, 0);
  const hooks = join(s.repo, '.git', 'hooks');
  const theirs = `#!/usr/bin/env bash\n${PRE_COMMIT_HOOK_ID}\nexec true\n`;
  await rename(join(hooks, 'prepare-commit-msg'), join(hooks, 'prepare-commit-msg.legacy'));
  await writeFile(join(hooks, 'prepare-commit-msg'), theirs);
  let facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.deepEqual([facts.state, facts.route, facts.file], ['on', 'pre-commit', join(hooks, 'prepare-commit-msg.legacy')]);
  // Sonah's runner at .legacy beside a hook that is not pre-commit's: nothing is seen to run it.
  await writeFile(join(hooks, 'prepare-commit-msg'), '#!/bin/sh\nexit 0\n');
  facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.notEqual(facts.state, 'on');
  await writeFile(join(hooks, 'prepare-commit-msg'), theirs);
  // pre-commit's .legacy that is not executable: pre-commit skips it; add makes it executable again.
  await chmod(join(hooks, 'prepare-commit-msg.legacy'), 0o644);
  facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.deepEqual([facts.state, facts.notExecutable], ['not_run', join(hooks, 'prepare-commit-msg.legacy')]);
  const repaired = await s.hook(['add']);
  assert.ok(repaired.out.includes(HOOK_WORDS.madeExecutable(join(hooks, 'prepare-commit-msg.legacy'))), repaired.out);
  assert.equal((await commitLinkFacts(s.repo, { git: s.sealedGit })).route, 'pre-commit');
  // pre-commit's hook with no Sonah hook beside it: Sonah prints pre-commit's own steps.
  await rm(join(hooks, 'prepare-commit-msg.legacy'));
  const r = await s.hook(['add']);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes(HOOK_WORDS.notOnPreCommit(join(hooks, 'prepare-commit-msg')))
    && r.out.includes(HOOK_WORDS.preCommitSteps(s.repo)) && r.out.includes(PRE_COMMIT_STEPS), r.out);
  assert.ok(!r.out.includes(HOOK_WORDS.addLine(join(hooks, 'prepare-commit-msg'))));
  assert.equal(await readFile(join(hooks, 'prepare-commit-msg'), 'utf8'), theirs);
  // A line appended after its exec never runs: doctor does not say on.
  await writeFile(join(hooks, 'prepare-commit-msg'), `${theirs}${HOOK_LINE}\n`);
  facts = await commitLinkFacts(s.repo, { git: s.sealedGit });
  assert.equal(facts.state, 'not_checked');
  // remove deletes Sonah's own files and leaves pre-commit's hook.
  await rename(join(hooks, 'prepare-commit-msg'), join(s.root, 'keep'));
  assert.equal((await s.hook(['add'])).code, 0);
  await rename(join(hooks, 'prepare-commit-msg'), join(hooks, 'prepare-commit-msg.legacy'));
  await rename(join(s.root, 'keep'), join(hooks, 'prepare-commit-msg'));
  assert.equal((await s.hook(['remove'])).code, 0);
  assert.deepEqual((await readdir(hooks)).filter((n) => !n.endsWith('.sample')), ['prepare-commit-msg']);
});

test('a hooks folder or Sonah\'s folder that is a link: Sonah writes nothing through it', async (t) => {
  const s = await sandbox(t);
  const tracked = join(s.repo, '.githooks');
  await mkdir(tracked);
  await rm(join(s.repo, '.git', 'hooks'), { recursive: true });
  await symlink(tracked, join(s.repo, '.git', 'hooks'));
  const r = await s.hook(['add']);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes(HOOK_WORDS.notOnLink(join(s.repo, '.git', 'hooks'))), r.out);
  assert.deepEqual(await readdir(tracked), [], 'nothing lands in the working tree');
  assert.equal((await s.g(['status', '--porcelain'])).trim(), '');
  // Sonah's own folder as a link: a closed problem, and nothing written.
  const s2 = await sandbox(t);
  const elsewhere = join(s2.root, 'elsewhere');
  await mkdir(elsewhere);
  await symlink(elsewhere, join(s2.repo, '.git', 'sonah'));
  const r2 = await s2.hook(['add']);
  assert.deepEqual([r2.code, r2.err], [2, `${HOOK_WORDS.problems.hook_path_link(join(s2.repo, '.git', 'sonah',
    'agent-session.sh'))}\n`]);
  assert.deepEqual(await readdir(elsewhere), []);
  await assert.rejects(lstat(join(s2.repo, '.git', 'hooks', 'prepare-commit-msg')));
});

test('hook remove leaves the hooks folder, the config and the git folder as they were before add', async (t) => {
  for (const template of [null, 'empty']) {
    let dir = null;
    if (template) { dir = await mkdtemp(join(tmpdir(), 'sonah-d143-template-')); t.after(() => rm(dir, { recursive: true, force: true })); }
    const s = await sandbox(t, { template: dir });
    const snapshot = async () => {
      const git = join(s.repo, '.git');
      const names = (await readdir(git)).filter((n) => !['index', 'logs', 'objects', 'refs', 'COMMIT_EDITMSG', 'ORIG_HEAD'].includes(n)).sort();
      const hooks = names.includes('hooks') ? Object.fromEntries(await Promise.all((await readdir(join(git, 'hooks'))).sort()
        .map(async (n) => [n, await readFile(join(git, 'hooks', n), 'utf8')]))) : null;
      return { names, hooks, config: await readFile(join(git, 'config'), 'utf8') };
    };
    const before = await snapshot();
    assert.equal(before.names.includes('hooks'), !template, 'an empty template makes no hooks folder');
    assert.equal((await s.hook(['add'])).code, 0);
    await s.put('f.txt', '1\n');
    await s.g(['commit', '-q', '-m', 'stamped'], s.agent(S1));
    const removed = await s.hook(['remove']);
    assert.equal(removed.code, 0);
    assert.ok(removed.out.includes(HOOK_WORDS.historyStays));
    assert.deepEqual(await snapshot(), before, template ? 'with an empty template' : 'with git\'s own hooks folder');
    assert.deepEqual(await s.ids(), [S1], 'the line in history stays');
    const nothing = await s.hook(['remove']);
    assert.ok(nothing.out.startsWith(HOOK_WORDS.nothingToRemove));
  }
});

test('the closed problems and the usage: nothing is written', async (t) => {
  const s = await sandbox(t);
  const notes = join(s.root, 'notes');
  await mkdir(notes);
  let r = await s.hook(['add', '--repo', notes]);
  assert.deepEqual([r.code, r.out, r.err], [2, '', `${HOOK_WORDS.problems.hook_not_git(notes)}\n`]);
  const bare = join(s.root, 'bare.git');
  await s.g(['init', '-q', '--bare', bare], {}, s.root);
  r = await s.hook(['add', '--repo', bare]);
  assert.deepEqual([r.code, r.err], [2, `${HOOK_WORDS.problems.hook_bare_repository(bare)}\n`]);
  const script = join(s.repo, '.git', 'sonah', 'agent-session.sh');
  await mkdir(join(s.repo, '.git', 'sonah'));
  await writeFile(script, '#!/bin/sh\n# not Sonah\'s\n');
  r = await s.hook(['add']);
  assert.deepEqual([r.code, r.err], [2, `${HOOK_WORDS.problems.hook_file_foreign(script)}\n`]);
  assert.equal(await readFile(script, 'utf8'), '#!/bin/sh\n# not Sonah\'s\n');
  await assert.rejects(lstat(join(s.repo, '.git', 'hooks', 'prepare-commit-msg')));
  r = await s.hook(['remove']);
  assert.equal(await readFile(script, 'utf8'), '#!/bin/sh\n# not Sonah\'s\n', 'remove leaves a file that is not Sonah\'s');
  for (const argv of [[], ['on'], ['add', '--repo'], ['add', '--force'], ['remove', '--repo', s.repo, 'x']]) {
    r = await s.hook(argv);
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.match(r.err, /^usage: sonah hook add\|remove \[--repo DIR\]/);
  }
});

test('sonah doctor prints the link\'s line, and needs the person only when git no longer runs Sonah\'s hook', async (t) => {
  const s = await sandbox(t);
  const line = () => commitLinkLine({ cwd: s.repo, git: s.sealedGit });
  assert.deepEqual(await line(), { state: 'off', route: null, line: HOOK_WORDS.status.off, attention: false });
  assert.equal((await s.hook(['add'])).code, 0);
  assert.deepEqual(await line(), { state: 'on', route: 'runner', line: HOOK_WORDS.status.on.runner, attention: false });
  const hooks = join(s.repo, '.git', 'hooks');
  await rename(join(hooks, 'prepare-commit-msg'), join(hooks, 'prepare-commit-msg.old'));
  await writeFile(join(hooks, 'prepare-commit-msg'), `#!/bin/sh\n${LEFTHOOK_HOOK_CALL} "$@"\n`);
  const moved = await line();
  assert.deepEqual([moved.state, moved.attention], ['moved', true]);
  assert.equal(await commitLinkLine({ cwd: s.home, git: s.sealedGit }), null, 'no line outside a git working tree');
  const result = await doctor({ probe: false }, { env: { HOME: s.home, PATH: '/nonexistent' }, nodeVersion: '20.0.0',
    runCli: async () => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); },
    adapters: async () => ({ claude: { count: 0, where: 'c' }, codex: { count: 0, where: 'x' } }),
    commitLink: async ({ cwd }) => commitLinkLine({ cwd, git: s.sealedGit }), cwd: s.repo });
  assert.ok(result.text.includes(moved.line), result.text);
  assert.ok(result.attention.includes('commit_link'));
  assert.deepEqual(result.facts.commitLink, { state: 'moved', route: null });
});
