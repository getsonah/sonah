// D142 (the owner, 2026-10-23: a personal skill only, no marketplace file): `sonah skill add`
// and `sonah skill remove`. They write and delete Claude Code's skill that lets a person type `/sonah` when the agent says
// it is done: the skill runs `sonah review --session <the session's own id> --background` and the agent replies with the
// one line it prints (session-review-command.js `SESSION_ID_WORDS`).
//
// The skill's text is fixed here, so it ships with the code. Claude Code runs it as a `!` line, before the agent sees the
// skill: `${CLAUDE_SESSION_ID}` is replaced by Claude Code with the session's id, and `allowed-tools` lets `sonah review`
// run without a prompt during the turn the skill opens (D142's Claude Code tests, 2.1.308: a `!` line that holds a shell
// variable is refused, and one that exits non-zero hides its line from the agent, so the line names no variable and
// `--background` always exits 0). `disable-model-invocation` keeps the agent from starting the skill on its own.
//
// A file is Sonah's only when its bytes are, byte for byte, a text this module wrote (any version): `add` never writes
// over another file, `remove` never deletes one, and neither touches a folder that holds anything else. No clock, no
// network, no model.
import { constants } from 'node:fs';
import { access, lstat, mkdir, open, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { claudeConfigDir } from './claude-home.js';
import { SONAH_SKILL_NAMES } from '../../slicer/src/labels.js';

/** The version of the skill's text, in its marker line. */
export const SKILL_VERSION = 1;
/** The name the person types (`/sonah`), and the folder of the skill: the first of Sonah's own skill names, which the
 *  slicer owns (labels.js `SONAH_SKILL_NAMES`) and reads in a recorded command element. */
export const SKILL_NAME = SONAH_SKILL_NAMES[0];
/** `sonah skill`'s usage line. */
export const SKILL_USAGE = 'sonah skill add|remove';

/** Claude Code's skill, version 1: one `!` line, and the agent's reply. Its bytes never change: a skill file is Sonah's
 *  only when its bytes are one version's text, so a new text is a new version, beside this one. */
const CLAUDE_SKILL_V1 = ['---',
  '# Written by sonah skill add (sonah skill, version 1). sonah skill remove deletes it.', 'name: sonah',
  'description: Review this session with Sonah, in the background. Sonah opens its page when the review ends.',
  'disable-model-invocation: true', 'allowed-tools: Bash(sonah review *)', '---',
  '!`sonah review --session "${CLAUDE_SESSION_ID}" --background`', '',
  'Reply with the line above only, word for word.', ''].join('\n');

/** Each harness's skill: where its folder is, and its files by version (a path in the folder, its text). The folder
 *  holds nothing else. `home` is where the folder's parent is found; a harness whose `home` is not there gets none.
 *  Only Claude Code has one. */
export const SKILLS = Object.freeze({
  claude: Object.freeze({
    name: 'Claude Code', typed: `/${SKILL_NAME}`,
    home: ({ env, home }) => claudeConfigDir({ env, home }),
    folder: ({ env, home }) => join(claudeConfigDir({ env, home }), 'skills', SKILL_NAME),
    versions: Object.freeze([Object.freeze({ 'SKILL.md': CLAUDE_SKILL_V1 })]),
  }),
});
/** The harnesses `sonah skill add` writes a skill for, in order. */
export const SKILL_HARNESSES = Object.freeze(Object.keys(SKILLS));

/** The words `sonah skill` and `sonah doctor` print: a skill's state, where it is, and what to do. */
export const SKILL_WORDS = Object.freeze({
  added: (name, typed, path) => `Added the ${typed} skill for ${name}: ${path}. Type ${typed} in a new ${name} `
    + 'session, after the agent finishes its work.',
  updated: (name, typed, path) => `Updated the ${typed} skill for ${name} to this version of Sonah: ${path}.`,
  current: (name, typed, path) => `The ${typed} skill for ${name} is there already, and current: ${path}.`,
  foreign: (name, path) => `${path} is not as Sonah wrote it, so Sonah changed nothing there for ${name}. Move that file `
    + 'or folder away, then run sonah skill add again.',
  noHome: (name, path) => `Sonah added no skill for ${name}, because its folder ${path} is not there.`,
  removed: (name, typed, path) => `Removed the ${typed} skill for ${name}: ${path}.`,
  absent: (name, typed, path) => `Sonah found no ${typed} skill of its own for ${name} at ${path}.`,
  keptForeign: (name, path) => `${path} is not as Sonah wrote it, so Sonah deleted nothing there for ${name}.`,
  notOnPath: 'The skill runs sonah by name, and Sonah found no sonah command on this PATH. Install Sonah with npm '
    + 'install -g getsonah. Or add the folder of the sonah command to the PATH of your agent.',
  failed: (path) => `Sonah could not write or delete ${path}. Check that the folder is yours and writable.`,
  doctor: Object.freeze({
    current: (name, typed, path) => `${typed} skill (${name}): added, current (${path}).`,
    older: (name, typed, path) => `${typed} skill (${name}): added by an earlier Sonah (${path}). Update it with sonah `
      + 'skill add.',
    none: (name, typed) => `${typed} skill (${name}): not added. Add it with sonah skill add.`,
    foreign: (name, typed, path) => `${typed} skill (${name}): ${path} is not as Sonah wrote it.`,
    noPath: (typed) => `${typed} skill: Sonah found no sonah command on this PATH, so the skill cannot run it. Fix: `
      + 'install Sonah with npm install -g getsonah, or add the folder of the sonah command to your PATH.',
  }),
});
/** The kind of each word table here, for the style linter (packages/render/test/style-lint.js). */
export const STYLE_KINDS = Object.freeze({ SKILL_WORDS: 'notice' });
const P = '/agent-config/skills/sonah/SKILL.md';
export const STYLE_FIXTURES = Object.freeze({
  ...Object.fromEntries(['added', 'updated', 'current', 'removed', 'absent'].map((key) =>
    [`SKILL_WORDS.${key}`, [['Claude Code', '/sonah', P]]])),
  'SKILL_WORDS.foreign': [['Claude Code', P]], 'SKILL_WORDS.noHome': [['Claude Code', '/agent-config']],
  'SKILL_WORDS.keptForeign': [['Claude Code', P]], 'SKILL_WORDS.failed': [[P]],
  ...Object.fromEntries(['current', 'older', 'foreign'].map((key) => [`SKILL_WORDS.doctor.${key}`,
    [['Claude Code', '/sonah', P]]])),
  'SKILL_WORDS.doctor.none': [['Claude Code', '/sonah']], 'SKILL_WORDS.doctor.noPath': [['/sonah']],
});

const plainFile = async (path) => {
  try { const entry = await lstat(path); return entry.isFile() ? 'file' : 'other'; }
  catch (error) { if (error?.code === 'ENOENT') return 'absent'; throw error; }
};
const readOwn = async (path) => {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    return await handle.readFile('utf8');
  } finally { await handle?.close().catch(() => {}); }
};
/** The folders a skill's files name below its folder (a file `a/b.txt` names `a`). */
const foldersOf = (paths) => [...new Set(paths.flatMap((path) => {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}))];

/**
 * What a harness's skill is now: `{ state, folder, file }`. `state` is `none` (no folder, or a folder of its own that
 * holds none of the skill's files), `current` (each file is this version's), `older` (each file present is Sonah's, of
 * some version, at least one is present, and one is not this version's or is missing), or `foreign` (the folder, or
 * something in it, is not as Sonah wrote it: `file` names it).
 */
export async function skillState(harness, where, skills = SKILLS) {
  const skill = skills[harness];
  const folder = skill.folder(where);
  const current = skill.versions.at(-1);
  const paths = Object.keys(current);
  const own = new Set([...paths, ...foldersOf(paths)]);
  const kind = await plainFile(folder);
  if (kind === 'absent') return { state: 'none', folder, file: null };
  if (kind !== 'other' || !(await lstat(folder)).isDirectory()) return { state: 'foreign', folder, file: folder };
  // Everything in the folder must be one of the skill's own names.
  const walk = async (dir, prefix) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!own.has(name)) return join(folder, name);
      if (entry.isDirectory()) { const found = await walk(join(dir, entry.name), name); if (found) return found; }
      else if (!entry.isFile()) return join(folder, name);
    }
    return null;
  };
  const stranger = await walk(folder, '');
  if (stranger) return { state: 'foreign', folder, file: stranger };
  let isCurrent = true, present = 0;
  for (const path of paths) {
    const file = join(folder, path);
    const there = await plainFile(file);
    if (there === 'absent') { isCurrent = false; continue; }
    present++;
    if (there !== 'file') return { state: 'foreign', folder, file };
    const text = await readOwn(file);
    if (text === current[path]) continue;
    if (!skill.versions.some((version) => version[path] === text)) return { state: 'foreign', folder, file };
    isCurrent = false;
  }
  // A folder that holds none of the skill's files is no skill: `add` adds one, `remove` leaves the folder.
  if (present === 0) return { state: 'none', folder, file: null };
  return { state: isCurrent ? 'current' : 'older', folder, file: join(folder, paths[0]) };
}

/** Writes `text` at `path` whole: a new file beside it (owner-only), then renamed over it. */
async function writeWhole(path, text) {
  const temporary = `${path}.${process.pid}.tmp`;
  let handle;
  try {
    handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0), 0o600);
    await handle.writeFile(text, 'utf8');
    await handle.close(); handle = null;
    await rename(temporary, path);
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** The `sonah` command on `env.PATH`, or null: the name the skill runs. */
export async function sonahOnPath(env = process.env) {
  for (const dir of String(env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, 'sonah');
    try { await access(candidate, constants.X_OK); if ((await lstat(candidate)).isDirectory()) continue; return candidate; }
    catch { /* not here */ }
  }
  return null;
}

/** Adds (or updates) one harness's skill: `{ outcome, line }`, `outcome` one of added, updated, current, foreign,
 *  noHome. */
async function addSkill(harness, where, skills) {
  const skill = skills[harness];
  const W = SKILL_WORDS;
  if (await plainFile(skill.home(where)) === 'absent') return { outcome: 'noHome', line: W.noHome(skill.name, skill.home(where)) };
  const found = await skillState(harness, where, skills);
  if (found.state === 'foreign') return { outcome: 'foreign', line: W.foreign(skill.name, found.file) };
  if (found.state === 'current') return { outcome: 'current', line: W.current(skill.name, skill.typed, found.file) };
  const current = skill.versions.at(-1);
  for (const folder of [found.folder, ...foldersOf(Object.keys(current)).map((path) => join(found.folder, path))])
    await mkdir(folder, { recursive: true, mode: 0o700 });
  for (const [path, text] of Object.entries(current)) await writeWhole(join(found.folder, path), text);
  const file = join(found.folder, Object.keys(current)[0]);
  return found.state === 'none' ? { outcome: 'added', line: W.added(skill.name, skill.typed, file) }
    : { outcome: 'updated', line: W.updated(skill.name, skill.typed, file) };
}

/** Removes one harness's skill, only when every file there is Sonah's: `{ outcome, line }`, `outcome` one of removed,
 *  absent, foreign. Its folders go when nothing else is in them. */
async function removeSkill(harness, where, skills) {
  const skill = skills[harness];
  const W = SKILL_WORDS;
  const found = await skillState(harness, where, skills);
  const first = join(found.folder, Object.keys(skill.versions.at(-1))[0]);
  if (found.state === 'none') return { outcome: 'absent', line: W.absent(skill.name, skill.typed, first) };
  if (found.state === 'foreign') return { outcome: 'foreign', line: W.keptForeign(skill.name, found.file) };
  const paths = Object.keys(skill.versions.at(-1));
  for (const path of paths) await rm(join(found.folder, path), { force: true });
  for (const folder of [...foldersOf(paths).reverse().map((path) => join(found.folder, path)), found.folder]) {
    try { await rmdir(folder); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  return { outcome: 'removed', line: W.removed(skill.name, skill.typed, first) };
}

/**
 * `sonah skill add` and `sonah skill remove`: one line per harness, then (add) whether `sonah` is on this PATH. Exit 0
 * when every harness's skill is as asked (or there is nothing to do), 1 when a file Sonah did not write stood in the way
 * (nothing of it was changed), 2 for a usage error, 3 when a file could not be written or deleted.
 */
export async function runSkillCommand(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env,
  home = env.HOME ?? homedir(), harnesses = SKILL_HARNESSES, skills = SKILLS } = {}) {
  if (argv.length !== 1 || !['add', 'remove'].includes(argv[0])) {
    stderr.write(`usage: ${SKILL_USAGE}\n`);
    return 2;
  }
  const where = { env, home };
  let code = 0;
  for (const harness of harnesses) {
    try {
      const { outcome, line } = await (argv[0] === 'add' ? addSkill : removeSkill)(harness, where, skills);
      stdout.write(`${line}\n`);
      if (outcome === 'foreign') code = Math.max(code, 1);
    } catch {
      stderr.write(`${SKILL_WORDS.failed(skills[harness].folder(where))}\n`);
      code = 3;
    }
  }
  if (argv[0] === 'add' && code !== 3 && await sonahOnPath(env) === null) stdout.write(`${SKILL_WORDS.notOnPath}\n`);
  return code;
}

/** `sonah doctor`'s lines for the skills: one per harness whose folder is there, then a line when an added skill could
 *  not run `sonah` from this PATH. `attention` is true only for the latter: a skill of the person's own named sonah is
 *  theirs to keep. */
export async function skillDoctorLines({ env = process.env, home = env.HOME ?? homedir(), skills = SKILLS } = {}) {
  const where = { env, home };
  const D = SKILL_WORDS.doctor;
  const lines = [];
  let attention = false, added = false;
  for (const harness of Object.keys(skills)) {
    const skill = skills[harness];
    if (await plainFile(skill.home(where)).catch(() => 'absent') === 'absent') continue;
    let found;
    try { found = await skillState(harness, where, skills); } catch { found = { state: 'foreign', file: skill.folder(where) }; }
    if (found.state === 'none') lines.push(D.none(skill.name, skill.typed));
    else if (found.state === 'foreign') lines.push(D.foreign(skill.name, skill.typed, found.file));
    else {
      added = true;
      lines.push((found.state === 'current' ? D.current : D.older)(skill.name, skill.typed, found.file));
    }
  }
  if (added && await sonahOnPath(env) === null) { lines.push(D.noPath(`/${SKILL_NAME}`)); attention = true; }
  return { lines, attention };
}

