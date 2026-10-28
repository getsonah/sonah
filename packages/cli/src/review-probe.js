// Shared one-attempt probe facts. Pure: no model, network, filesystem or clock.
import { acceptedInitModels, selectedContextWindow, servedModelId } from './review-judge.js';
const countOrNull = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : null);

/** `ready`: attested, and the CLI reported the window the asked value requests (any window for a value that requests
 *  none). `selector_shape_changed`: the CLI named the context selector differently from the shapes this transport
 *  attests (its init named the id with the selector although the run asked none, or the served model carried it).
 *  `served_model_mismatch`: any other identity evidence. `context_window_mismatch`: attested, but the reported window is
 *  another or none; or (D162) accepted under a selector with an init that names the id without it (Claude Code
 *  2.1.311's shape) and unattested, its usage giving another window or none (two entries that disagree give none).
 *  `not_answered`: any other failure. */
export const PROBE_OUTCOMES = Object.freeze(['ready', 'selector_shape_changed', 'served_model_mismatch',
  'context_window_mismatch', 'not_answered']);
const [READY, SELECTOR_SHAPE, SERVED_MISMATCH, WINDOW_MISMATCH, NOT_ANSWERED] = PROBE_OUTCOMES;
/** The fixed synthetic request: no session text, a one-line answer. */
export const PROBE_REQUEST = Object.freeze({ system: 'Return exactly the JSON object {"ok":true} and nothing else.',
  prompt: 'Synthetic probe request: it quotes no session.' });
/** The outcome, from the transport's typed fields of the one attempt (structure only). */
export function probeOutcome(asked, metadata) {
  if (!metadata) return NOT_ANSWERED;
  const configured = typeof metadata.configuredModel === 'string' ? metadata.configuredModel : null;
  const served = Array.isArray(metadata.servedModels) ? metadata.servedModels.filter((m) => typeof m === 'string') : [];
  const plain = servedModelId(asked);
  const requested = selectedContextWindow(asked);
  if (metadata.attestation === 'mismatch' || metadata.providerClass === 'identity_mismatch') {
    // The same model, the selector placed otherwise than this transport attests: the CLI's shape changed. D162: an init
    // that names the id without the selector the run asked is an attested shape (`acceptedInitModels`), never a move.
    const sameModel = (value) => value !== null && servedModelId(value) === plain;
    const selectorMoved = (configured !== null && !acceptedInitModels(asked).includes(configured) && sameModel(configured))
      || served.some((value) => value !== plain && sameModel(value));
    return selectorMoved && (configured === null || sameModel(configured)) && served.every(sameModel)
      ? SELECTOR_SHAPE : SERVED_MISMATCH;
  }
  if (metadata.ok !== true) return NOT_ANSWERED;
  // D162: the shape whose init names the id without the selector is attested only by the window its usage gives, so an
  // accepted answer of that shape left unattested is a window the CLI did not confirm.
  if (metadata.attestation !== 'attested')
    return requested !== null && configured === plain && served.length > 0 && served.every((value) => value === plain)
      ? WINDOW_MISMATCH : NOT_ANSWERED;
  const reported = countOrNull(metadata.contextWindow) || null;
  return requested !== null && reported !== requested ? WINDOW_MISMATCH : READY;
}
