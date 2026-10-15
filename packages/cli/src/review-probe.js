// Shared one-attempt probe facts. Pure: no model, network, filesystem or clock.
import { selectedContextWindow, servedModelId } from './review-judge.js';
const countOrNull = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : null);

/** `ready`: attested, and the CLI reported the window the asked value requests (any window for a value that requests
 *  none). `selector_shape_changed`: the CLI named the context selector differently from the shape this transport
 *  attests (its init named the id without the selector the run asked, or with one it did not ask; or the served model
 *  carried the selector). `served_model_mismatch`: any other identity evidence. `context_window_mismatch`: attested,
 *  but the reported window is another or none. `not_answered`: any other failure. */
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
  if (metadata.attestation === 'mismatch' || metadata.providerClass === 'identity_mismatch') {
    // The same model, the selector placed otherwise than this transport attests: the CLI's shape changed.
    const sameModel = (value) => value !== null && servedModelId(value) === plain;
    const selectorMoved = (configured !== null && configured !== asked && sameModel(configured))
      || served.some((value) => value !== plain && sameModel(value));
    return selectorMoved && (configured === null || sameModel(configured)) && served.every(sameModel)
      ? SELECTOR_SHAPE : SERVED_MISMATCH;
  }
  if (metadata.ok !== true || metadata.attestation !== 'attested') return NOT_ANSWERED;
  const requested = selectedContextWindow(asked);
  const reported = countOrNull(metadata.contextWindow) || null;
  return requested !== null && reported !== requested ? WINDOW_MISMATCH : READY;
}
