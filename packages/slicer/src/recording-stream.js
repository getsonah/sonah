// D142: the one way the slicer opens a recording to read it, whole or (`byteEnd`) through its first `byteEnd`
// bytes only. A review of a session that is still being written reads every recording as it was when the review started
// (cli frozen-read.js): the caller gives the offset just after the last whole line at that moment, so a row written
// later is never read, and the same bytes give the same records. Pure as the readers are: no clock, no network.
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

/** A UTF-8 stream of the file: whole when `byteEnd` is null or undefined, else bytes [0, byteEnd). */
export function recordingStream(file, byteEnd = null) {
  if (byteEnd === null || byteEnd === undefined) return createReadStream(file, { encoding: 'utf8' });
  if (!Number.isSafeInteger(byteEnd) || byteEnd < 0) throw new Error('A recording end could not be verified');
  // An end of 0 reads nothing: `createReadStream` cannot express an empty range.
  return byteEnd === 0 ? Readable.from([]) : createReadStream(file, { encoding: 'utf8', start: 0, end: byteEnd - 1 });
}
