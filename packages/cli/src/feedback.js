// A shareable install summary. Read only known status fields and counts: never copy paths, model names beyond the
// documented ones, or anything from a recording or a review.
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { detectAdapters } from './doctor.js';
import { attestableModel, reviewJudgeConfig } from './review-judge.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';

// Public model names, printed as they are: the documented ones (docs/INSTALL.md, "Choose the reviewer") and the ones
// this list held before. Any other name is omitted.
const MODEL_NAMES = Object.freeze([SESSION_REVIEW_CLAUDE_CLI_MODEL, 'gpt-6.1-sol', 'sonnet', 'opus', 'haiku', 'gpt-5.6-sol']);
const BACKENDS = Object.freeze({
  'claude-cli': { provider: 'Claude Code', transport: () => 'Claude Code CLI (billing UNCHECKED)' },
  'codex-cli': { provider: 'Codex', transport: () => 'ChatGPT subscription' },
  'anthropic-api': { provider: 'Anthropic API',
    transport: (env) => `API billing; ANTHROPIC_API_KEY ${env.ANTHROPIC_API_KEY ? 'set' : 'not set'}` },
});
const count = (n) => Number.isSafeInteger(n) && n >= 0 ? String(n) : 'UNCHECKED';

/** The reviewer `sonah review` runs without flags, selected as session-review-command.js selects it: the backend from
 *  SONAH_REVIEW_BACKEND, the model from SONAH_MODEL or the backend's default, checked by `reviewJudgeConfig`. */
function selectedReviewer(env) {
  try {
    const backend = env.SONAH_REVIEW_BACKEND ?? 'claude-cli';
    const { model } = reviewJudgeConfig(env, { backend,
      model: env.SONAH_MODEL ?? (backend === 'claude-cli' ? SESSION_REVIEW_CLAUDE_CLI_MODEL : undefined) });
    if (backend === 'claude-cli' && !attestableModel(model)) throw new Error('invalid_model');
    return [
      `  provider: ${BACKENDS[backend].provider}`,
      `  model: ${MODEL_NAMES.includes(model) ? model : 'custom model (name omitted)'}`,
      `  transport: ${BACKENDS[backend].transport(env)}`,
    ];
  } catch {
    return ['  provider and model: UNCHECKED (invalid configuration)'];
  }
}

/** The recordings `sonah doctor` counts (detectAdapters reads only the file system), as counts. */
function recordingCounts(found) {
  if (!found) return ['  recordings found: UNCHECKED (could not be counted)'];
  return ['claude', 'codex'].map((name) => `  ${name} recordings found: ${count(found[name]?.count)}`);
}

export async function feedbackBundle({ version = '?', outDir = homedir(), now = new Date(),
  env = process.env, adapters = detectAdapters } = {}) {
  const found = await adapters().catch(() => null);

  // The CLI supplies package version and an optional baked-in commit/date. Do not echo
  // arbitrary caller-provided text into an artifact advertised as safe to share.
  const safeVersion = /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?(?: \((?:[a-f0-9]{7,40}|nogit) \d{4}-\d{2}-\d{2}\))?$/.test(version)
    ? version : 'UNCHECKED';
  const stamp = now.toISOString().slice(0, 10);
  const text = [
    `# sonah feedback bundle — ${now.toISOString()}`, '',
    `version: ${safeVersion}`,
    `platform: ${process.platform} ${process.arch} node ${process.version}`, '',
    '## selected reviewer', ...selectedReviewer(env),
    '  model access: UNCHECKED (feedback never calls a model)', '',
    '## recordings', ...recordingCounts(found), '',
    'This bundle contains setup facts and counts only. Session text, findings, quotes, paths,',
    'session hashes, reviewer labels and reasons, and credentials are omitted.',
    'Review this file before sharing. Add any example you choose to share separately.', '',
  ].join('\n');
  const file = join(outDir, `sonah-feedback-${stamp}.md`);
  const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(text, 'utf8');
  } finally { await handle.close(); }
  return { file, text };
}
