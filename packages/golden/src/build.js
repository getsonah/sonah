// A builder that emits real-shaped Claude Code JSONL.
//
// The golden corpus is generated, not hand-labelled: a generated recording's right answers are
// known by construction, so no person has to work them out and no one can get them wrong.
//
// Generating also means the fixtures can live in the repo. Real transcripts cannot: they can
// carry a live credential, so `corpus/sessions/` is gitignored and only these are committed.
//
// The shapes here mirror what the slicer actually parses. If a vendor changes the schema, these
// break in the same place the parser does, which is the point.

let uid = 0;
const nextId = () => `id-${String(++uid).padStart(6, '0')}`;

export function resetIds() {
  uid = 0;
}

/**
 * Build a session as an array of JSONL-ready records.
 *
 * Usage mirrors how an agent run actually reads:
 *   session({ cwd })
 *     .ask('add rate limiting to the 3 public endpoints')
 *     .run('pytest tests/test_rl.py', { fail: 'File "/repo/rl.py", line 12, in check\nAssertionError' })
 *     .edit('rl.py', 'if x:', 'if x or True:')
 *     .run('pytest tests/test_rl.py', { pass: '4 passed in 0.3s' })
 *     .say('All tests pass.')
 *     .done()
 */
export function session({ cwd = '/repo', sessionId = 'sess-0001', version = '2.1.205' } = {}) {
  const out = [];
  const base = { sessionId, cwd, version, gitBranch: 'feat/x', isSidechain: false };
  // M34 labels review (F6): from 2.1.219 Claude Code records the host's typed origin on every human prompt; a recorder
  // before it records none (its rows are labelled by the slicer's declared legacy fallback, each a counted gap).
  const typed = typedRecorder(version);

  const api = {
    ask(text) {
      out.push({ ...base, type: 'user', uuid: nextId(), ...(typed ? { origin: { kind: 'human' } } : {}),
        message: { role: 'user', content: text } });
      return api;
    },

    say(text) {
      out.push({
        ...base, type: 'assistant', uuid: nextId(),
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      });
      return api;
    },

    /** A tool call plus its result, which is how the pair actually appears on the wire. `sidecar`: the typed
     *  `toolUseResult` the harness writes beside the block (else the result text, as older versions wrote it). */
    tool(name, input, result, { isError = false, sidecar = undefined } = {}) {
      const id = nextId();
      out.push({
        ...base, type: 'assistant', uuid: nextId(),
        message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
      });
      out.push({
        ...base, type: 'user', uuid: nextId(),
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: id, content: result ?? '', is_error: isError }],
        },
        toolUseResult: sidecar ?? result ?? '',
      });
      return api;
    },

    /** A command that did not fail carries Claude Code's typed success sidecar (versions 2.1.121–2.1.284): the
     *  harness's own completion verdict, the only status a passing Bash result records. Its output text is never read
     *  for a status (H1): a run's pass or failure is what the harness recorded. */
    run(command, { pass, fail, error, background } = {}) {
      if (background) {
        return api.tool('Bash', { command, run_in_background: true }, 'Command running in background with ID: bg-1');
      }
      const result = pass ?? fail ?? error ?? '';
      if (fail || error) return api.tool('Bash', { command }, result, { isError: true });
      return api.tool('Bash', { command }, result,
        { sidecar: { stdout: result, stderr: '', interrupted: false, isImage: false, noOutputExpected: false } });
    },

    edit(file_path, old_string, new_string) {
      return api.tool('Edit', { file_path: abs(file_path, cwd), old_string, new_string }, 'ok');
    },

    create(file_path, content) {
      return api.tool('Write', { file_path: abs(file_path, cwd), content }, 'ok');
    },

    read(file_path, content = 'x'.repeat(200)) {
      return api.tool('Read', { file_path: abs(file_path, cwd) }, content);
    },

    compact() {
      out.push({ ...base, type: 'system', subtype: 'compact_boundary', uuid: nextId() });
      return api;
    },

    done: () => out,
  };
  return api;
}

/** Whether `version` (a plain `x.y.z`) is a Claude Code recorder that types its human prompts (2.1.219 and later). */
function typedRecorder(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!parts) return false;
  const [major, minor, patch] = parts.slice(1).map(Number);
  return major !== 2 ? major > 2 : minor !== 1 ? minor > 1 : patch >= 219;
}

function abs(p, cwd) {
  return p.startsWith('/') ? p : `${cwd}/${p}`;
}

/** Write records to a .jsonl file the slicer can read. */
export function toJsonl(records) {
  return records.map((r) => JSON.stringify(r)).join('\n');
}
