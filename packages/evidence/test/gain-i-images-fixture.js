// Gain I (2026-10-13) fixtures: synthetic images and a synthetic Claude Code recording whose human message carries a
// pasted image. Every byte is invented: an image here is only its format's header (no picture), enough for a signature
// and a stated pixel size. No real recording is read; nothing here holds a secret.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { adapt, humanAsk, call, result, said, row, SESSION } from './m33-u-unasked-fixture.js';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 0);
  return Buffer.concat([head, data, crc]);
};

/** A PNG header of `width` x `height` (signature, IHDR, IEND). */
export function png(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IEND', Buffer.alloc(0))]);
}
/** A JPEG of `width` x `height`: SOI, an APP0 segment, then a baseline start-of-frame, then EOI. */
export function jpeg(width, height) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
    0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03,
    0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.from([0xff, 0xd9])]);
}
/** A GIF89a logical screen of `width` x `height`. */
export function gif(width, height) {
  const b = Buffer.alloc(13);
  b.write('GIF89a', 0, 'latin1'); b.writeUInt16LE(width, 6); b.writeUInt16LE(height, 8);
  return b;
}
/** A WebP whose VP8X header states a `width` x `height` canvas. */
export function webp(width, height) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1');
  b.writeUInt32LE(10, 16); b.writeUIntLE(width - 1, 24, 3); b.writeUIntLE(height - 1, 27, 3);
  return b;
}

/** A Claude Code image block, as the recorder writes one a person pasted. */
export const imageBlock = (bytes, mediaType = 'image/png') => ({ type: 'image',
  source: { type: 'base64', media_type: mediaType, data: Buffer.from(bytes).toString('base64') } });

export const ASK = 'Write the parser in src/parser.js the way this screenshot shows.';
/** One request of a person's that carries `blocks` beside its words (none: words alone), then one write and a closing
 *  statement. `words: false`: the message carries the blocks alone. */
export function pastedRows(blocks = [imageBlock(png(64, 48))], { words = true } = {}) {
  return [
    ...(words ? [] : [humanAsk('Write the parser in src/parser.js.')]),
    humanAsk([...(words ? [{ type: 'text', text: ASK }] : []), ...blocks]),
    call('w1', 'Write', { file_path: '/repo/src/parser.js', content: 'export const parse = (s) => s.trim();\n' },
      'Writing the parser now.'),
    result('w1', 'File created successfully at: /repo/src/parser.js', { type: 'create', filePath: '/repo/src/parser.js',
      content: 'export const parse = (s) => s.trim();\n', structuredPatch: [] }),
    said('The parser is written.'),
  ].map((r, i) => ({ ...r, uuid: `u-gain-i-${i + 1}` }));
}

/** Write `rows` as one recording, slice it, bound and validate it as a session review loads it (redact; D90: nothing is
 *  masked), and adapt it. `persisted` gives the ledger as an earlier Sonah may have written it (itself by default). */
export async function loadPasted(t, rows, { sessionKey = 'gain-i', persisted = (ledger) => ledger } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-gain-i-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${SESSION}.jsonl`);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const raw = await sliceLineage([file], { cwd: '/repo' });
  const ledger = redact(persisted(raw)).ledger;
  return { raw, ledger, session: adapt(ledger, sessionKey) };
}
export { row, SESSION };
