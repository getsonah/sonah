// Owner decision 2026-10-14 (the first release): the code step is on by default, with a quick switch. Sonah's own
// settings file, `config.json` in Sonah's folder (SONAH_HOME, else ~/.sonah), holds one setting, `codePass`:
// `sonah config code-pass on|off` writes it and `sonah config` shows it. For one review, `--code-pass` or
// `--no-code-pass` overrides it. Precedence: the flag, then the file, then the default (on).
//
// The file is the person's own. One that is not a regular file they own, that someone else can write, or that is not
// exactly this shape is not read as a setting (`invalid`): a review given no flag then stops before it reads or sends
// anything (`config_invalid`), rather than guess whether to send the files, and `sonah config code-pass on|off` writes
// the file again. The session's requests are the same bytes whichever way it is set: the setting only decides whether
// the code step runs after the session's review.
import { constants } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { strictJson } from '../../slicer/src/strict-json.js';

/** The settings file's version, written as its `version` key. */
export const SETTINGS_VERSION = 1;
/** Owner decision 2026-10-14: the code step runs unless the person turns it off. */
export const CODE_PASS_DEFAULT = true;
/** Where the code step's setting for one review came from, in precedence order: closed. */
export const CODE_PASS_SOURCES = Object.freeze(['flag', 'config', 'default']);
/** The settings file's name in Sonah's folder. */
export const SETTINGS_FILE = 'config.json';
/** The settings file holds two keys; anything larger is not this file. */
const MAX_SETTINGS_BYTES = 4096;
/** `sonah config`'s usage line. */
export const CONFIG_USAGE = 'sonah config [code-pass on|off]';

const failure = (code) => Object.assign(new Error(code), { code });

/** Sonah's folder: SONAH_HOME, else `.sonah` in the home folder (as the review's state and stored answers). */
export function sonahHome({ env = process.env, home = env.HOME ?? homedir() } = {}) {
  return env.SONAH_HOME ?? join(home, '.sonah');
}
/** The settings file's path. */
export const settingsPath = (where = {}) => join(sonahHome(where), SETTINGS_FILE);

const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** The settings a file's text holds, or null when it is not exactly `{ "version": 1, "codePass": true|false }` (the
 *  setting may be absent). */
export function parseSettings(text) {
  const parsed = strictJson(text);
  if (!parsed.json || !parsed.strict || !plainObject(parsed.value)) return null;
  const { version, codePass, ...rest } = parsed.value;
  if (version !== SETTINGS_VERSION || Object.keys(rest).length) return null;
  if (codePass !== undefined && typeof codePass !== 'boolean') return null;
  return codePass === undefined ? {} : { codePass };
}

/** Reads the settings file: `{ state: 'absent' }` when there is none, `{ state: 'ok', settings }`, or
 *  `{ state: 'invalid' }` (not a regular file of the person's, writable by others, too large, unreadable or not this
 *  shape). A link is never followed. */
export async function readSettings(where = {}) {
  let file;
  try {
    file = await open(settingsPath(where), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await file.stat();
    if (!stat.isFile() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      || (stat.mode & 0o022) !== 0 || stat.size > MAX_SETTINGS_BYTES) return { state: 'invalid' };
    const settings = parseSettings(await file.readFile('utf8'));
    return settings === null ? { state: 'invalid' } : { state: 'ok', settings };
  } catch (error) {
    return error?.code === 'ENOENT' ? { state: 'absent' } : { state: 'invalid' };
  } finally { await file?.close().catch(() => {}); }
}

/** Writes `codePass` to the settings file, owner-only (0600 in a 0700 folder), replacing the whole file at once: a new
 *  file beside it, then renamed over it, so a reader never sees half of one. An unreadable file is replaced. */
export async function writeCodePass(on, where = {}) {
  if (typeof on !== 'boolean') throw failure('usage');
  const dir = sonahHome(where);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, SETTINGS_FILE);
  const temporary = join(dir, `.${SETTINGS_FILE}.${process.pid}.tmp`);
  const text = `${JSON.stringify({ version: SETTINGS_VERSION, codePass: on })}\n`;
  let file;
  try {
    file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL
      | (constants.O_NOFOLLOW ?? 0), 0o600);
    await file.writeFile(text, 'utf8');
    await file.close(); file = null;
    await rename(temporary, target);
  } catch (error) {
    await file?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return target;
}

/**
 * Whether the code step runs in one review, and why: `{ on, source }`, `source` one of CODE_PASS_SOURCES. `flag` is the
 * review's `--code-pass` (true) or `--no-code-pass` (false), else undefined. With a flag the file is not read; with none,
 * an unreadable file stops the review (`config_invalid`).
 */
export async function resolveCodePass({ flag, ...where } = {}) {
  if (flag === true || flag === false) return { on: flag, source: 'flag' };
  const read = await readSettings(where);
  if (read.state === 'invalid') throw failure('config_invalid');
  if (read.state === 'ok' && typeof read.settings.codePass === 'boolean')
    return { on: read.settings.codePass, source: 'config' };
  return { on: CODE_PASS_DEFAULT, source: 'default' };
}

/** What `sonah config` and `sonah doctor` say about the code step's setting, after `label`: fixed words and the file's
 *  path. */
export function codePassSettingLine(read, path, label = 'code-pass') {
  if (read.state === 'invalid') return `${label}: the settings file ${path} could not be read. Fix: run sonah config `
    + 'code-pass on or sonah config code-pass off to write it again.';
  const set = read.state === 'ok' && typeof read.settings.codePass === 'boolean';
  const on = set ? read.settings.codePass : CODE_PASS_DEFAULT;
  return `${label}: ${on ? 'on' : 'off'} (${set ? `set in ${path}` : 'the default'}). ${on
    ? 'A review also runs the code step: a review agent reads the repository with read-only tools and reviews the '
      + 'session\'s change.'
    : 'A review reads and sends the session only.'} Change it with sonah config code-pass ${on ? 'off' : 'on'}, or for `
    + `one review with ${on ? '--no-code-pass' : '--code-pass'}.`;
}

/** `sonah config`: shows the settings (exit 0, or 1 when the file cannot be read); `sonah config code-pass on|off` sets
 *  the code step's (exit 0, or 3 when it cannot be written). Anything else is a usage error (exit 2). */
export async function runConfigCommand(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env,
  home = env.HOME ?? homedir() } = {}) {
  const where = { env, home };
  const path = settingsPath(where);
  if (argv.length === 0) {
    const read = await readSettings(where);
    stdout.write(`${codePassSettingLine(read, path)}\n`);
    return read.state === 'invalid' ? 1 : 0;
  }
  if (argv.length !== 2 || argv[0] !== 'code-pass' || !['on', 'off'].includes(argv[1])) {
    stderr.write(`usage: ${CONFIG_USAGE}\n`);
    return 2;
  }
  try { await writeCodePass(argv[1] === 'on', where); }
  catch {
    stderr.write(`sonah config: the settings file ${path} could not be written. Fix: check that the folder is yours `
      + 'and writable, or set SONAH_HOME to one that is.\n');
    return 3;
  }
  stdout.write(`${codePassSettingLine(await readSettings(where), path)}\n`);
  return 0;
}
