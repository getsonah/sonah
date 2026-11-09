// job.mjs: the wiring of one visual review job. A PR (repository, base..head) in, one page out:
//   extract -> function requests -> answers -> checks -> story request -> answers -> checks
//           -> findings request -> answers -> checks -> layout -> render.
// Every request is written to requests/<id>.json before it is asked, so a stand-in can answer the exact request.
// With no transport (replay-only) nothing is sent: a missing answer leaves the job "pending" with the ids still
// needed, and stages that depend on them do not run; run the job again once they are answered.
// The page gets no clock reading: durations stay in run.json.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extract } from './extract.mjs';
import { functionRequests, storyRequest, findingsRequest } from './requests.mjs';
import * as answers from './answers.mjs';
import { checkFunctions, checkStory, checkFindings, findingsLost } from './checks.mjs';
import { DROP_REASONS } from './reasons.mjs';
import { layout } from './layout.mjs';
import { render, shareParts } from './render.mjs';
import { TRANSPORT_ERRORS } from './transport-claude.mjs';
import { uploadBody } from './upload.mjs';

const writeJson = (path, x) => writeFileSync(path, `${JSON.stringify(x, null, 1)}\n`);
const sixPlaces = (x) => Math.round(x * 1e6) / 1e6;

// mode and shareUrl: the page's render options (render.mjs); a laptop's run passes mode 'local', its share url and
// the branch (null when none points at the head), and the local page then carries its upload (pageHtml).
export async function runJob({ repoDir, base, head, outDir, transport = null, store = null, mode = 'hosted', shareUrl = null,
  branch = null }) {
  mkdirSync(join(outDir, 'requests'), { recursive: true });
  const saved = store ?? answers.answerStore(join(outDir, 'answers'));
  const records = []; // every request with an answer or a failed call, in asking order
  const needed = []; // { id, kind } of requests with no answer yet (replay-only, or calls stopped)
  const dropped = [];
  let facts = null;
  try {
    facts = await extract({ repoDir, base, head });
    writeJson(join(outDir, 'facts.json'), facts);

    // Ask a stage's requests; null when any is still pending (the stage's dependants then wait).
    const writeRequest = (r) => writeJson(join(outDir, 'requests', `${r.id}.json`), r);
    const stopped = () => (answers.stopOf ? answers.stopOf(records) : null);
    const ask = async (requests) => {
      for (const r of requests) writeRequest(r);
      // transport null: replay only, a missing answer comes back as error 'pending'. Re-asks are written too.
      // Once a call has stopped the job, later stages only replay.
      const got = await answers.answerAll(requests, { transport: stopped() ? null : transport, store: saved,
        onRequest: writeRequest });
      let pending = false;
      for (const r of got) {
        if (r.error !== 'pending') { records.push(r); continue; }
        pending = true;
        const waits = (r.attempts ?? []).filter((a) => a.error === 'pending').map((a) => a.id);
        for (const id of waits.length ? waits : [r.id]) needed.push({ id, kind: r.kind });
      }
      return pending ? null : got;
    };
    const keep = (check) => { dropped.push(...check.dropped); return check.value; };

    // Functions first: the story is asked with their checked one-liners.
    const fnRecords = await ask(await functionRequests(facts));
    const meaningFns = fnRecords ? keep(checkFunctions(facts, fnRecords)) : null;

    let story = null;
    let storyRecord = null;
    if (meaningFns) {
      [storyRecord] = (await ask([await storyRequest(facts, meaningFns)])) ?? [];
      if (storyRecord) story = keep(checkStory(facts, storyRecord));
    }

    // Findings need only the facts, so they are asked even while the functions wait.
    const [findingsRecord] = (await ask([await findingsRequest(facts)])) ?? [];
    const findingsCheck = findingsRecord ? checkFindings(facts, findingsRecord) : null;
    const findings = findingsCheck ? keep(findingsCheck) : null;

    // A call that met a limit no further call can pass (usage, auth, billing, model, no CLI) stops the job.
    const stop = stopped();
    if (stop) return finish({ outDir, facts, status: 'error', records, needed, dropped, stop,
      error: new Error(`the model calls stopped: ${stop}`) });
    if (needed.length) return finish({ outDir, facts, status: 'pending', records, needed, dropped });
    // A story or findings call that failed (a crash, a provider error, a timeout) is no review: the page would read as
    // if nothing was found. The job ends in error, so no page is published from it.
    for (const [what, r] of [['story', storyRecord], ['findings', findingsRecord]]) {
      if (r && TRANSPORT_ERRORS.includes(r.error)) {
        return finish({ outDir, facts, status: 'error', records, needed, dropped, error: new Error(`the ${what} call failed`) });
      }
    }

    const meaning = { functions: meaningFns, story };
    writeJson(join(outDir, 'meaning.json'), meaning);
    writeJson(join(outDir, 'findings.json'), findings);
    writeJson(join(outDir, 'dropped.json'), dropped);
    const run = finish({ outDir, facts, status: 'complete', records, needed, dropped });
    writeFileSync(join(outDir, 'page.html'), await pageHtml({ facts, meaning, findings, run,
      findingsDropped: findingsCheck?.dropped, mode, shareUrl, branch }));
    return run;
  } catch (error) {
    return finish({ outDir, facts, status: 'error', records, needed, dropped, error });
  }
}

// run.json: per request who answered, the model, time, cost and drop counts by reason; totals; what is still needed.
function finish({ outDir, facts, status, records, needed, dropped, error = null, stop = null }) {
  const countsOf = (list) => {
    const by = {};
    for (const d of list) by[d.reason] = (by[d.reason] ?? 0) + 1;
    return Object.fromEntries(Object.entries(by).sort(([a], [b]) => (a < b ? -1 : 1)));
  };
  const requests = records.map((r) => ({
    kind: r.kind, id: r.id, by: r.by ?? null, model: r.model ?? null, ms: r.ms ?? null, costUsd: r.costUsd ?? null,
    replayed: r.replayed === true, ...(r.error ? { error: r.error } : {}),
    ...((r.attempts?.length ?? 0) > 1 ? { reasked: r.attempts.map((a) => a.id).slice(1) } : {}),
    ...(r.limits ? { limits: r.limits } : {}), // the limit re-ask: fields over their limits, and how many it fixed
    dropped: countsOf(dropped.filter((d) => d.where === r.id || d.where.startsWith(`${r.id}/`))),
  }));
  // A re-ask is a call of its own: count every attempt that was answered or failed (not the ones still pending).
  const calls = records.flatMap((r) => r.attempts ?? [r]).filter((a) => a.error !== 'pending');
  const byWho = {};
  for (const a of calls) if (a.by) byWho[a.by] = (byWho[a.by] ?? 0) + 1;
  const run = {
    v: 1,
    status,
    range: facts ? { base: facts.range.base, head: facts.range.head } : null,
    requests,
    needed: needed.map((n) => n.id),
    totals: {
      calls: calls.length,
      by: byWho,
      models: [...new Set(records.map((r) => r.model).filter(Boolean))].sort(),
      costUsd: sixPlaces(records.reduce((s, r) => s + (Number(r.costUsd) || 0), 0)),
      ms: records.reduce((s, r) => s + (Number(r.ms) || 0), 0),
      dropped: countsOf(dropped),
    },
    ...(stop ? { stop } : {}),
    ...(error ? { error: String(error?.message ?? error) } : {}),
  };
  try { writeJson(join(outDir, 'run.json'), run); } catch { /* the out dir itself failed; the caller still gets run */ }
  return run;
}

// The page. The local page (mode 'local' with a share url) also carries the upload the server's /share takes: the same
// review drawn in mode 'hosted', with the job's own data (upload.mjs uploadBody), the repository named by the share url.
async function pageHtml({ facts, meaning, findings, run, findingsDropped, mode = 'hosted', shareUrl = null, branch = null }) {
  const placed = await layout(facts, meaning, findings);
  const draw = (as, extra = {}) => render({ facts, meaning, findings, layout: placed, mode: as, shareUrl, ...extra,
    run: { ...pageRun(run), findingsLost: findingsLost(findingsDropped),
      findingsCallFailed: (findingsDropped ?? []).some((d) => d.reason === DROP_REASONS.call_failed) } });
  const at = mode === 'local' ? shareParts(shareUrl) : null;
  if (!at) return draw(mode);
  const upload = uploadBody({ owner: at.owner, name: at.repo, branch, page: draw('hosted'), facts, meaning, findings, run });
  return draw('local', { upload });
}

/**
 * The page of a finished job drawn again from its own files (facts, meaning, findings, dropped, run.json) with the
 * current layout and render: no repository, no model call. Same files, same bytes as the job itself writes.
 */
export async function renderFinished(outDir, { mode = 'hosted', shareUrl = null, branch = null } = {}) {
  const read = (name) => JSON.parse(readFileSync(join(outDir, name), 'utf8'));
  const run = read('run.json');
  if (run?.status !== 'complete') throw new Error('the job did not complete');
  const dropped = read('dropped.json');
  const ids = new Set((run.requests ?? []).filter((r) => r.kind === 'findings').map((r) => r.id));
  const findingsDropped = (Array.isArray(dropped) ? dropped : [])
    .filter((d) => typeof d?.where === 'string' && ids.has(d.where.split('/')[0]));
  return pageHtml({ facts: read('facts.json'), meaning: read('meaning.json'), findings: read('findings.json'), run,
    findingsDropped, mode, shareUrl, branch });
}

// What the page may show of a run: calls, cost, who answered and the model. Durations are clock readings, left out.
function pageRun(run) {
  return {
    calls: run.totals.calls,
    costUsd: run.totals.costUsd,
    model: run.totals.models.join(', '),
    by: run.totals.by,
    dropped: Object.values(run.totals.dropped).reduce((s, n) => s + n, 0),
  };
}
