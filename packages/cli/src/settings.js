// Owner decision 2026-10-14 (the first release): the code step is on by default, with a quick switch. Sonah's own
// settings file, `config.json` in Sonah's folder (SONAH_HOME, else ~/.sonah), holds one setting, `codePass`:
// `sonah config code-pass on|off` writes it and `sonah config` shows it. For one review, `--code-pass` or
// `--no-code-pass` overrides it. Precedence: the flag, then the file, then the default (on).
// D171 (the owner, 2026-10-28: the update notice, on by default): the update check's setting, written by `sonah config
// update-check on|off` and shown by `sonah config` (update-check.js says what the check does), in a file of its own,
// `update-check-setting.json` (`{ "version": 1, "updateCheck": true|false }`), read by the same rules as config.json.
// config.json stays exactly as before D171, so a Sonah older than beta.10 still reads it, and writing one setting never
// rewrites the other (D171 fix round). SONAH_NO_UPDATE_CHECK, then CI, turn the check off before its file is read; a
// file that cannot be read turns it off too.
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
/** A settings file holds two keys; anything larger is not this file. */
const MAX_SETTINGS_BYTES = 4096;
/** `sonah config`'s usage line. */
export const CONFIG_USAGE = 'sonah config [code-pass|update-check on|off]';
/** D171: the update check runs unless the person turns it off. */
export const UPDATE_CHECK_DEFAULT = true;
/** D171: where the update check's setting came from, in precedence order: closed. `env` is SONAH_NO_UPDATE_CHECK set
 *  to anything but the empty string, `ci` is CI set so, `config` its settings file, `invalid` that file when it cannot
 *  be read (the check is off). */
export const UPDATE_CHECK_SOURCES = Object.freeze(['env', 'ci', 'config', 'invalid', 'default']);
/** D171: the update check's settings file in Sonah's folder (written only by `sonah config update-check on|off`). */
export const UPDATE_CHECK_SETTING_FILE = 'update-check-setting.json';
/** The settings `sonah config` writes, by the word on its command line. Closed. */
const SETTING_WORDS = Object.freeze(['code-pass', 'update-check']);

const failure = (code) => Object.assign(new Error(code), { code });

/** Sonah's folder: SONAH_HOME, else `.sonah` in the home folder (as the review's state and stored answers). */
export function sonahHome({ env = process.env, home = env.HOME ?? homedir() } = {}) {
  return env.SONAH_HOME ?? join(home, '.sonah');
}
/** The settings file's path. */
export const settingsPath = (where = {}) => join(sonahHome(where), SETTINGS_FILE);
/** D171: the update check's settings file's path. */
export const updateCheckSettingPath = (where = {}) => join(sonahHome(where), UPDATE_CHECK_SETTING_FILE);

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
/** D171: the update check's setting a file's text holds, or null when it is not exactly `{ "version": 1,
 *  "updateCheck": true|false }`. */
export function parseUpdateCheckSetting(text) {
  const parsed = strictJson(text);
  if (!parsed.json || !parsed.strict || !plainObject(parsed.value)) return null;
  const { version, updateCheck, ...rest } = parsed.value;
  if (version !== SETTINGS_VERSION || Object.keys(rest).length || typeof updateCheck !== 'boolean') return null;
  return { updateCheck };
}

/** Reads the settings file: `{ state: 'absent' }` when there is none, `{ state: 'ok', settings }`, or
 *  `{ state: 'invalid' }` (not a regular file of the person's, writable by others, too large, unreadable or not this
 *  shape). A link is never followed. */
export const readSettings = (where = {}) => readOwnFile(settingsPath(where), parseSettings);
/** D171: reads the update check's settings file the same way. */
export const readUpdateCheckSetting = (where = {}) => readOwnFile(updateCheckSettingPath(where),
  parseUpdateCheckSetting);

/** One settings file at `path`, its text read by `parse`. */
async function readOwnFile(path, parse) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await file.stat();
    if (!stat.isFile() || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
      || (stat.mode & 0o022) !== 0 || stat.size > MAX_SETTINGS_BYTES) return { state: 'invalid' };
    const settings = parse(await file.readFile('utf8'));
    return settings === null ? { state: 'invalid' } : { state: 'ok', settings };
  } catch (error) {
    return error?.code === 'ENOENT' ? { state: 'absent' } : { state: 'invalid' };
  } finally { await file?.close().catch(() => {}); }
}

/** Writes `codePass` to the settings file, owner-only (0600 in a 0700 folder), replacing the whole file at once: a new
 *  file beside it, then renamed over it, so a reader never sees half of one. An unreadable file is replaced. */
export async function writeCodePass(on, where = {}) {
  if (typeof on !== 'boolean') throw failure('usage');
  return writeOwnFile(SETTINGS_FILE, { version: SETTINGS_VERSION, codePass: on }, where);
}
/** D171: writes `updateCheck` to its own settings file the same way; config.json is not touched. */
export async function writeUpdateCheck(on, where = {}) {
  if (typeof on !== 'boolean') throw failure('usage');
  return writeOwnFile(UPDATE_CHECK_SETTING_FILE, { version: SETTINGS_VERSION, updateCheck: on }, where);
}

/** `value` as one line of JSON in the file `name` of Sonah's folder, whole, owner-only. */
async function writeOwnFile(name, value, where) {
  const dir = sonahHome(where);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, name);
  const temporary = join(dir, `.${name}.${process.pid}.tmp`);
  const text = `${JSON.stringify(value)}\n`;
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

/**
 * D171: whether the update check runs, and why: `{ on, source }`, `source` one of UPDATE_CHECK_SOURCES.
 * SONAH_NO_UPDATE_CHECK and CI are read first, so with either set the file is not read; `read` is its settings file as
 * readUpdateCheckSetting read it, read here when not given. A file that cannot be read turns the check off: the person
 * may have turned it off in it. config.json is never read for it.
 */
export async function resolveUpdateCheck({ env = process.env, read, ...where } = {}) {
  if (typeof env.SONAH_NO_UPDATE_CHECK === 'string' && env.SONAH_NO_UPDATE_CHECK !== '')
    return { on: false, source: 'env' };
  if (typeof env.CI === 'string' && env.CI !== '') return { on: false, source: 'ci' };
  const file = read ?? await readUpdateCheckSetting({ env, ...where });
  if (file.state === 'invalid') return { on: false, source: 'invalid' };
  if (file.state === 'ok' && typeof file.settings.updateCheck === 'boolean')
    return { on: file.settings.updateCheck, source: 'config' };
  return { on: UPDATE_CHECK_DEFAULT, source: 'default' };
}

/** D171: what `sonah config` says about the update check's setting: fixed words, the file's path when the setting is
 *  set in it, and the variable that turns it off. */
export const UPDATE_CHECK_SETTING_WORDS = Object.freeze({
  on: (path) => `update-check: on (${path ? `set in ${path}` : 'the default'}). Once a day at most, Sonah asks npm's `
    + 'registry for the latest version of getsonah. When it is newer than yours, Sonah says so. Sonah asks only with a '
    + 'review\'s first call to the reviewer, and in sonah doctor. Change it with sonah config update-check off.',
  off: (path) => `update-check: off (set in ${path}). Sonah does not ask npm's registry for the latest version. Change `
    + 'it with sonah config update-check on.',
  offBy: (variable) => `update-check: off (your environment sets ${variable}). Sonah does not ask npm's registry for `
    + 'the latest version.',
  invalid: (path) => `update-check: off, because Sonah could not read the settings file ${path}. Fix: run sonah config `
    + 'update-check on or sonah config update-check off to write it again.',
});
/** The kind of each word table here, for the style linter (packages/render/test/style-lint.js). The code step's line
 *  (`codePassSettingLine`) is older than it and is not one of its tables. */
export const STYLE_KINDS = Object.freeze({ UPDATE_CHECK_SETTING_WORDS: 'notice' });
export const STYLE_FIXTURES = Object.freeze({
  'UPDATE_CHECK_SETTING_WORDS.on': [['/synthetic/sonah/update-check-setting.json'], [null]],
  'UPDATE_CHECK_SETTING_WORDS.off': [['/synthetic/sonah/update-check-setting.json']],
  'UPDATE_CHECK_SETTING_WORDS.offBy': [['SONAH_NO_UPDATE_CHECK'], ['CI']],
  'UPDATE_CHECK_SETTING_WORDS.invalid': [['/synthetic/sonah/update-check-setting.json']],
});
/** D171: the update check's line in `sonah config`, from resolveUpdateCheck's answer. */
export function updateCheckSettingLine(resolved, path) {
  const W = UPDATE_CHECK_SETTING_WORDS;
  if (resolved.source === 'env') return W.offBy('SONAH_NO_UPDATE_CHECK');
  if (resolved.source === 'ci') return W.offBy('CI');
  if (resolved.source === 'invalid') return W.invalid(path);
  if (resolved.source === 'config') return resolved.on ? W.on(path) : W.off(path);
  return W.on(null);
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

/** `sonah config`: shows the settings (exit 0, or 1 when a line says a settings file cannot be read); `sonah config
 *  code-pass on|off` sets the code step's, and D171's `sonah config update-check on|off` the update check's, each in its
 *  own file (exit 0, or 3 when it cannot be written), each then shown alone. Anything else is a usage error (exit 2). */
export async function runConfigCommand(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env,
  home = env.HOME ?? homedir() } = {}) {
  const where = { env, home };
  const path = settingsPath(where), updatePath = updateCheckSettingPath(where);
  const update = async () => resolveUpdateCheck(where);
  if (argv.length === 0) {
    const read = await readSettings(where);
    const resolved = await update();
    stdout.write(`${codePassSettingLine(read, path)}\n${updateCheckSettingLine(resolved, updatePath)}\n`);
    return read.state === 'invalid' || resolved.source === 'invalid' ? 1 : 0;
  }
  if (argv.length !== 2 || !SETTING_WORDS.includes(argv[0]) || !['on', 'off'].includes(argv[1])) {
    stderr.write(`usage: ${CONFIG_USAGE}\n`);
    return 2;
  }
  const codePass = argv[0] === 'code-pass';
  try { await (codePass ? writeCodePass : writeUpdateCheck)(argv[1] === 'on', where); }
  catch {
    stderr.write(`sonah config: the settings file ${codePass ? path : updatePath} could not be written. Fix: check `
      + 'that the folder is yours and writable, or set SONAH_HOME to one that is.\n');
    return 3;
  }
  stdout.write(`${codePass ? codePassSettingLine(await readSettings(where), path)
    : updateCheckSettingLine(await update(), updatePath)}\n`);
  return 0;
}
