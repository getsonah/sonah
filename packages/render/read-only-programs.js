// H5. The read-only program table of the session story's step titles ("read N files", a
// read-only command). Presentational only: no status and no review request reads it (M35 windowing deleted the carry,
// which carried every command's result whatever its program), and a command's status is the record's (slicer
// events.js). Before H5 four lists answered "does this command only read": the slicer's incidental set, the carry's, the
// story's `READ_WORDS` and the page's `PAGE_READ_ONLY_PROGRAMS`; the first two were deleted and the last two made this one
// table. D69 page audit (2026-10-08): the page's reader of it (`readOnlyCommand`, which let a read of a file stand across
// a command that only reads, for "Touches") is deleted with "Touches", and so is the shell-wrapper unwrapping only it
// read (`scriptOf`); the table is the story's alone. It is a chosen table of programs, the same class H5
// named: open for the owner (D69 f).
//
// Each program maps to how its operands read: `files` — it reads the files it names (the story names them as files
// read); `none` — it only inspects, lists, prints or changes directory, and names no file read.

/** Program -> `files` | `none`. Frozen. */
export const READ_ONLY_PROGRAMS = Object.freeze({
  ls: 'files', pwd: 'none', cat: 'files', head: 'files', tail: 'files', grep: 'files', egrep: 'none', fgrep: 'none',
  rg: 'files', ag: 'none', wc: 'files', nl: 'files', file: 'none', stat: 'none', du: 'none', df: 'none', which: 'none',
  whereis: 'none', type: 'none', diff: 'none', cmp: 'none', less: 'files', more: 'none', echo: 'none', printf: 'none',
  true: 'none', false: 'none', test: 'none', '[': 'none', basename: 'none', dirname: 'none', realpath: 'none',
  readlink: 'none', date: 'none', sleep: 'none', cd: 'none', printenv: 'none', sort: 'none', cut: 'none', tr: 'none',
  jq: 'files', column: 'none', md5: 'none', md5sum: 'none', shasum: 'none', sha1sum: 'none', sha256sum: 'none',
  sed: 'files', find: 'files', git: 'none',
});
/** Git subcommand -> `files` | `none`, as above. */
export const READ_ONLY_GIT = Object.freeze({
  status: 'files', log: 'files', diff: 'files', show: 'files', blame: 'files', 'ls-files': 'none', 'ls-tree': 'none',
  'rev-parse': 'none', grep: 'files', 'cat-file': 'none', describe: 'none', shortlog: 'none',
});
/** How a program's operands read (`files` | `none`), or null when it is no read-only program. */
export const readOnlyProgram = (program) => (Object.hasOwn(READ_ONLY_PROGRAMS, program) ? READ_ONLY_PROGRAMS[program] : null);
/** How a git subcommand's operands read (`files` | `none`), or null when it may write. */
export const readOnlyGit = (sub) => (Object.hasOwn(READ_ONLY_GIT, sub) ? READ_ONLY_GIT[sub] : null);
