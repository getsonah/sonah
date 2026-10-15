import { constants } from 'node:fs';
import { lstat, open, realpath, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import { TextDecoder } from 'node:util';
import { recordingIdentity } from '../../slicer/src/recording-identity.js';
import { duplicateJsonKeys, strictJson } from '../../slicer/src/strict-json.js';

const CLOSED = 'Recording input could not be verified';
const fail = (reason = 'unverified') => { throw Object.assign(new Error(CLOSED), { reason }); };
const LIMIT_REASONS = Object.freeze(['bytes', 'line_bytes', 'records', 'deadline']);
const limit = reason => fail(reason);
const bounded = value => Number.isSafeInteger(value) && value > 0;
const inside = (path, root) => {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !rel.startsWith(sep);
};
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
const unchanged = (a, b) => sameFile(a, b) && a.size === b.size
  && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
export const recordingVersion = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs]
  .map(String).join(':');
const owned = stat => typeof process.getuid !== 'function' || stat.uid === BigInt(process.getuid());

// Consumers are private and provisional: no result escapes until EOF and the final file checks.
// Both full action reads and metadata scans use the same path, inode, byte and UTF-8 checks.
async function scanRecording(file, { namespace, maxBytes, maxLineBytes, deadline = Infinity }, consume, finish = () => {}) {
  if (typeof file !== 'string' || typeof namespace !== 'string' || !bounded(maxBytes) || !bounded(maxLineBytes)
    || maxLineBytes > maxBytes || typeof deadline !== 'number' || Number.isNaN(deadline)) fail();
  const checkTime = () => { if (performance.now() >= deadline) limit('deadline'); };

  let handle;
  let total = 0;
  try {
    checkTime();
    const root = await realpath(namespace);
    const pathBefore = await realpath(file);
    const entryBefore = await lstat(file, { bigint: true });
    if (!inside(pathBefore, root) || !entryBefore.isFile() || entryBefore.isSymbolicLink()
      || entryBefore.nlink !== 1n || !owned(entryBefore)) fail();
    if (entryBefore.size > BigInt(maxBytes)) limit('bytes');

    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedBefore = await handle.stat({ bigint: true });
    if (!openedBefore.isFile() || openedBefore.nlink !== 1n || !owned(openedBefore)
      || !sameFile(entryBefore, openedBefore)) fail();
    if (openedBefore.size > BigInt(maxBytes)) limit('bytes');

    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    let lineBytes = 0;
    while (true) {
      checkTime();
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, maxBytes - total + 1), null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) limit('bytes');
      const used = chunk.subarray(0, bytesRead);
      let start = 0, newline;
      while ((newline = used.indexOf(0x0a, start)) !== -1) {
        if (lineBytes + newline - start > maxLineBytes) limit('line_bytes');
        lineBytes = 0;
        start = newline + 1;
      }
      lineBytes += used.length - start;
      if (lineBytes > maxLineBytes) limit('line_bytes');
      decoder.decode(used, { stream: true });
      await consume(used);
    }
    decoder.decode(); // Reject an unfinished multibyte sequence at EOF.
    await finish();
    checkTime();

    const openedAfter = await handle.stat({ bigint: true });
    const entryAfter = await lstat(file, { bigint: true });
    const pathAfter = await realpath(file);
    if (!unchanged(openedBefore, openedAfter) || !unchanged(entryBefore, entryAfter)
      || !sameFile(openedAfter, entryAfter) || BigInt(total) !== openedAfter.size
      || pathAfter !== pathBefore || !inside(pathAfter, root)) fail();
    checkTime();

    return { bytesRead: total, version: recordingVersion(openedAfter) };
  } catch (error) {
    // Counters are safe to report; native errors may contain paths or source text.
    throw Object.assign(new Error(CLOSED), { reason: LIMIT_REASONS.includes(error?.reason)
      ? error.reason : 'unverified', bytesRead: total });
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Return the exact verified bytes for a bounded action snapshot. Never echo rejected input. */
export async function readRecording(file, { namespace, maxBytes = 8_000_000,
  maxLineBytes = Math.min(maxBytes, 8_000_000) } = {}) {
  const chunks = [];
  const { bytesRead } = await scanRecording(file, { namespace, maxBytes, maxLineBytes },
    used => chunks.push(Buffer.from(used)));
  return Buffer.concat(chunks, bytesRead);
}

/** Copy one verified native file into a private immutable parsing input without retaining it
 * in a Buffer. The caller owns the returned directory and must remove it in a finally block.
 * A limit or source change removes the provisional copy before any content can escape. */
export async function snapshotRecording(file, { namespace, maxBytes, maxLineBytes, deadline = Infinity } = {}) {
  let directory;
  let output;
  try {
    if (typeof file !== 'string') fail();
    const name = basename(file);
    if (!name || name === '.' || name === '..' || !name.endsWith('.jsonl')) fail();
    directory = await mkdtemp(join(tmpdir(), 'sonah-recording-'));
    const path = join(directory, name);
    output = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    const { bytesRead } = await scanRecording(file, { namespace, maxBytes, maxLineBytes, deadline },
      async bytes => {
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesWritten } = await output.write(bytes, offset, bytes.length - offset);
          if (bytesWritten <= 0) fail();
          offset += bytesWritten;
        }
      });
    await output.sync();
    await output.close();
    output = null;
    return { directory, path, bytesRead };
  } catch (error) {
    await output?.close().catch(() => {});
    if (directory) await rm(directory, { recursive: true, force: true });
    if (error?.message === CLOSED) throw error;
    fail();
  }
}

/** Stream every record, retaining only bounded metadata. No raw record or provisional ID escapes.
 * `candidates: true` (exactly) also returns the C-03 conflict candidate side channel, unredacted:
 * only the inventory asks for it, and it redacts the values before storing or comparing them. */
export async function readRecordingIdentity(file, { adapter, namespace, maxBytes = 64_000_000,
  maxLineBytes = 1_000_000, maxRecords = 1_000_000, deadline = Infinity, candidates = false } = {}) {
  if (!['codex', 'claude'].includes(adapter) || !bounded(maxRecords)
    || !bounded(maxLineBytes) || !bounded(maxBytes) || maxLineBytes > maxBytes) fail();
  const identity = recordingIdentity(adapter);
  let line = Buffer.allocUnsafe(Math.min(64 * 1024, maxLineBytes, maxBytes));
  let length = 0, records = 0;
  const observe = () => {
    const text = line.toString('utf8', 0, length);
    length = 0;
    if (!text.trim()) return;
    if (records >= maxRecords) limit('records');
    records++;
    const record = JSON.parse(text);
    if (!record || typeof record !== 'object' || Array.isArray(record)) fail();
    identity.observe(record, { repeatedKeys: duplicateJsonKeys(text) });
  };
  try {
    const { bytesRead, version } = await scanRecording(file, { namespace, maxBytes, maxLineBytes, deadline }, used => {
      let start = 0;
      while (start < used.length) {
        const newline = used.indexOf(0x0a, start);
        const end = newline === -1 ? used.length : newline;
        const required = length + end - start;
        if (required > maxLineBytes) limit('line_bytes');
        if (required > line.length) {
          const next = Buffer.allocUnsafe(Math.min(maxLineBytes, Math.max(required, line.length * 2)));
          line.copy(next, 0, 0, length);
          line = next;
        }
        used.copy(line, length, start, end);
        length += end - start;
        if (newline === -1) break;
        observe();
        start = newline + 1;
      }
    }, () => { if (length) observe(); });
    return { ...identity.value(), bytesRead, records, version,
      ...(candidates === true ? { candidates: identity.candidates() } : {}) };
  } catch (error) {
    error.records = records;
    throw error;
  }
}

/**
 * M33 W repair 2 (calls copied from an earlier session file). The rows of one recording whose own `uuid` is one of
 * `uuids`, read through the same verified path as every recording: inside `namespace`, a regular owned single-linked
 * file (never a symlink), at most `maxBytes`, unchanged while read. Streamed: a line is parsed only when its bytes
 * hold a wanted uuid, and every other line is passed over unparsed and unkept. Returns `Map<uuid, Array<row|null>>`
 * — each strict JSON object row recording a wanted `uuid`, and null under every wanted uuid a line names when that
 * line is not one strict JSON object (it could be that row: fail closed). A row whose uuid is spelled with JSON
 * escapes is not found. More than `maxRows` kept rows is a limit. Nothing escapes before EOF and the final checks.
 */
export async function readRecordingRows(file, { namespace, uuids, maxBytes, maxLineBytes = Math.min(maxBytes, 8_000_000),
  maxRows } = {}) {
  if (!Array.isArray(uuids) || !uuids.length || uuids.some(uuid => typeof uuid !== 'string' || !uuid)
    || !bounded(maxRows) || !bounded(maxBytes) || !bounded(maxLineBytes) || maxLineBytes > maxBytes) fail();
  const wanted = [...new Set(uuids)];
  const needles = wanted.map(uuid => Buffer.from(uuid, 'utf8'));
  const found = new Map();
  let kept = 0;
  const keep = (uuid, row) => {
    if (++kept > maxRows) limit('records');
    found.set(uuid, [...(found.get(uuid) ?? []), row]);
  };
  let line = Buffer.allocUnsafe(Math.min(64 * 1024, maxLineBytes, maxBytes));
  let length = 0;
  const observe = () => {
    const bytes = line.subarray(0, length);
    const named = wanted.filter((_, index) => bytes.indexOf(needles[index]) !== -1);
    if (named.length) {
      const decoded = strictJson(bytes.toString('utf8'));
      const row = decoded.strict && decoded.value !== null && typeof decoded.value === 'object'
        && !Array.isArray(decoded.value) ? decoded.value : null;
      if (row === null) for (const uuid of named) keep(uuid, null);
      else if (typeof row.uuid === 'string' && named.includes(row.uuid)) keep(row.uuid, row);
    }
    length = 0;
  };
  await scanRecording(file, { namespace, maxBytes, maxLineBytes }, used => {
    let start = 0;
    while (start < used.length) {
      const newline = used.indexOf(0x0a, start);
      const end = newline === -1 ? used.length : newline;
      const required = length + end - start;
      if (required > maxLineBytes) limit('line_bytes');
      if (required > line.length) {
        const next = Buffer.allocUnsafe(Math.min(maxLineBytes, Math.max(required, line.length * 2)));
        line.copy(next, 0, 0, length);
        line = next;
      }
      used.copy(line, length, start, end);
      length += end - start;
      if (newline === -1) break;
      observe();
      start = newline + 1;
    }
  }, () => { if (length) observe(); });
  return found;
}
