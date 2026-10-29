// D142: `sonah skill add` and `sonah skill remove`, the /sonah skill for Claude Code. The skill is the one `!` line
// D142's Claude Code tests settled: `${CLAUDE_SESSION_ID}` (replaced by Claude Code, so no shell variable is left for its
// permission check to refuse), `allowed-tools: Bash(sonah review *)`, `disable-model-invocation: true`, written where
// CLAUDE_CONFIG_DIR puts personal skills. A file is Sonah's only when its bytes are a text Sonah wrote: never written
// over, never deleted otherwise. Every fixture is a private temporary folder; nothing runs a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILLS, SKILL_HARNESSES, SKILL_NAME, SKILL_WORDS, runSkillCommand, skillDoctorLines, skillState, sonahOnPath }
  from '../src/skill.js';
import { doctor } from '../src/doctor.js';

const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
/** Version 1's bytes, as live-tested on Claude Code 2.1.308 (D142's Claude Code tests), written out
 *  here and not read from the module: every skill file that a Sonah with version 1 wrote is Sonah's by these bytes, so
 *  they never change. A new text is a new version, beside this one. */
const V1 = ['---',
  '# Written by sonah skill add (sonah skill, version 1). sonah skill remove deletes it.',
  'name: sonah',
  'description: Review this session with Sonah, in the background. Sonah opens its page when the review ends.',
  'disable-model-invocation: true',
  'allowed-tools: Bash(sonah review *)',
  '---',
  '!`sonah review --session "${CLAUDE_SESSION_ID}" --background`',
  '',
  'Reply with the line above only, word for word.',
  ''].join('\n');
const V1_SHA256 = '6296f52c09a258c5d916e4cd73ff8e402279daad430e6dd9380e0a219d52437d'; // = the live-tested candidate file's
const TEXT = SKILLS.claude.versions.at(-1)['SKILL.md'];
const streams = () => {
  const chunks = { stdout: '', stderr: '' };
  return { chunks, stdout: { write: (t) => { chunks.stdout += t; } }, stderr: { write: (t) => { chunks.stderr += t; } } };
};
/** A home with Claude Code's folder (`.claude`, or `config` as CLAUDE_CONFIG_DIR), and a PATH with or without sonah. */
async function home(t, { configDir = false, sonah = true } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-d142-skill-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const claude = configDir ? join(dir, 'config') : join(dir, '.claude');
  await mkdir(claude, { recursive: true });
  const bin = join(dir, 'bin');
  await mkdir(bin);
  if (sonah) { await writeFile(join(bin, 'sonah'), '#!/bin/sh\n'); await chmod(join(bin, 'sonah'), 0o755); }
  // D171: SONAH_NO_UPDATE_CHECK, so no run here could reach npm's registry (since D171's option A, `skill` never
  // checks; the switch stays, as every test that runs the entry sets it).
  const env = { HOME: dir, PATH: `${bin}:/usr/bin:/bin`, SONAH_NO_UPDATE_CHECK: '1',
    ...(configDir ? { CLAUDE_CONFIG_DIR: claude } : {}) };
  const file = join(claude, 'skills', SKILL_NAME, 'SKILL.md');
  const run = async (argv, extra = {}) => {
    const out = streams();
    const code = await runSkillCommand(argv, { ...out, env, home: dir, ...extra });
    return { code, ...out.chunks };
  };
  return { dir, claude, env, file, run };
}
const W = SKILL_WORDS;
const line = (fn, file) => `${fn('Claude Code', '/sonah', file)}\n`;

test('D142: the skill is the one `!` line, with no shell variable, pre-approved, which only the person starts', () => {
  assert.deepEqual(SKILL_HARNESSES, ['claude'], 'Codex has no skill until one live $sonah run passes');
  // Version 1 is these bytes, whatever version is the newest.
  assert.equal(SKILLS.claude.versions[0]['SKILL.md'], V1);
  assert.equal(createHash('sha256').update(V1).digest('hex'), V1_SHA256);
  assert.equal(TEXT, V1, 'version 1 is the newest');
  const [open, ...rest] = TEXT.split('\n');
  assert.equal(open, '---');
  const close = rest.indexOf('---');
  const front = rest.slice(0, close), body = rest.slice(close + 1);
  // The frontmatter: a YAML comment (the marker, with the version) and plain `key: value` lines.
  assert.match(front[0], /^# Written by sonah skill add \(sonah skill, version 1\)\. sonah skill remove deletes it\.$/);
  for (const row of front.slice(1)) assert.match(row, /^[a-z-]+: \S.*$/, row);
  const keys = Object.fromEntries(front.slice(1).map((row) => [row.slice(0, row.indexOf(':')), row.slice(row.indexOf(':') + 2)]));
  // Exactly these keys, each once: no `user-invocable`, `context`, `agent` or other key changes who starts it or where.
  assert.deepEqual(front.slice(1).map((row) => row.slice(0, row.indexOf(':'))),
    ['name', 'description', 'disable-model-invocation', 'allowed-tools']);
  assert.equal(keys.name, SKILL_NAME);
  assert.equal(keys['disable-model-invocation'], 'true');
  assert.equal(keys['allowed-tools'], 'Bash(sonah review *)');
  // One `!` line: Claude Code replaces ${CLAUDE_SESSION_ID} before the shell; a `$NAME` left for the shell is refused.
  const bang = body.filter((row) => row.startsWith('!'));
  assert.deepEqual(bang, ['!`sonah review --session "${CLAUDE_SESSION_ID}" --background`']);
  assert.equal(/\$[A-Za-z_]/.test(bang[0].replace('${CLAUDE_SESSION_ID}', '')), false);
  // The body is the line and the reply, and nothing that asks the agent to run anything itself.
  assert.deepEqual(body, [bang[0], '', 'Reply with the line above only, word for word.', '']);
});

test('D142: add writes the skill where CLAUDE_CONFIG_DIR puts personal skills, owner-only, then finds it current',
  async (t) => {
    for (const configDir of [false, true]) {
      const h = await home(t, { configDir });
      const first = await h.run(['add']);
      assert.equal(first.code, 0);
      assert.equal(first.stdout, line(W.added, h.file));
      assert.equal(first.stderr, '');
      assert.equal(await readFile(h.file, 'utf8'), TEXT);
      assert.equal((await stat(h.file)).mode & 0o777, 0o600);
      assert.equal((await stat(join(h.claude, 'skills', SKILL_NAME))).mode & 0o777, 0o700);
      if (configDir) await assert.rejects(stat(join(h.dir, '.claude')), { code: 'ENOENT' }, 'not under ~/.claude');
      const again = await h.run(['add']);
      assert.deepEqual([again.code, again.stdout], [0, line(W.current, h.file)]);
      assert.deepEqual(await readdir(join(h.claude, 'skills', SKILL_NAME)), ['SKILL.md']);
    }
  });

test('D142: add says so when sonah is not on the PATH, and adds nothing where Claude Code has no folder', async (t) => {
  const h = await home(t, { sonah: false });
  const r = await h.run(['add']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, `${line(W.added, h.file)}${W.notOnPath}\n`);
  const bare = await home(t, { configDir: true });
  await rm(bare.claude, { recursive: true });
  const none = await bare.run(['add']);
  assert.deepEqual([none.code, none.stdout], [0, `${W.noHome('Claude Code', bare.claude)}\n`]);
  await assert.rejects(stat(bare.claude), { code: 'ENOENT' });
});

test('D142: a file or folder Sonah did not write is never written over or deleted', async (t) => {
  const mine = '---\nname: sonah\ndescription: my own skill\n---\nDo my own thing.\n';
  // The person's own SKILL.md.
  {
    const h = await home(t);
    await mkdir(join(h.claude, 'skills', SKILL_NAME), { recursive: true });
    await writeFile(h.file, mine);
    const add = await h.run(['add']);
    assert.deepEqual([add.code, add.stdout], [1, `${W.foreign('Claude Code', h.file)}\n`]);
    const remove = await h.run(['remove']);
    assert.deepEqual([remove.code, remove.stdout], [1, `${W.keptForeign('Claude Code', h.file)}\n`]);
    assert.equal(await readFile(h.file, 'utf8'), mine);
  }
  // Sonah's SKILL.md beside a file of the person's: the folder is not Sonah's alone.
  {
    const h = await home(t);
    await h.run(['add']);
    const notes = join(h.claude, 'skills', SKILL_NAME, 'notes.md');
    await writeFile(notes, 'mine');
    assert.equal((await h.run(['remove'])).code, 1);
    assert.equal(await readFile(h.file, 'utf8'), TEXT);
    assert.equal(await readFile(notes, 'utf8'), 'mine');
    assert.equal((await h.run(['add'])).code, 1);
  }
  // A folder that is a symbolic link, and a file where the folder should be.
  {
    const h = await home(t);
    const elsewhere = join(h.dir, 'elsewhere');
    await mkdir(elsewhere);
    await mkdir(join(h.claude, 'skills'), { recursive: true });
    await symlink(elsewhere, join(h.claude, 'skills', SKILL_NAME));
    assert.equal((await h.run(['add'])).code, 1);
    assert.deepEqual(await readdir(elsewhere), []);
    await rm(join(h.claude, 'skills', SKILL_NAME));
    await writeFile(join(h.claude, 'skills', SKILL_NAME), 'a file');
    assert.equal((await h.run(['add'])).code, 1);
    assert.equal((await h.run(['remove'])).code, 1);
    assert.equal(await readFile(join(h.claude, 'skills', SKILL_NAME), 'utf8'), 'a file');
  }
});

test('D142: remove deletes only Sonah\'s file and its folder, and says when there is none', async (t) => {
  const h = await home(t);
  const absent = await h.run(['remove']);
  assert.deepEqual([absent.code, absent.stdout], [0, line(W.absent, h.file)]);
  await h.run(['add']);
  await writeFile(join(h.claude, 'skills', 'other-skill.md'), 'kept');
  const removed = await h.run(['remove']);
  assert.deepEqual([removed.code, removed.stdout], [0, line(W.removed, h.file)]);
  assert.deepEqual(await readdir(join(h.claude, 'skills')), ['other-skill.md']);
});

test('D142: an earlier version of Sonah\'s skill is updated by add and deleted by remove', async (t) => {
  const old = '---\nname: sonah\n---\nan earlier text\n';
  const skills = { claude: { ...SKILLS.claude, versions: [{ 'SKILL.md': old }, SKILLS.claude.versions.at(-1)] } };
  const h = await home(t);
  await mkdir(join(h.claude, 'skills', SKILL_NAME), { recursive: true });
  await writeFile(h.file, old);
  assert.equal((await skillState('claude', { env: h.env, home: h.dir }, skills)).state, 'older');
  const updated = await h.run(['add'], { skills });
  assert.deepEqual([updated.code, updated.stdout], [0, line(W.updated, h.file)]);
  assert.equal(await readFile(h.file, 'utf8'), TEXT);
  await writeFile(h.file, old);
  assert.equal((await h.run(['remove'], { skills })).code, 0);
  await assert.rejects(stat(h.file), { code: 'ENOENT' });
});

test('D142: the command\'s grammar is strict, and --help writes nothing', async (t) => {
  const h = await home(t);
  for (const argv of [[], ['add', 'extra'], ['install'], ['remove', '--force']]) {
    const r = await h.run(argv);
    assert.deepEqual([r.code, r.stdout, r.stderr], [2, '', 'usage: sonah skill add|remove\n'], argv.join(' '));
  }
  // The real binary, as the person runs it: --help is answered before the command runs.
  const exec = promisify(execFile);
  for (const argv of [['skill', 'add', '--help'], ['skill', 'remove', '-h'], ['skill', '--help']]) {
    const r = await exec(process.execPath, [BIN, ...argv], { env: h.env, cwd: h.dir });
    assert.match(r.stdout, /sonah skill add/);
  }
  await assert.rejects(stat(join(h.claude, 'skills')), { code: 'ENOENT' }, 'no skill was written');
  const added = await exec(process.execPath, [BIN, 'skill', 'add'], { env: h.env, cwd: h.dir });
  assert.match(added.stdout, /^Added the \/sonah skill for Claude Code/);
  assert.equal(await readFile(h.file, 'utf8'), TEXT);
});

test('D142: doctor says whether the skill is added and current, and needs you when it cannot run sonah', async (t) => {
  const D = W.doctor;
  const h = await home(t);
  assert.deepEqual(await skillDoctorLines({ env: h.env, home: h.dir }), { lines: [D.none('Claude Code', '/sonah')],
    attention: false });
  await h.run(['add']);
  assert.deepEqual(await skillDoctorLines({ env: h.env, home: h.dir }),
    { lines: [D.current('Claude Code', '/sonah', h.file)], attention: false });
  const noSonah = { ...h.env, PATH: '/usr/bin:/bin' };
  assert.equal(await sonahOnPath(noSonah), null);
  assert.deepEqual(await skillDoctorLines({ env: noSonah, home: h.dir }),
    { lines: [D.current('Claude Code', '/sonah', h.file), D.noPath('/sonah')], attention: true });
  await writeFile(h.file, 'my own');
  assert.deepEqual(await skillDoctorLines({ env: h.env, home: h.dir }),
    { lines: [D.foreign('Claude Code', '/sonah', h.file)], attention: false });
  // Through doctor itself, with no model check: the skill's lines are among its lines, and a skill that cannot run
  // sonah needs you.
  const missing = () => Promise.reject(Object.assign(new Error('absent'), { code: 'ENOENT' }));
  const run = (env) => doctor({ probe: false }, { env, home: h.dir, nodeVersion: '20.0.0', runCli: missing,
    adapters: async () => ({ claude: { count: 1, where: 'claude' }, codex: { count: 0, where: 'codex' } }) });
  await writeFile(h.file, TEXT);
  const ready = await run(h.env);
  assert.ok(ready.text.split('\n').includes(D.current('Claude Code', '/sonah', h.file)), ready.text);
  assert.ok(!ready.attention.includes('skill'));
  const stuck = await run(noSonah);
  assert.ok(stuck.text.split('\n').includes(D.noPath('/sonah')), stuck.text);
  assert.ok(stuck.attention.includes('skill'));
});

test('D142: a folder that holds none of the skill\'s files is no skill: added, not updated; never deleted', async (t) => {
  const D = W.doctor;
  const h = await home(t);
  const folder = join(h.claude, 'skills', SKILL_NAME);
  await mkdir(folder, { recursive: true });
  const where = { env: h.env, home: h.dir };
  assert.equal((await skillState('claude', where)).state, 'none');
  assert.deepEqual(await skillDoctorLines(where), { lines: [D.none('Claude Code', '/sonah')], attention: false });
  const noSonah = { ...h.env, PATH: '/usr/bin:/bin' };
  assert.deepEqual(await skillDoctorLines({ env: noSonah, home: h.dir }), { lines: [D.none('Claude Code', '/sonah')],
    attention: false }, 'no need for a skill that is not there');
  const removed = await h.run(['remove']);
  assert.deepEqual([removed.code, removed.stdout], [0, line(W.absent, h.file)]);
  assert.deepEqual(await readdir(folder), [], 'the folder Sonah\'s file is not in is left');
  const added = await h.run(['add']);
  assert.deepEqual([added.code, added.stdout], [0, line(W.added, h.file)]);
  assert.equal(await readFile(h.file, 'utf8'), V1);
});

test('D142: a skill file of Sonah\'s that someone edited is not Sonah\'s any more, and is said as such', async (t) => {
  const h = await home(t);
  await h.run(['add']);
  const edited = V1.replace('Sonah opens its page', 'Sonah shows its page');
  await writeFile(h.file, edited);
  const add = await h.run(['add']);
  assert.deepEqual([add.code, add.stdout], [1, `${W.foreign('Claude Code', h.file)}\n`]);
  assert.match(add.stdout, /is not as Sonah wrote it/);
  assert.equal((await h.run(['remove'])).code, 1);
  assert.equal(await readFile(h.file, 'utf8'), edited);
});

test('D142: doctor reads the skill where CLAUDE_CONFIG_DIR puts it, and says nothing where Claude Code has no folder',
  async (t) => {
    const D = W.doctor;
    const h = await home(t, { configDir: true });
    await h.run(['add']);
    assert.deepEqual(await skillDoctorLines({ env: h.env, home: h.dir }),
      { lines: [D.current('Claude Code', '/sonah', h.file)], attention: false });
    // A skill under ~/.claude is not the one this Claude Code reads.
    await mkdir(join(h.dir, '.claude'));
    const unset = { ...h.env }; delete unset.CLAUDE_CONFIG_DIR;
    assert.deepEqual(await skillDoctorLines({ env: unset, home: h.dir }), { lines: [D.none('Claude Code', '/sonah')],
      attention: false });
    await rm(join(h.dir, '.claude'), { recursive: true });
    assert.deepEqual(await skillDoctorLines({ env: unset, home: h.dir }), { lines: [], attention: false });
  });

test('D142: an earlier version of the skill that cannot run sonah needs you too', async (t) => {
  const old = '---\nname: sonah\n---\nan earlier text\n';
  const skills = { claude: { ...SKILLS.claude, versions: [{ 'SKILL.md': old }, SKILLS.claude.versions.at(-1)] } };
  const h = await home(t, { sonah: false });
  await mkdir(join(h.claude, 'skills', SKILL_NAME), { recursive: true });
  await writeFile(h.file, old);
  assert.deepEqual(await skillDoctorLines({ env: h.env, home: h.dir, skills }), { lines: [
    W.doctor.older('Claude Code', '/sonah', h.file), W.doctor.noPath('/sonah')], attention: true });
});

test('D142: a skill that cannot be written exits 3 and says which folder; a folder named sonah on the PATH is no command',
  async (t) => {
    const h = await home(t);
    await mkdir(join(h.claude, 'skills'), { recursive: true });
    await chmod(join(h.claude, 'skills'), 0o500);
    t.after(() => chmod(join(h.claude, 'skills'), 0o700).catch(() => {}));
    const r = await h.run(['add']);
    assert.equal(r.code, 3);
    assert.equal(r.stderr, `${W.failed(join(h.claude, 'skills', SKILL_NAME))}\n`);
    assert.equal(r.stdout, '', 'no PATH note after a failed write');
    await chmod(join(h.claude, 'skills'), 0o700);
    // A folder named sonah first on the PATH, and no command: the note says so.
    const dirs = join(h.dir, 'dirs');
    await mkdir(join(dirs, 'sonah'), { recursive: true });
    const env = { ...h.env, PATH: `${dirs}:/usr/bin:/bin` };
    assert.equal(await sonahOnPath(env), null);
    const out = await h.run(['add'], { env });
    assert.equal(out.stdout, `${line(W.added, h.file)}${W.notOnPath}\n`);
  });
