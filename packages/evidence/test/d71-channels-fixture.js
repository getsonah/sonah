// D71 (S3): a synthetic recording for the new channels (owner decisions D71 c, d, e, f, g). Every row is invented and
// mirrors only shapes the repository's own fixtures already use (m33-u-unasked-fixture.js, d71-checklist-brief.test.js)
// and the known key sets of Claude Code's typed instruction attachments (`instructions`, `nested_memory`). No real
// recording is read; nothing here holds a secret.
import { row, humanAsk, said, call, result } from './m33-u-unasked-fixture.js';

const SIDECAR = (extra = {}) => ({ stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false, ...extra });
const attachment = (value) => row({ type: 'attachment', attachment: value });

export const ASK = 'Add a --json flag to src/export.js. The export writes 3 columns today. Run the tests and tell me.';
export const RULES = '# Project rules\nNever add a runtime dependency.\nRun npm test before you finish.';
export const CLOSING = ['Done.', 'The export wrote 5 columns before.', 'The export only ever wrote JSON.',
  'There is no rule against new dependencies.', 'The lint run failed once; I fixed it.'].join('\n');
export const LATER = 'Actually the export writes 4 columns.';

/** The recording: an ask, the project's instruction file (and the agent's memory, which is never read), a stated choice
 *  not to act, a failing test run and the edit after it, a background run, a failing lint run and its fix, the closing
 *  message, a later human message, and a nested project file recorded after everything. */
export function channelRows({ nestedLate = false } = {}) {
  return [
    humanAsk(ASK),
    attachment({ type: 'instructions', files: [{ path: '/repo/CLAUDE.md', type: 'Project', content: RULES },
      { path: '/repo/.claude/agent-memory/MEMORY.md', type: 'AutoMem', content: 'A private memory line.' }] }),
    said('I will not touch the CSV writer.'),
    call('t1', 'Bash', { command: 'npm test' }),
    result('t1', 'FAIL test/export.test.js\n1 failed, 23 passed', SIDECAR({ stdout: 'FAIL' }), true),
    call('t2', 'Edit', { file_path: '/repo/src/export.js', old_string: 'const fmt = "csv";', new_string: 'const fmt = "json";' }),
    result('t2', 'The file /repo/src/export.js has been updated.', { filePath: '/repo/src/export.js',
      oldString: 'const fmt = "csv";', newString: 'const fmt = "json";',
      originalFile: 'export function run() {\nconst fmt = "csv";\n}\n',
      structuredPatch: [{ oldStart: 1, oldLines: 3, newStart: 1, newLines: 3,
        lines: [' export function run() {', '-const fmt = "csv";', '+const fmt = "json";', ' }'] }],
      userModified: false, replaceAll: false }),
    call('t3', 'Bash', { command: 'npm test', run_in_background: true }),
    result('t3', 'Command running in background with ID: b1', SIDECAR({ backgroundTaskId: 'b1' })),
    call('t4', 'Bash', { command: 'npm run lint' }),
    result('t4', 'lint: 1 error in src/export.js', SIDECAR({ stdout: 'lint' }), true),
    said('Fixing the lint error now.'),
    call('t5', 'Edit', { file_path: '/repo/src/export.js', old_string: 'const fmt = "json";', new_string: 'const fmt = \'json\';' }),
    result('t5', 'The file /repo/src/export.js has been updated.'),
    said(CLOSING),
    humanAsk(LATER),
    ...(nestedLate ? [attachment({ type: 'nested_memory', path: '/repo/src/CLAUDE.md', displayPath: 'src/CLAUDE.md',
      content: { path: '/repo/src/CLAUDE.md', type: 'Project', content: 'Exports keep their column order.',
        contentDiffersFromDisk: false } })] : []),
  ].map((r, i) => ({ ...r, uuid: `u-s3-${i + 1}` }));
}

/** The recording's events by role, for a test to cite. */
export function channelIds(session) {
  const of = (kind) => session.events.filter((event) => event.kind === kind);
  const [ask, later] = of('instruction');
  const [notActing, fixing, closing] = of('commentary');
  const [test, edit, background, lint, fix] = of('invocation');
  const resultOf = (action) => session.events.find((event) => event.kind === 'observation' && event.invocation === action.id);
  return { ask, later, notActing, fixing, closing, test, edit, background, lint, fix, testResult: resultOf(test),
    editResult: resultOf(edit), backgroundResult: resultOf(background), lintResult: resultOf(lint), fixResult: resultOf(fix),
    rules: session.projectInstructions[0] ?? null };
}
