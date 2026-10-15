// Gain I, the images you pasted (2026-10-13). The images a person pasted into their messages,
// shown to the reviewer in the requests whose instruction history covers them, and the session as such a request shows
// it. Before this, a human message carrying an image declared a loss the reviewer could not read at every bound, so
// "made without asking you" could be checked for no decision of that session.
//
// What is decided here, and only here, all by structure and frozen literals:
//   - which recorded image a request can carry (`deliverableImage`): one the recorder kept whole as base64, of a media
//     type the reviewer CLI accepts, whose bytes are that type (its signature), whose pixel size its header states and
//     is within the CLI's own image bound, and whose base64 size is within the CLI's own per-image limit;
//   - which images one window's requests carry (`requestImages`): every human message recorded up to the window's end
//     whose nontext blocks are ALL such images, earliest first, while the request's count and size caps hold, on a
//     backend whose transport sends images (`IMAGE_BACKENDS`); a message any of whose blocks cannot be carried keeps
//     its loss;
//   - the session as that window's requests show it (`deliveredView`): the instruction loss of each message whose
//     images the request carries is cleared for that request only, and the message's inventory entry states how many
//     images it carries (ledger.js `instructionReviewScope`), so the request, its challenge and its grounding read one
//     scope and one digest.
// Nothing here reads the images' content beyond their signature and header, and no image ever reaches anything written
// for a person (D84: the model reads the session as recorded; the page and the story say an image was attached).
import { INSTRUCTION_GAP_NOTES } from '../adapters/sonah-ledger.js';
import { instructionReviewScope } from './ledger.js';

/**
 * The caps on the images one request carries. Frozen literals, read from the installed reviewer CLI (Claude Code
 * 2.1.296, its own image limits and accepted types, by a search of its code): the four media types it accepts and
 * sniffs (`image/jpeg`, `image/png`, `image/gif`, `image/webp`); an image's base64 size within its `maxBase64Size`
 * (5,242,880) and its pixels within its `maxWidth` x `maxHeight` (2000 x 2000, also the API's dimension limit for a
 * many-image request, which the CLI names); and the whole request's images within 20 images and 20,971,520 base64
 * characters, so a request stays under the 33,554,432-byte request body the CLI's limits sit beside, with room for its
 * text. An image outside them is not sent: its message keeps its loss (fail closed), and no window fails for it.
 */
export const REQUEST_IMAGE_LIMITS = Object.freeze({
  mediaTypes: Object.freeze(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
  maxBase64Chars: 5_242_880,
  maxWidth: 2000,
  maxHeight: 2000,
  maxImages: 20,
  maxTotalBase64Chars: 20_971_520,
});

/**
 * The reviewer backends whose transport sends a request's images (cli/src/review-judge.js): `claude-cli` as content
 * blocks of one stream-json user message (`--input-format stream-json`), `anthropic-api` as image blocks of the user
 * message, `codex-cli` as image files attached to the prompt (`codex exec --image`). Any other backend — and a plan
 * that names none — carries no image, and every message keeps its loss exactly as before.
 */
export const IMAGE_BACKENDS = Object.freeze(['claude-cli', 'anthropic-api', 'codex-cli']);

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** The media type an image's bytes are, by its format's signature (the four of REQUEST_IMAGE_LIMITS), or null. */
export function sniffedMediaType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const head = bytes.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP')
    return 'image/webp';
  return null;
}

/** JPEG start-of-frame markers (ITU T.81 B.1.1.3): C0-C3, C5-C7, C9-CB, CD-CF carry the frame's size. */
const JPEG_FRAMES = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** An image's pixel size as its format's header states it (`{ width, height }`), or null when the header does not
 *  state it where its format puts it. Read from the formats' own published layouts only: PNG's IHDR, GIF's logical
 *  screen, WebP's VP8, VP8L or VP8X header, a JPEG's first start-of-frame segment. */
export function imageSize(bytes, mediaType) {
  if (!Buffer.isBuffer(bytes)) return null;
  const sized = (width, height) => (Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0
    && height > 0 ? { width, height } : null);
  try {
    if (mediaType === 'image/png')
      return bytes.subarray(12, 16).toString('latin1') === 'IHDR'
        ? sized(bytes.readUInt32BE(16), bytes.readUInt32BE(20)) : null;
    if (mediaType === 'image/gif') return sized(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
    if (mediaType === 'image/webp') {
      const chunk = bytes.subarray(12, 16).toString('latin1');
      if (chunk === 'VP8X') return sized(bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1);
      if (chunk === 'VP8L' && bytes[20] === 0x2f) {
        const bits = bytes.readUInt32LE(21);
        return sized((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
      }
      if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a)
        return sized(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff);
      return null;
    }
    if (mediaType === 'image/jpeg') {
      let at = 2;
      while (at + 9 < bytes.length) {
        if (bytes[at] !== 0xff) return null;
        const marker = bytes[at + 1];
        if (marker === 0xff) { at++; continue; }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { at += 2; continue; }
        if (marker === 0xd9 || marker === 0xda) return null;
        const length = bytes.readUInt16BE(at + 2);
        if (length < 2) return null;
        if (JPEG_FRAMES.has(marker)) return sized(bytes.readUInt16BE(at + 7), bytes.readUInt16BE(at + 5));
        at += 2 + length;
      }
    }
  } catch { /* a header shorter than its format's layout states no size */ }
  return null;
}

/**
 * One recorded nontext block (an instruction event's `nonText` entry: `{ block, type, mediaType?, data? }`) as a
 * request can carry it — `{ block, mediaType, data }` — or null: anything but an image the recorder kept whole as
 * canonical base64 of an accepted media type whose bytes carry that type's signature, its pixel size stated by its
 * header and within the caps, and its base64 within the per-image cap. Pure.
 */
export function deliverableImage(entry) {
  const limits = REQUEST_IMAGE_LIMITS;
  if (entry === null || typeof entry !== 'object' || entry.type !== 'image' || !Number.isSafeInteger(entry.block)
    || entry.block < 0 || !limits.mediaTypes.includes(entry.mediaType) || typeof entry.data !== 'string'
    || !entry.data || entry.data.length % 4 !== 0 || entry.data.length > limits.maxBase64Chars
    || !BASE64.test(entry.data)) return null;
  const bytes = Buffer.from(entry.data, 'base64');
  if (bytes.toString('base64') !== entry.data || sniffedMediaType(bytes) !== entry.mediaType) return null;
  const size = imageSize(bytes, entry.mediaType);
  if (size === null || size.width > limits.maxWidth || size.height > limits.maxHeight) return null;
  return { block: entry.block, mediaType: entry.mediaType, data: entry.data };
}

/**
 * The images one window's requests carry, `{ images, delivered }`: `images` in the order the request sends them, each
 * `{ eventId, block, mediaType, data }`, and `delivered`, the ids of the human messages they are all of. Considered: on
 * a backend of IMAGE_BACKENDS, each root human instruction whose event carries nontext blocks and which the window's
 * own instruction inventory lists (ledger.js `instructionReviewScope`, bounded at `upTo` as the request's is; null: the
 * whole session), in that inventory's order. The request's header numbers the images by that same inventory (prompt.js
 * `withImageRanges`), so the two cannot disagree: a message the inventory leaves out (a repeated id or sequence, no
 * visible words) is carried by no request and keeps its loss. A message is carried only whole — every one of its
 * blocks a `deliverableImage` — and only while the request's count and size caps hold; at the first message that would
 * pass a cap, no later one is carried (earliest first). Every other message keeps its loss. Structure only. Pure.
 */
export function requestImages(session, upTo = null, backend = undefined) {
  const images = [], delivered = [];
  if (!IMAGE_BACKENDS.includes(backend) || !Array.isArray(session?.events)
    || (upTo !== null && !Number.isSafeInteger(upTo))) return { images, delivered };
  const carries = (event) => event?.kind === 'instruction' && event.childId == null && event.authority === 'human'
    && typeof event.id === 'string' && Array.isArray(event.nonText) && event.nonText.length > 0
    && Number.isSafeInteger(event.sequence) && (upTo === null || event.sequence <= upTo);
  // A session none of whose messages carries a nontext block has nothing to carry; its inventory is not read.
  if (!session.events.some(carries)) return { images, delivered };
  // The inventory's entries by id. An entry is the first root event of its id and sequence, as the inventory reads it;
  // a later event repeating both is not the entry's and carries nothing.
  const listed = new Map(instructionReviewScope(session, { upTo }).instructions.map((entry) =>
    [entry.eventId, entry.sequence]));
  const carriers = [];
  for (const event of session.events) {
    if (event?.childId != null || !listed.has(event?.id) || listed.get(event.id) !== event.sequence) continue;
    listed.delete(event.id);
    if (carries(event)) carriers.push(event);
  }
  carriers.sort((a, b) => a.sequence - b.sequence);
  let chars = 0;
  for (const event of carriers) {
    const shown = event.nonText.map(deliverableImage);
    if (shown.some((image) => image === null)) continue;
    const size = shown.reduce((n, image) => n + image.data.length, 0);
    if (images.length + shown.length > REQUEST_IMAGE_LIMITS.maxImages
      || chars + size > REQUEST_IMAGE_LIMITS.maxTotalBase64Chars) break;
    for (const image of shown) images.push({ eventId: event.id, ...image });
    chars += size;
    delivered.push(event.id);
  }
  return { images, delivered };
}

/**
 * The session as a request carrying `images` (`requestImages`) shows it: `session` itself when it carries none (no
 * byte of any reader moves), else a view of it (`clearedView`) in which the located nontext loss no longer names the
 * messages whose images the request carries, and `shownImages` maps each such message's id to how many images of it
 * the request carries (ledger.js `instructionReviewScope` states it on the message's inventory entry). Every other
 * member is the session's own.
 */
export function deliveredView(session, images) {
  const counts = new Map();
  for (const image of Array.isArray(images) ? images : [])
    if (typeof image?.eventId === 'string') counts.set(image.eventId, (counts.get(image.eventId) ?? 0) + 1);
  const view = clearedView(session, new Set(counts.keys()));
  if (view !== session) view.shownImages = counts;
  return view;
}

/**
 * `session` with the located nontext loss (the adapter's `nontext_attached` gap, located: it counts exactly the events
 * it names) no longer naming the messages of `ids` — the gap dropped when it names nothing else — as a view of it; the
 * session itself when `ids` is empty. An unlocated gap, or any other, is kept as it is. A report reads its session so
 * for the messages every window that reached them showed the images of (run-review.js); a request, for its own
 * (`deliveredView`).
 */
export function clearedView(session, ids) {
  if (!(ids instanceof Set) || !ids.size || session === null || typeof session !== 'object') return session;
  const view = Object.create(session);
  view.adapterGaps = (Array.isArray(session.adapterGaps) ? session.adapterGaps : []).flatMap((gap) => {
    if (gap?.note !== INSTRUCTION_GAP_NOTES.nontext_attached || !Array.isArray(gap.eventIds)
      || gap.count !== gap.eventIds.length) return [gap];
    const rest = gap.eventIds.filter((id) => !ids.has(id));
    if (rest.length === gap.eventIds.length) return [gap];
    return rest.length ? [{ ...gap, count: rest.length, eventIds: rest }] : [];
  });
  return view;
}
