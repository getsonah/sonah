import { toolUsesOf, toolResultsOf, ensureClaudeLabels } from './records.js';
import { opensTurn } from './labels.js';
import { attributeFinalAnswers, AGENT_REPORT_RECORD } from './inter-agent.js';
import { callIdentity } from './event-identity.js';

// Correlate only within the same source recording. Neither a matching call ID in another
// file nor a child completion message supplies parent authority or proves child actions.
export function collectDelegations(records, sources = []) {
  return collectDelegationEvidence(records, sources).delegations;
}

/**
 * M33 F. The hand-offs of `records`, each helper's final report (a Codex FINAL_ANSWER, the `agent_report` record)
 * attached to the one hand-off of its own recording it belongs to (inter-agent.js `attributeFinalAnswers`), and how
 * many reports were attributed, unattributed or ambiguous. `sources` is each recording's parser-owned identity
 * (recording-identity.js `value()`), indexed by `source`; only its recorded fields nest a relative task name.
 */
export function collectDelegationEvidence(records, sources = []) {
  ensureClaudeLabels(records);
  const entries = [];
  const reports = [];
  const pending = new Map();
  let turn = 0;
  for (const [recordIndex, rec] of records.entries()) {
    const adapter = rec.adapter ?? 'claude';
    const source = rec.source ?? 0;
    const key = (id) => JSON.stringify([source, adapter, id]);
    if (rec.kind === AGENT_REPORT_RECORD) {
      // Sender and recipient are the recorded header lines the row itself confirmed, else null (inter-agent.js). The
      // row and the human turn it was recorded in are where the parent RECEIVED the report: what places it.
      const path = (value) => (typeof value === 'string' ? value : null);
      if (adapter === 'codex' && typeof rec.raw?.text === 'string')
        reports.push({ source, record: rec.line, turn, sender: path(rec.raw.sender), recipient: path(rec.raw.recipient),
          text: rec.raw.text });
    } else if (rec.kind === 'user') {
      const blocks = rec.raw?.message?.content;
      for (const [id, res] of toolResultsOf(rec.raw)) {
        const matches = pending.get(key(id)) ?? [];
        const duplicates = Array.isArray(blocks) ? blocks.filter(b => b?.type === 'tool_result' && b.tool_use_id === id).length : 1;
        for (const entry of matches) {
          // C-03 M33 D: the result row must record the same sessionId as the tool_use row.
          if (entry.sessionId !== undefined && rec.raw?.sessionId !== entry.sessionId) entry.sessionId = undefined;
          entry.results.push({ callId: entry.use.id, value: res.raw ?? res.text, isError: res.isError });
          if (duplicates > 1 || res.ambiguous === true) entry.results.push({ callId: entry.use.id });
        }
      }
      // M34 labels: turns are counted by the same label predicate buildEvents counts them by.
      if (opensTurn(rec)) turn++;
    } else if (rec.kind === 'assistant') {
      const content = Array.isArray(rec.raw?.message?.content) ? rec.raw.message.content : [];
      for (const use of toolUsesOf(rec.raw)) {
        // Codex code tools have per-file normalized IDs. Keep their original call identity
        // for collision detection, while matching results by their normalized ID below.
        const callId = adapter === 'codex' ? use.sourceCallId ?? use.id : use.id;
        const input = use.input && typeof use.input === 'object' && !Array.isArray(use.input) ? use.input : {};
        const target = Object.hasOwn(input, 'target') && typeof input.target === 'string' ? input.target : undefined;
        const briefKey = adapter === 'claude' ? 'prompt' : 'message';
        const brief = Object.hasOwn(input, briefKey) && typeof input[briefKey] === 'string' ? input[briefKey] : undefined;
        const forkTurns = adapter === 'codex' && Object.hasOwn(input, 'fork_turns')
          && input.fork_turns === 'none' ? 'none' : undefined;
        // M33 F: the task name a Codex spawn's call recorded, read only to name the helper a final report joins.
        const taskName = adapter === 'codex' && Object.hasOwn(input, 'task_name')
          && typeof input.task_name === 'string' ? input.task_name : undefined;
        const entry = { use: { type: 'tool_use', id: callId, name: use.name,
          ...((target !== undefined || brief !== undefined || forkTurns !== undefined || taskName !== undefined) ? { input: {
            ...(target !== undefined ? { target } : {}), ...(brief !== undefined ? { [briefKey]: brief } : {}),
            ...(forkTurns !== undefined ? { fork_turns: forkTurns } : {}),
            ...(taskName !== undefined ? { task_name: taskName } : {}) } } : {}) }, adapter, turn, source,
          ...(Number.isSafeInteger(rec.line) && rec.line > 0 ? { record: rec.line } : {}), results: [],
          // C-01 event identity: the hand-off call the recorder wrote (event-identity.js).
          identity: callIdentity(rec, recordIndex, use, Math.max(0, content.indexOf(use))),
          // C-03 M33 D: the sessionId this Claude tool_use row recorded (checked on its result row).
          ...(adapter === 'claude' && typeof rec.raw?.sessionId === 'string' ? { sessionId: rec.raw.sessionId } : {}) };
        entries.push(entry);
        const id = key(use.id);
        pending.set(id, [...(pending.get(id) ?? []), entry]);
      }
    }
  }
  // A recorded sessionId counts only when every result row repeated it (and there was a result).
  const { delegations, counts } = attributeFinalAnswers(entries.map(({ results, sessionId, ...entry }) => ({ ...entry,
    result: results.length > 1 ? results : results[0],
    ...(sessionId !== undefined && results.length ? { sessionId } : {}),
  })), reports, sources);
  return { delegations, finalAnswers: counts };
}
